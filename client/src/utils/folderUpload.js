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
 * 2. createFolderHierarchy(itemsWithPaths, baseParentId, token):
 * - Extract all unique parent directory paths from relativePath (ignoring root-level files without /)
 *   and sort them ascending by depth (path.split('/').length).
 * - Walk top-down and call POST /api/folders with { name, parentId }
 *   (starting from baseParentId || null and passing Authorization: Bearer ${token}).
 * - If POST /api/folders returns 409 (folder already exists in that parent),
 *   fetch GET /api/folders?parentId=... and reuse the existing folder's _id.
 * - Return folderMap (Map<directoryPath, folderId>).
 *
 * @param {Array<{ file: File, relativePath: string }>} itemsWithPaths
 * @param {string|null} baseParentId
 * @param {string|null} token
 * @returns {Promise<Map<string, string>>} folderMap
 */
export async function createFolderHierarchy(itemsWithPaths, baseParentId = null, token = null) {
  const folderMap = new Map();
  if (!itemsWithPaths || itemsWithPaths.length === 0) return folderMap;

  const activeToken = token || localStorage.getItem('token') || sessionStorage.getItem('token');
  const headers = activeToken ? { Authorization: `Bearer ${activeToken}` } : {};

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

  // Sort ascending by depth (path.split('/').length) to ensure parents are created before children
  const sortedDirs = Array.from(dirSet).sort(
    (a, b) => a.split('/').length - b.split('/').length
  );

  // Walk top-down
  for (const dirPath of sortedDirs) {
    const lastSlashIdx = dirPath.lastIndexOf('/');
    const dirName = lastSlashIdx === -1 ? dirPath : dirPath.substring(lastSlashIdx + 1);
    const parentDirPath = lastSlashIdx === -1 ? null : dirPath.substring(0, lastSlashIdx);

    // Resolve parentId from folderMap if ancestor exists, otherwise fallback to baseParentId
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
        { headers }
      );
      const createdId = res.data?._id || res.data?.id;
      if (createdId) {
        folderMap.set(dirPath, String(createdId));
      }
    } catch (err) {
      if (err.response?.status === 409) {
        // Folder already exists in this parent: query GET /api/folders?parentId=... and reuse _id
        try {
          const params = resolvedParentId ? { parentId: resolvedParentId } : {};
          const listRes = await axios.get(`${API_BASE_URL}/api/folders`, {
            params,
            headers,
          });
          const existingList = Array.isArray(listRes.data) ? listRes.data : [];
          const existingMatch = existingList.find(
            (f) => (f.name || '').trim().toLowerCase() === dirName.trim().toLowerCase()
          );

          if (existingMatch) {
            folderMap.set(dirPath, String(existingMatch._id || existingMatch.id));
          } else {
            console.warn(`[FolderUpload] Conflict 409 reported for "${dirName}", but not found in parent listing.`);
          }
        } catch (fetchErr) {
          console.error(`[FolderUpload] Failed to query existing folder for "${dirName}":`, fetchErr);
          throw fetchErr;
        }
      } else {
        console.error(`[FolderUpload] Failed to create folder "${dirName}":`, err);
        throw err;
      }
    }
  }

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

