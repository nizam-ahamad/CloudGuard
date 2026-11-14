import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { UploadCloud, FolderPlus, ChevronDown, FileUp, FolderUp } from 'lucide-react';
import { formatBytes } from '../utils/formatters';
import { API_BASE_URL } from '../config';
import { computeFileSHA256, computeSHA256 } from '../utils/cryptoHelper';
import { generateMediaThumbnail } from '../utils/thumbnailHelper';
import { useUpload } from '../context/UploadContext';
import { useToast } from '../context/ToastContext';
import SubscriptionAlertBanner from '../components/SubscriptionAlertBanner';
import { extractDroppedItems, createFolderHierarchy } from '../utils/folderUpload';

export { computeFileSHA256, computeSHA256 };

let globalDashboardStorageCache = null;

/**
 * Direct-to-S3 Upload Pipeline with concurrent SHA-256 fingerprinting
 */
export const uploadFileDirectlyToS3 = async (file, targetFolderId, onProgress) => {
  const token = localStorage.getItem('token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  // Step 1: Request presigned upload ticket from backend (~5ms)
  const { data: ticket } = await axios.post(
    `${API_BASE_URL}/api/files/presigned-url`,
    {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      folderId: targetFolderId || null,
    },
    { headers }
  );

  if (!ticket || !ticket.presignedUrl) {
    throw new Error('Failed to acquire secure presigned upload ticket.');
  }

  const s3Axios = axios.create();
  delete s3Axios.defaults.headers.common['Authorization'];

  // Step 2: Concurrently compute SHA-256 and generate thumbnail while streaming file directly to S3
  const [sha256, thumbnail] = await Promise.all([
    computeFileSHA256(file),
    generateMediaThumbnail(file).catch(() => null),
    s3Axios.put(ticket.presignedUrl, file, {
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
      transformRequest: [(data, reqHeaders) => {
        if (reqHeaders) {
          delete reqHeaders.Authorization;
          delete reqHeaders.authorization;
        }
        return data;
      }],
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          if (typeof onProgress === 'function') onProgress(percent);
        }
      },
    }),
  ]);

  // Step 3: Finalize upload with backend (triggers MalwareBazaar check & PE Range scan)
  const { data: finalizeResult } = await axios.post(
    `${API_BASE_URL}/api/files/finalize-upload`,
    {
      fileId: ticket.fileId,
      s3Key: ticket.s3Key,
      sha256,
      thumbnail: thumbnail || undefined,
    },
    { headers }
  );

  // Step 4: Handle scan verdict
  if (finalizeResult.isMalicious) {
    return { success: false, isMalicious: true, message: finalizeResult.message };
  }

  return { success: true, isMalicious: false, file: finalizeResult.file };
};

/**
 * Clean Dark-Themed Skeleton Loader Component for Folder and File Navigation
 */
export const FolderNavigationSkeleton = () => (
  <div className="space-y-2 mt-4 animate-pulse">
    {/* Folder Skeletons */}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 bg-neutral-900/60 border border-neutral-800/60 rounded-lg" />
      ))}
    </div>

    {/* File Row Skeletons */}
    {[1, 2, 3, 4, 5].map((i) => (
      <div
        key={i}
        className="h-12 w-full bg-neutral-900/40 border border-neutral-800/40 rounded-lg flex items-center justify-between px-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 bg-neutral-800 rounded" />
          <div className="w-36 h-3 bg-neutral-800 rounded" />
        </div>
        <div className="w-16 h-3 bg-neutral-800 rounded" />
      </div>
    ))}
  </div>
);

/**
 * Direct S3 Presigned Upload & Finalize Pipeline Helper
 */
export const processQueueItem = async ({
  item,
  folderId,
  apiBaseUrl,
  abortSignal,
  onProgress,
  onStatusChange,
}) => {
  const { file, name, size } = item;
  let currentFileId = null;

  try {
    const s3Axios = axios.create();
    delete s3Axios.defaults.headers.common['Authorization'];

    // Ensure actual File reference is resolved whether item is a File or an Object wrapper
    const fileObj = item.file instanceof File ? item.file : (item instanceof File ? item : item.file || item);

    const payload = {
      fileName: fileObj.name || name,
      name: fileObj.name || name,
      fileSize: fileObj.size !== undefined ? fileObj.size : size,
      size: fileObj.size !== undefined ? fileObj.size : size,
      mimeType: fileObj.type || 'application/octet-stream',
      type: fileObj.type || 'application/octet-stream',
      folderId: folderId || null,
      folder: folderId || null,
    };

    const token = localStorage.getItem('token');
    const presignRes = await axios.post(`${apiBaseUrl}/api/files/presigned-url`, payload, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });

    const presignedUrl = presignRes.data.presignedUrl || presignRes.data.signedUrl;
    currentFileId = presignRes.data.fileId;

    const [thumbnail] = await Promise.all([
      generateMediaThumbnail(fileObj).catch(() => null),
      s3Axios.put(presignedUrl, fileObj, {
        headers: {
          'Content-Type': fileObj.type || 'application/octet-stream'
        },
        transformRequest: [(data, headers) => {
          if (headers) {
            delete headers.Authorization;
            delete headers.authorization;
          }
          return data;
        }],
        signal: abortSignal,
        onUploadProgress: onProgress
      })
    ]);

    if (onStatusChange) onStatusChange('analyzing');

    const computedHash = item.fileHash || await computeSHA256(fileObj);

    const finalizeRes = await axios.post(`${apiBaseUrl}/api/files/finalize-upload`, {
      fileId: currentFileId,
      sha256: computedHash || undefined,
      thumbnail: thumbnail || undefined
    }, {
      signal: abortSignal
    });

    return finalizeRes.data;
  } catch (err) {
    if (axios.isCancel(err) && currentFileId) {
      try { await axios.delete(`${apiBaseUrl}/api/files/${currentFileId}`); } catch (e) {}
    }
    throw err;
  }
};

// Storage Meter Widget Component
export const StorageMeter = ({ storageStats: propStats, fetchStorageStats }) => {
  const [storageStats, setStorageStats] = useState(() => propStats || globalDashboardStorageCache || null);

  useEffect(() => {
    if (propStats) {
      globalDashboardStorageCache = propStats;
      setStorageStats(propStats);
    }
  }, [propStats]);

  useEffect(() => {
    if (typeof fetchStorageStats === 'function') {
      fetchStorageStats();
    }
  }, [fetchStorageStats]);

  const percentage = storageStats?.percentage !== undefined
    ? storageStats.percentage
    : (storageStats?.usedPercentage !== undefined
      ? storageStats.usedPercentage
      : (storageStats
        ? Math.min(100, Math.round(((storageStats.storageUsed || storageStats.usedBytes || storageStats.used || 0) / (storageStats.storageLimit || storageStats.totalLimitBytes || storageStats.limit || 5368709120)) * 100))
        : '...'));

  return (
    <div className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
      <div className="relative w-12 h-12 flex items-center justify-center">
        {/* Percentage meter ring */}
        <span className="text-xs font-semibold text-zinc-200">
          {storageStats ? `${percentage}%` : '...'}
        </span>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          Storage Used
        </p>
        <p className="text-sm font-semibold text-zinc-100">
          {storageStats
            ? `${formatBytes(storageStats.storageUsed || storageStats.used || storageStats.usedBytes || 0)} / ${formatBytes(storageStats.storageLimit || storageStats.limit || storageStats.totalLimitBytes || 5368709120)}`
            : 'Loading...'}
        </p>
      </div>
    </div>
  );
};

export const Dashboard = (props) => {
  const {
    hasMoreRecent = false,
    isLoadingMoreRecent = false,
    onLoadMoreRecent = props.handleLoadMoreRecent,
  } = props;
  const { enqueueFiles } = useUpload();
  const toast = useToast();
  const [storageStats, setStorageStats] = useState(() => props.storageStats || globalDashboardStorageCache || null);

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
  const desktopUploadMenuRef = useRef(null);
  const mobileUploadMenuRef = useRef(null);

  const handleFileSelect = (e, currentFolderId = null) => {
    const selected = e.target.files;
    if (selected && selected.length > 0 && typeof enqueueFiles === 'function') {
      enqueueFiles(selected, currentFolderId);
    }
    e.target.value = null; // Clear input to allow re-uploading same file name
  };

  const handleFolderSelect = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const itemsWithPaths = Array.from(files).map((file) => ({
        file,
        relativePath: (file.webkitRelativePath || file.name).replace(/\\/g, '/'),
      }));
      processFolderUpload(itemsWithPaths);
    }
    e.target.value = null; // Clear input to allow re-uploading same folder
  };

  const processFolderUpload = async (itemsWithPaths) => {
    if (!itemsWithPaths || itemsWithPaths.length === 0) return;
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');

    // 1. Check pre-flight quota: if storageUsed + totalBatchBytes > storageLimit, show quota error toast and abort before creating any folders
    const totalBatchBytes = itemsWithPaths.reduce((sum, item) => sum + (item.file?.size || 0), 0);
    const storageUsed = storageStats?.storageUsed || storageStats?.usedBytes || storageStats?.used || 0;
    const storageLimit = storageStats?.storageLimit || storageStats?.totalLimitBytes || storageStats?.limit || 5368709120;

    if (storageUsed + totalBatchBytes > storageLimit) {
      if (toast && typeof toast.error === 'function') {
        toast.error('Storage quota exceeded. Not enough space in your vault for this folder.');
      }
      return;
    }

    const currentFolderId =
      props.currentFolder?._id ||
      new URLSearchParams(window.location.search).get('folder') ||
      null;

    const hasDirectory = itemsWithPaths.some((item) => {
      const rawPath = item.relativePath || item.file?.name || '';
      return rawPath.replace(/\\/g, '/').includes('/');
    });

    // If a mobile browser fallback returns flat files without webkitRelativePath directories
    if (!hasDirectory) {
      const flatFiles = itemsWithPaths.map((item) => item.file).filter(Boolean);
      if (flatFiles.length > 0 && typeof enqueueFiles === 'function') {
        enqueueFiles(flatFiles, currentFolderId);
      }
      return;
    }

    try {
      // 2. Call createFolderHierarchy(...) to create the directory tree in MongoDB
      const folderMap = await createFolderHierarchy(itemsWithPaths, currentFolderId, token);

      // 3. Map every file to its resolved targetFolderId and pass batch to enqueueFiles(...)
      const filesToEnqueue = itemsWithPaths.map((item) => {
        let targetFolderId = currentFolderId;
        const rawPath = item.relativePath || item.file?.name || '';
        const relPath = rawPath.replace(/\\/g, '/');
        if (relPath.includes('/')) {
          const dirPath = relPath.substring(0, relPath.lastIndexOf('/'));
          targetFolderId = folderMap.get(dirPath) || currentFolderId;
        }
        return {
          file: item.file,
          targetFolderId,
        };
      });

      if (typeof enqueueFiles === 'function') {
        enqueueFiles(filesToEnqueue, currentFolderId);
      }

      // 4. Dispatch window.dispatchEvent(new CustomEvent('cloudguard:files-updated')) so the newly created top-level folder appears in the dashboard immediately
      window.dispatchEvent(
        new CustomEvent('cloudguard:files-updated', { detail: { folderId: currentFolderId } })
      );
    } catch (err) {
      console.error('Folder upload processing error:', err);
      if (toast && typeof toast.error === 'function') {
        toast.error(err.message || 'Failed to process folder upload');
      }
    }
  };

  const onDrop = async (e) => {
    e.preventDefault();
    try {
      const items = e.dataTransfer?.items;
      const extracted = await extractDroppedItems(items);
      if (extracted && extracted.length > 0) {
        await processFolderUpload(extracted);
      }
    } catch (err) {
      console.error('Drop error in Dashboard:', err);
    }
  };

  const onDragOver = (e) => {
    e.preventDefault();
  };

  useEffect(() => {
    if (!isUploadMenuOpen) return;

    const handleOutsideClick = (e) => {
      const clickedDesktop = desktopUploadMenuRef.current && desktopUploadMenuRef.current.contains(e.target);
      const clickedMobile = mobileUploadMenuRef.current && mobileUploadMenuRef.current.contains(e.target);
      if (!clickedDesktop && !clickedMobile) {
        setIsUploadMenuOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsUploadMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isUploadMenuOpen]);

  useEffect(() => {
    // If storageStats is passed via props and updates in App.jsx, synchronize local state
    if (props.storageStats) {
      globalDashboardStorageCache = props.storageStats;
      setStorageStats(props.storageStats);
    }
  }, [props.storageStats]);

  useEffect(() => {
    // Fallback mount trigger if Dashboard fetches independently
    if (typeof props.fetchStorageStats === 'function') {
      props.fetchStorageStats();
    }
  }, []);

  useEffect(() => {
    const handleFilesUpdated = () => {
      // 1. Invalidate in-memory cache for current folder so fresh data loads
      globalDashboardStorageCache = null;
      const currentFolderId =
        props.currentFolder?._id ||
        new URLSearchParams(window.location.search).get('folder') ||
        null;

      if (typeof folderDataCache !== 'undefined' && folderDataCache) {
        if (currentFolderId) {
          folderDataCache.delete(currentFolderId);
        } else {
          folderDataCache.delete('root');
        }
      }

      // 2. Fetch fresh files for the active folder
      if (typeof props.fetchFiles === 'function') {
        props.fetchFiles(currentFolderId, true);
      } else if (typeof props.fetchFolderContents === 'function') {
        props.fetchFolderContents(currentFolderId).then((fresh) => {
          if (fresh && typeof props.setFiles === 'function') {
            props.setFiles(fresh.files || []);
            if (typeof props.setFolders === 'function' && fresh.folders) props.setFolders(fresh.folders);
          }
        });
      }

      if (typeof props.fetchStorageStats === 'function') {
        props.fetchStorageStats();
      }
    };

    window.addEventListener('cloudguard:files-updated', handleFilesUpdated);
    window.addEventListener('cloudguard:storage-updated', handleFilesUpdated);
    return () => {
      window.removeEventListener('cloudguard:files-updated', handleFilesUpdated);
      window.removeEventListener('cloudguard:storage-updated', handleFilesUpdated);
    };
  }, [props.currentFolder?._id, props.fetchFiles, props.fetchFolderContents, props.fetchStorageStats]);

  return (
    <div className="space-y-4" onDrop={onDrop} onDragOver={onDragOver}>
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFileSelect(e, props.currentFolder?._id || null)}
      />
      {/* Hidden Folder Input */}
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={handleFolderSelect}
      />

      <SubscriptionAlertBanner />
      <StorageMeter storageStats={storageStats} fetchStorageStats={props.fetchStorageStats} />
      <FolderNavigationSkeleton />

      {/* Desktop Drag-and-Drop Area (Hidden on mobile) */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onClick={() => fileInputRef.current?.click()}
        className="hidden sm:flex flex-col items-center justify-center p-8 border-2 border-dashed border-neutral-200 dark:border-neutral-800 rounded-2xl bg-neutral-50/50 dark:bg-neutral-900/30 text-center mb-6 cursor-pointer group hover:bg-neutral-100/50 dark:hover:bg-neutral-800/30 transition-colors"
      >
        <div className="p-3 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 mb-3 group-hover:scale-110 transition-transform">
          <UploadCloud className="w-6 h-6" />
        </div>
        <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
          Drag & drop files or folders here
        </p>
        <p className="text-xs text-neutral-400 mt-1 mb-4">
          Securely upload documents, images, and archives. Maximum file size 5GB.
        </p>

        <div className="flex items-center gap-3">
          {/* Upload ▾ Dropdown */}
          <div ref={desktopUploadMenuRef} className="relative inline-block">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsUploadMenuOpen((prev) => !prev);
              }}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5"
            >
              <span>Upload</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${isUploadMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isUploadMenuOpen && (
              <div
                className="absolute left-0 sm:left-1/2 sm:-translate-x-1/2 top-full mt-2 w-48 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl p-1.5 z-40 text-left"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsUploadMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                >
                  <FileUp className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                  <span>Upload Files</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsUploadMenuOpen(false);
                    folderInputRef.current?.click();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                >
                  <FolderUp className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                  <span>Upload Folder</span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              props.onNewFolder?.();
            }}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
          >
            + New Folder
          </button>
        </div>
      </div>

      {/* Mobile Compact Upload Bar (Visible only on mobile) */}
      <div className="flex sm:hidden items-center gap-2 mb-4">
        <div ref={mobileUploadMenuRef} className="relative inline-block flex-1">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsUploadMenuOpen((prev) => !prev);
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 text-xs font-semibold shadow-sm hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload Files</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${isUploadMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {isUploadMenuOpen && (
            <div
              className="absolute left-0 sm:left-1/2 sm:-translate-x-1/2 top-full mt-2 w-48 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl p-1.5 z-40 text-left"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsUploadMenuOpen(false);
                  fileInputRef.current?.click();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              >
                <FileUp className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                <span>Upload Files</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsUploadMenuOpen(false);
                  folderInputRef.current?.click();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              >
                <FolderUp className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                <span>Upload Folder</span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => props.onNewFolder?.()}
          className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 text-xs font-semibold border border-neutral-200/80 dark:border-neutral-700/60 active:scale-[0.98] transition-transform cursor-pointer"
        >
          <FolderPlus className="w-4 h-4" />
          <span>New Folder</span>
        </button>
      </div>

      {/* Load More Button for Recent Tab */}
      {new URLSearchParams(window.location.search).get('tab') === 'recent' && hasMoreRecent && (
        <div className="flex justify-center items-center py-6">
          <button
            onClick={onLoadMoreRecent}
            disabled={isLoadingMoreRecent}
            className="flex items-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 shadow-sm transition-all cursor-pointer disabled:opacity-50"
          >
            {isLoadingMoreRecent ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                <span>Loading more files...</span>
              </>
            ) : (
              <span>Load More</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
