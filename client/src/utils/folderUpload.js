import axios from 'axios';
import { API_BASE_URL } from '../config';

/**
 * Recursively traverses a FileSystemEntry and returns array of { file, relativePath }.
 * Handles folders with >100 entries by looping readEntries() until exhausted.
 *
 * @param {FileSystemEntry} entry
 * @param {string} currentPath
 * @returns {Promise<Array<{ file: File, relativePath: string }>>}
 */
async function traverseEntry(entry, currentPath = '') {
  if (!entry) return [];

  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => {
      entry.file(resolve, reject);
    });
    const rawPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    const relativePath = rawPath.replace(/\\/g, '/');
    return [{ file, relativePath }];
  }

  if (entry.isDirectory) {
    const rawDirPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    const dirPath = rawDirPath.replace(/\\/g, '/');
    const dirReader = entry.createReader();
    const entries = [];

    // Loop until readEntries() returns an empty array to prevent truncation of >100 items
    const readAllEntries = async () => {
      const batch = await new Promise((resolve, reject) => {
        dirReader.readEntries(resolve, reject);
      });
      if (batch && batch.length > 0) {
        entries.push(...batch);
        await readAllEntries();
      }
    };

    try {
      await readAllEntries();
    } catch (err) {
      console.warn('Error reading directory entries:', err);
    }

    const results = [];
    for (const childEntry of entries) {
      const childResults = await traverseEntry(childEntry, dirPath);
      results.push(...childResults);
    }
    return results;
  }

  return [];
}

/**
 * 1. extractDroppedItems(dataTransferItems):
 * - Iterate dataTransferItems using item.webkitGetAsEntry().
 * - If entry.isFile, resolve { file, relativePath: entry.name }.
 * - If entry.isDirectory, recursively traverse via entry.createReader().readEntries()
 *   (looping until readEntries() returns [] so folders with >100 items are never truncated)
 *   and resolve { file, relativePath: "FolderName/Subfolder/file.ext" }.
 *
 * @param {DataTransferItemList|Array|FileList} dataTransferItems
 * @returns {Promise<Array<{ file: File, relativePath: string }>>}
 */
export async function extractDroppedItems(dataTransferItems) {
  if (!dataTransferItems) return [];
  const items = Array.from(dataTransferItems);
  const allResults = [];

  for (const item of items) {
    // Skip non-file items if kind is present (e.g. text/string drags)
    if (item.kind && item.kind !== 'file') continue;

    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) {
      const entryResults = await traverseEntry(entry);
      allResults.push(...entryResults);
    } else if (typeof item.getAsFile === 'function') {
      const file = item.getAsFile();
      if (file) {
        allResults.push({ file, relativePath: file.name.replace(/\\/g, '/') });
      }
    } else if (item instanceof File) {
      allResults.push({
        file: item,
        relativePath: (item.webkitRelativePath || item.name).replace(/\\/g, '/')
      });
    }
  }

  return allResults;
}

/**
 * 2. createFolderHierarchy(itemsWithPaths, baseParentId, tokenOrHeaders, options = {}):
 * - Extract unique directory paths, sort ascending by depth.
 * - Process one depth level at a time in parallel chunks of 8 concurrent requests.
 * - Check signal?.aborted before and during execution; throw AbortError immediately if aborted.
 * - Handle 409 Conflict by querying parent folder listing and reusing existing folder ID.
 * - Call onProgress?.({ createdCount, totalFolders, currentFolderName }) after each folder resolves.
 * - Return folderMap (Map<directoryPath, folderId>).
 *
 * @param {Array<{ file: File, relativePath: string }>} itemsWithPaths
 * @param {string|null} baseParentId
 * @param {string|object|null} tokenOrHeaders
 * @param {object} options { onProgress, signal }
 * @returns {Promise<Map<string, string>>} folderMap
 */
export async function createFolderHierarchy(
  itemsWithPaths,
  baseParentId = null,
  tokenOrHeaders = null,
  options = {}
) {
  const folderMap = new Map();
  if (!itemsWithPaths || itemsWithPaths.length === 0) return folderMap;

  // Resolve headers and options flexibly
  let headers = {};
  let opts = options || {};

  if (tokenOrHeaders && typeof tokenOrHeaders === 'object') {
    if (tokenOrHeaders.onProgress !== undefined || tokenOrHeaders.signal !== undefined) {
      opts = tokenOrHeaders;
    } else if (tokenOrHeaders.headers) {
      headers = tokenOrHeaders.headers;
    } else if (tokenOrHeaders.Authorization || tokenOrHeaders.authorization) {
      headers = tokenOrHeaders;
    }
  } else if (typeof tokenOrHeaders === 'string') {
    headers = { Authorization: `Bearer ${tokenOrHeaders}` };
  } else {
    const activeToken = localStorage.getItem('token') || sessionStorage.getItem('token');
    if (activeToken) headers = { Authorization: `Bearer ${activeToken}` };
  }

  const { onProgress, signal } = opts;

  if (signal?.aborted) {
    const abortErr = new Error('Folder preparation was aborted');
    abortErr.name = 'AbortError';
    throw abortErr;
  }

  // Extract all unique parent directory paths
  const dirSet = new Set();
  for (const item of itemsWithPaths) {
    const rawPath = item.relativePath || item.file?.name || '';
    const relPath = rawPath.replace(/\\/g, '/');
    if (!relPath.includes('/')) continue;

    const parts = relPath.split('/');
    // Directory segments are all segments except the last (the file name)
    let currentDir = '';
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = currentDir ? `${currentDir}/${parts[i]}` : parts[i];
      dirSet.add(currentDir);
    }
  }

  if (dirSet.size === 0) return folderMap;

  // Sort all unique directory paths ascending by depth (parents first)
  const sortedPaths = Array.from(dirSet).sort((a, b) => {
    const depthA = a.split('/').length;
    const depthB = b.split('/').length;
    if (depthA !== depthB) return depthA - depthB;
    return a.localeCompare(b);
  });

  const totalFolders = sortedPaths.length;
  const CHUNK_SIZE = 250;
  let useFallback = false;
  let bulkSuccess = false;

  // 1. Try High-Performance Bulk Folder Tree Creation (/api/folders/ensure-tree)
  try {
    let resolvedCount = 0;
    for (let i = 0; i < sortedPaths.length; i += CHUNK_SIZE) {
      if (signal?.aborted) {
        const abortErr = new Error('Folder preparation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      const chunk = sortedPaths.slice(i, i + CHUNK_SIZE);
      const res = await axios.post(
        `${API_BASE_URL}/api/folders/ensure-tree`,
        {
          baseParentId: baseParentId || null,
          paths: chunk,
        },
        { headers, signal }
      );

      if (res.data?.success && res.data?.folderMap) {
        for (const [p, id] of Object.entries(res.data.folderMap)) {
          if (!folderMap.has(p)) {
            folderMap.set(p, String(id));
            resolvedCount++;
          }
        }
      }

      const lastDir = chunk[chunk.length - 1];
      const lastDirName = lastDir.includes('/') ? lastDir.split('/').pop() : lastDir;

      onProgress?.({
        createdCount: resolvedCount,
        totalFolders,
        currentFolderName: lastDirName,
      });
    }

    bulkSuccess = true;
    return folderMap;
  } catch (err) {
    if (axios.isCancel(err) || err.name === 'AbortError' || signal?.aborted) {
      const abortErr = new Error('Folder preparation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    if (err.response?.status === 404) {
      console.warn('[FolderUpload] /api/folders/ensure-tree returned 404. Falling back to depth-batched loop.');
      useFallback = true;
    } else {
      console.warn('[FolderUpload] Bulk folder creation encountered error, falling back:', err.message);
      useFallback = true;
    }
  }

  // 2. Fallback: Depth-batched POST /api/folders loop
  if (useFallback && !bulkSuccess) {
    // Group directory paths by depth (depth 1, depth 2, ...)
    const depthMap = new Map();
    for (const dirPath of dirSet) {
      const depth = dirPath.split('/').length;
      if (!depthMap.has(depth)) {
        depthMap.set(depth, []);
      }
      depthMap.get(depth).push(dirPath);
    }

    const sortedDepths = Array.from(depthMap.keys()).sort((a, b) => a - b);
    let createdCount = folderMap.size;

    // Cache existing parent folder queries to avoid redundant GET /api/folders?parentId=...
    const parentListingCache = new Map();

    const createOrResolveFolder = async (dirPath) => {
      if (folderMap.has(dirPath)) return;
      if (signal?.aborted) {
        const abortErr = new Error('Folder preparation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      const lastSlashIdx = dirPath.lastIndexOf('/');
      const dirName = lastSlashIdx === -1 ? dirPath : dirPath.substring(lastSlashIdx + 1);
      const parentDirPath = lastSlashIdx === -1 ? null : dirPath.substring(0, lastSlashIdx);

      const resolvedParentId = parentDirPath
        ? (folderMap.get(parentDirPath) || null)
        : (baseParentId || null);

      try {
        const res = await axios.post(
          `${API_BASE_URL}/api/folders`,
          {
            name: dirName,
            parentId: resolvedParentId || null,
          },
          { headers, signal }
        );
        const createdId = res.data?._id || res.data?.id;
        if (createdId) {
          folderMap.set(dirPath, String(createdId));
        }
      } catch (err) {
        if (axios.isCancel(err) || err.name === 'AbortError' || signal?.aborted) {
          const abortErr = new Error('Folder preparation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }

        if (err.response?.status === 409) {
          try {
            const cacheKey = resolvedParentId || 'root';
            let existingList = parentListingCache.get(cacheKey);

            if (!existingList) {
              const params = resolvedParentId ? { parentId: resolvedParentId } : {};
              const listRes = await axios.get(`${API_BASE_URL}/api/folders`, {
                params,
                headers,
                signal,
              });
              existingList = Array.isArray(listRes.data) ? listRes.data : [];
              parentListingCache.set(cacheKey, existingList);
            }

            const existingMatch = existingList.find(
              (f) => (f.name || '').trim().toLowerCase() === dirName.trim().toLowerCase()
            );

            if (existingMatch) {
              folderMap.set(dirPath, String(existingMatch._id || existingMatch.id));
            } else {
              console.warn(`[FolderUpload] Conflict 409 reported for "${dirName}", but not found in parent listing.`);
            }
          } catch (fetchErr) {
            if (axios.isCancel(fetchErr) || fetchErr.name === 'AbortError' || signal?.aborted) {
              const abortErr = new Error('Folder preparation was aborted');
              abortErr.name = 'AbortError';
              throw abortErr;
            }
            console.error(`[FolderUpload] Failed to query existing folder for "${dirName}":`, fetchErr);
            throw fetchErr;
          }
        } else {
          console.error(`[FolderUpload] Failed to create folder "${dirName}":`, err);
          throw err;
        }
      }

      createdCount++;
      onProgress?.({
        createdCount,
        totalFolders,
        currentFolderName: dirName,
      });
    };

    const CHUNK_CONCURRENCY = 8;

    for (const depth of sortedDepths) {
      if (signal?.aborted) {
        const abortErr = new Error('Folder preparation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      const foldersAtDepth = depthMap.get(depth) || [];

      for (let i = 0; i < foldersAtDepth.length; i += CHUNK_CONCURRENCY) {
        if (signal?.aborted) {
          const abortErr = new Error('Folder preparation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }

        const chunk = foldersAtDepth.slice(i, i + CHUNK_CONCURRENCY);
        await Promise.all(chunk.map((dirPath) => createOrResolveFolder(dirPath)));
      }
    }
  }

  return folderMap;

  return folderMap;
}

/**
 * Recursively walks a FileSystemDirectoryHandle and collects all files with relative paths.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} currentPath
 * @returns {Promise<Array<{ file: File, relativePath: string }>>}
 */
async function walkDirectoryHandle(dirHandle, currentPath) {
  const results = [];
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        results.push({
          file,
          relativePath: `${currentPath}/${file.name}`.replace(/\\/g, '/'),
        });
      } else if (entry.kind === 'directory') {
        const childResults = await walkDirectoryHandle(entry, `${currentPath}/${entry.name}`);
        results.push(...childResults);
      }
    }
  } catch (err) {
    console.warn(`[FolderUpload] Error reading directory handle ${currentPath}:`, err);
  }
  return results;
}

/**
 * 3. pickDirectoryItems():
 * Modern directory picker using File System Access API (window.showDirectoryPicker).
 * Returns array of { file, relativePath } where relativePath starts with root folder name,
 * or null if unsupported or cancelled by user.
 *
 * @returns {Promise<Array<{ file: File, relativePath: string }> | null>}
 */
export async function pickDirectoryItems() {
  if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') {
    return null;
  }

  try {
    const rootHandle = await window.showDirectoryPicker({ mode: 'read' });
    if (!rootHandle) return null;
    const rootName = rootHandle.name || 'folder';
    const items = await walkDirectoryHandle(rootHandle, rootName);
    return items;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return null;
    }
    console.warn('[FolderUpload] showDirectoryPicker error:', err);
    return null;
  }
}

export const pickDirectoryWithModernAPI = pickDirectoryItems;

