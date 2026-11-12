import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Upload, UploadCloud, CheckCircle2, AlertTriangle, X, Loader2 } from 'lucide-react';
import { computeFileSHA256 } from '../utils/cryptoHelper';
import { generateMediaThumbnail } from '../utils/thumbnailHelper';
import { useToast } from './ToastContext';
import { API_BASE_URL } from '../config';

const UploadContext = createContext(null);
const MAX_CONCURRENT_UPLOADS = 2;
const MULTIPART_THRESHOLD = 25 * 1024 * 1024; // 25 MB
const MULTIPART_PART_CONCURRENCY = 6;
const MAX_PART_RETRIES = 5; // ~30s total resilience window (1s, 2s, 4s, 8s, 15s backoff)

// Dedicated Axios instance without default Authorization header for direct S3 PUTs
const s3Axios = axios.create();

// Format raw bytes into readable units
export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

export function UploadProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const uploadQueue = queue;
  const [isOpen, setIsOpen] = useState(false);
  const [globalSpeed, setGlobalSpeed] = useState('');
  const [quotaUpgradeState, setQuotaUpgradeState] = useState(null);
  const dropdownRef = useRef(null);

  const processingIdsRef = useRef(new Set());
  const toastCtx = useToast();

  const toast = {
    error: (msg, opts) => (toastCtx?.error ? toastCtx.error(msg, opts) : console.error(msg)),
    success: (msg, opts) => (toastCtx?.success ? toastCtx.success(msg, opts) : console.log(msg)),
    info: (msg, opts) => (toastCtx?.info ? toastCtx.info(msg, opts) : console.log(msg)),
  };

  // Keep a live ref to queue so the speed timer does not re-trigger on every render
  const queueRef = useRef(uploadQueue);
  useEffect(() => {
    queueRef.current = uploadQueue;
  }, [uploadQueue]);

  const speedTrackerRef = useRef({ lastBytes: 0, lastTime: Date.now() });
  const isAnyUploading = uploadQueue.some((i) => i.status === 'uploading');

  useEffect(() => {
    if (!isAnyUploading) {
      setGlobalSpeed('');
      speedTrackerRef.current = { lastBytes: 0, lastTime: Date.now() };
      return;
    }

    const initialBytes = queueRef.current.reduce((sum, item) => sum + (item.uploadedBytes || 0), 0);
    speedTrackerRef.current = { lastBytes: initialBytes, lastTime: Date.now() };

    const interval = setInterval(() => {
      const totalUploadedBytes = queueRef.current.reduce((sum, item) => sum + (item.uploadedBytes || 0), 0);
      const now = Date.now();
      const timeDiff = (now - speedTrackerRef.current.lastTime) / 1000;

      if (timeDiff >= 0.4) {
        const bytesDiff = Math.max(0, totalUploadedBytes - speedTrackerRef.current.lastBytes);
        const bytesPerSec = bytesDiff / timeDiff;

        if (bytesPerSec > 0) {
          const speedStr =
            bytesPerSec >= 1024 * 1024
              ? `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
              : `${Math.round(bytesPerSec / 1024)} KB/s`;
          setGlobalSpeed(speedStr);
        }
        speedTrackerRef.current = { lastBytes: totalUploadedBytes, lastTime: now };
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isAnyUploading]);

  const toggleOpen = () => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        window.dispatchEvent(new CustomEvent('cloudguard:upload-tray-opened'));
      }
      return next;
    });
  };

  const enqueueFiles = useCallback((files, targetFolderId = null) => {
    if (!files || files.length === 0) return;

    const newItems = Array.from(files).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      name: file.name,
      size: file.size,
      folderId: targetFolderId,
      status: 'queued', // queued | hashing | uploading | finalizing | clean | threat_purged | error
      progress: 0,
      error: null,
      uploadedBytes: 0,
    }));

    setQueue((prev) => [...prev, ...newItems]);
    setIsOpen(true);
  }, []);

  // Worker loop enforcing MAX_CONCURRENT_UPLOADS (2 streams)
  useEffect(() => {
    const activeUploads = queue.filter(
      (item) =>
        ['hashing', 'uploading', 'finalizing'].includes(item.status) ||
        processingIdsRef.current.has(item.id)
    );

    if (activeUploads.length >= MAX_CONCURRENT_UPLOADS) return;

    const nextItem = queue.find(
      (item) => (item.status === 'queued' || item.status === 'pending') && !processingIdsRef.current.has(item.id)
    );
    if (!nextItem) return;

    processQueueItem(nextItem);
  }, [queue]);

  const updateItem = (id, updates) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const uploadLargeFileMultipart = async ({ id, file, folderId, headers, updateItem }) => {
    // 1. Acquire multipart session + 512px thumbnail in parallel
    let initRes, thumbnail;
    try {
      [initRes, thumbnail] = await Promise.all([
        axios.post(
          `${API_BASE_URL || ''}/api/files/multipart/init`,
          {
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || 'application/octet-stream',
            folderId: folderId || null,
          },
          { headers }
        ),
        generateMediaThumbnail(file),
      ]);
    } catch (initErr) {
      if (initErr.response?.status === 403) {
        const quotaError = new Error('Storage quota exceeded');
        quotaError.isQuota = true;
        quotaError.errorData = initErr.response?.data;
        throw quotaError;
      }
      throw new Error(initErr.response?.data?.error || 'Failed to initialize multipart upload');
    }

    const { fileId, s3Key, uploadId, partSize, partUrls } = initRes.data;
    updateItem(id, { status: 'uploading', progress: 10 });

    const partProgressMap = new Array(partUrls.length).fill(0);
    const completedParts = new Array(partUrls.length);
    let nextPartIdx = 0;
    let isAborted = false;
    const abortController = new AbortController();

    const syncAggregateProgress = () => {
      if (isAborted) return;
      const totalLoaded = partProgressMap.reduce((sum, b) => sum + b, 0);
      const percent = Math.min(95, Math.max(10, Math.round((totalLoaded * 100) / file.size)));
      updateItem(id, { progress: percent, uploadedBytes: totalLoaded });
    };

    const uploadSinglePartWithRetry = async (partMeta, index) => {
      const start = index * partSize;
      const end = Math.min(start + partSize, file.size);
      const chunkBlob = file.slice(start, end); // Zero-copy disk slice

      let attempt = 0;
      while (attempt < MAX_PART_RETRIES) {
        if (isAborted) throw new Error('Multipart upload aborted');
        try {
          partProgressMap[index] = 0;
          const putRes = await s3Axios.put(partMeta.signedUrl, chunkBlob, {
            signal: abortController.signal,
            headers: { 'Content-Type': 'application/octet-stream' },
            transformRequest: [
              (data, reqHeaders) => {
                if (reqHeaders) {
                  delete reqHeaders.Authorization;
                  delete reqHeaders.authorization;
                }
                return data;
              },
            ],
            onUploadProgress: (progressEvent) => {
              if (isAborted) return;
              partProgressMap[index] = progressEvent.loaded || 0;
              syncAggregateProgress();
            },
          });

          const eTag = putRes.headers?.etag || putRes.headers?.ETag;
          if (!eTag) {
            throw new Error('Bucket CORS missing ExposeHeaders: ["ETag"]');
          }

          partProgressMap[index] = chunkBlob.size;
          syncAggregateProgress();
          completedParts[index] = { PartNumber: partMeta.partNumber, ETag: eTag };
          return;
        } catch (err) {
          if (isAborted) throw err;
          attempt += 1;
          if (attempt >= MAX_PART_RETRIES) throw err;
          // Exponential backoff capped at 15s (1s, 2s, 4s, 8s, 15s)
          const backoffMs = Math.min(15000, 1000 * Math.pow(2, attempt - 1));
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }
    };

    try {
      // 2. Stream chunks with 6 parallel workers + compute header SHA-256 concurrently
      const runWorkers = async () => {
        const workers = Array.from(
          { length: Math.min(MULTIPART_PART_CONCURRENCY, partUrls.length) },
          async () => {
            while (!isAborted && nextPartIdx < partUrls.length) {
              const currentIdx = nextPartIdx++;
              await uploadSinglePartWithRetry(partUrls[currentIdx], currentIdx);
            }
          }
        );
        await Promise.all(workers);
      };

      const [sha256] = await Promise.all([computeFileSHA256(file), runWorkers()]);

      // 3. Complete multipart assembly on S3 / Backblaze B2
      await axios.post(
        `${API_BASE_URL || ''}/api/files/multipart/complete`,
        { fileId, s3Key, uploadId, parts: completedParts },
        { headers }
      );

      return { fileId, s3Key, sha256, thumbnail };
    } catch (err) {
      isAborted = true;
      abortController.abort();

      // Abort orphaned chunks on storage bucket & clean up pending DB record
      await axios
        .post(`${API_BASE_URL || ''}/api/files/multipart/abort`, { fileId, s3Key, uploadId }, { headers })
        .catch(() => {});
      throw err;
    }
  };

  const processQueueItem = async (item) => {
    const { id, file, folderId } = item;
    processingIdsRef.current.add(id);

    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    try {
      let fileId, s3Key, sha256, thumbnail;

      if (file.size >= MULTIPART_THRESHOLD) {
        try {
          ({ fileId, s3Key, sha256, thumbnail } = await uploadLargeFileMultipart({
            id,
            file,
            folderId,
            headers,
            updateItem,
          }));
        } catch (mpErr) {
          if (mpErr.isQuota) {
            if (mpErr.errorData?.code === 'QUOTA_EXCEEDED') {
              setQueue((prev) =>
                prev.map((qItem) =>
                  qItem.id === id
                    ? { ...qItem, status: 'paused_for_upgrade', progress: 0 }
                    : qItem
                )
              );
              setQuotaUpgradeState({
                fileItem: item,
                quotaInfo: mpErr.errorData,
              });
              return;
            }
            updateItem(id, { status: 'error', error: 'Storage quota exceeded', progress: 100 });
            toast.error(`Not enough storage in vault for "${file.name}".`, { id: `quota-${id}` });
            return;
          }
          throw mpErr;
        }
      } else {
        updateItem(id, { status: 'hashing', progress: 5, uploadedBytes: 0 });

        // Parallelize thumbnail generation and ticket retrieval
        let ticket;
        try {
          const [ticketRes, thumb] = await Promise.all([
            axios.post(
              `${API_BASE_URL || ''}/api/files/presigned-url`,
              {
                fileName: file.name,
                fileSize: file.size,
                mimeType: file.type || 'application/octet-stream',
                folderId: folderId || null,
              },
              { headers }
            ),
            generateMediaThumbnail(file),
          ]);
          ticket = ticketRes.data;
          thumbnail = thumb;
          fileId = ticket.fileId;
          s3Key = ticket.s3Key;
        } catch (err) {
          const errorData = err.response?.data;
          if (err.response?.status === 403 && errorData?.code === 'QUOTA_EXCEEDED') {
            // 1. Mark upload state as paused_for_upgrade instead of failed
            setQueue((prev) =>
              prev.map((qItem) =>
                qItem.id === id
                  ? { ...qItem, status: 'paused_for_upgrade', progress: 0 }
                  : qItem
              )
            );

            // 2. Open Quota Upgrade Modal with error data and active file reference
            setQuotaUpgradeState({
              fileItem: item, // Preserves DOM File object
              quotaInfo: errorData
            });
            return;
          }

          if (err.response?.status === 403) {
            updateItem(id, {
              status: 'error',
              error: errorData?.error || 'Storage quota exceeded',
              progress: 100,
            });
            toast.error(`Not enough vault storage for "${file.name}".`, { id: `quota-${id}` });
            return;
          }
          throw new Error(err.response?.data?.error || 'Failed to acquire upload ticket');
        }

        updateItem(id, { status: 'uploading', progress: 10 });

        const [computedHash] = await Promise.all([
          computeFileSHA256(file),
          s3Axios.put(ticket.presignedUrl, file, {
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            transformRequest: [(data, reqHeaders) => {
              if (reqHeaders) {
                delete reqHeaders.Authorization;
                delete reqHeaders.authorization;
              }
              return data;
            }],
            onUploadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const percent = Math.min(
                  95,
                  Math.round((progressEvent.loaded * 100) / progressEvent.total)
                );
                updateItem(id, {
                  progress: percent,
                  uploadedBytes: progressEvent.loaded,
                });
              }
            },
          }),
        ]);
        sha256 = computedHash;
      }

      // Step 3: Finalize upload with backend, attaching thumbnail
      updateItem(id, { status: 'finalizing', progress: 96, uploadedBytes: file.size });

      const finalizeRes = await axios.post(
        `${API_BASE_URL || ''}/api/files/finalize-upload`,
        {
          fileId,
          s3Key,
          sha256,
          thumbnail, // Attach generated 15KB thumbnail
        },
        { headers }
      );

      const finalFile = finalizeRes.data?.file;
      const finalStatus = finalFile?.securityStatus || finalizeRes.data?.securityStatus;

      if (finalizeRes.data?.isMalicious || finalStatus === 'threat_purged') {
        updateItem(id, {
          status: 'threat_purged',
          progress: 100,
          error: 'Threat detected & deleted',
        });
        toast.error(`Threat detected: "${file.name}" was automatically deleted from vault.`, {
          duration: 5000,
        });
      } else if (finalStatus === 'unverified') {
        updateItem(id, { status: 'unverified', progress: 100 });
        toast.info
          ? toast.info(`Deep scan incomplete. "${file.name}" marked unverified.`, { duration: 4000 })
          : toast.error(`Deep scan incomplete. "${file.name}" marked unverified.`, { duration: 4000 });
      } else {
        updateItem(id, { status: 'clean', progress: 100 });
        toast.success(`"${file.name}" verified safe.`, { duration: 3000 });
      }

      window.dispatchEvent(new CustomEvent('cloudguard:storage-updated'));
      window.dispatchEvent(new CustomEvent('cloudguard:files-updated', { detail: { folderId } }));
    } catch (err) {
      console.error('[Upload Pipeline Error]:', err);
      updateItem(id, {
        status: 'error',
        progress: 100,
        error: err.response?.data?.error || err.message || 'Upload failed',
      });
      toast.error(`Upload failed: "${file.name}"`);
    } finally {
      processingIdsRef.current.delete(id);
      setTimeout(() => {
        const remaining = (queueRef.current || []).filter((i) =>
          ['uploading', 'hashing', 'finalizing', 'queued'].includes(i.status)
        );
        if (remaining.length === 0) {
          window.dispatchEvent(new CustomEvent('cloudguard:all-uploads-completed', { detail: { folderId } }));
          window.dispatchEvent(new CustomEvent('cloudguard:files-updated', { detail: { folderId } }));
          window.dispatchEvent(new CustomEvent('cloudguard:storage-updated'));
        }
      }, 100);
    }
  };

  const resumePausedUpload = (fileId) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === fileId
          ? { ...item, status: 'pending', error: null, progress: 0 }
          : item
      )
    );
    setQuotaUpgradeState(null);
  };

  const cancelPausedUpload = (fileId) => {
    setQueue((prev) => prev.filter((item) => item.id !== fileId));
    setQuotaUpgradeState(null);
  };

  const removeQueueItem = (id) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const clearFinished = () => {
    setQueue((prev) =>
      prev.filter((item) => ['uploading', 'hashing', 'finalizing', 'queued', 'pending', 'paused_for_upgrade'].includes(item.status))
    );
  };

  const hasActiveTransfers = queue.some((i) =>
    ['uploading', 'hashing', 'finalizing', 'queued', 'pending'].includes(i.status)
  );

  return (
    <UploadContext.Provider
      value={{
        queue,
        uploadQueue: queue,
        isUploading: hasActiveTransfers,
        clearCompleted: clearFinished,
        isOpen,
        globalSpeed,
        toggleOpen,
        enqueueFiles,
        removeQueueItem,
        clearFinished,
        dropdownRef,
        quotaUpgradeState,
        resumePausedUpload,
        cancelPausedUpload,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
}

export const useUpload = () => {
  const context = useContext(UploadContext);
  return (
    context || {
      queue: [],
      uploadQueue: [],
      isUploading: false,
      clearCompleted: () => {},
      isOpen: false,
      globalSpeed: '',
      toggleOpen: () => {},
      enqueueFiles: () => {},
      removeQueueItem: () => {},
      clearFinished: () => {},
      dropdownRef: { current: null },
      quotaUpgradeState: null,
      resumePausedUpload: () => {},
      cancelPausedUpload: () => {},
    }
  );
};

/**
 * Top Header Upload Button with Status Badge and Dropdown Tray
 */
export const HeaderUploadButton = () => {
  const { uploadQueue, queue, isUploading, clearCompleted, clearFinished, globalSpeed, removeQueueItem } = useUpload();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const activeQueue = uploadQueue || queue || [];
  const isWorking = activeQueue.some((i) =>
    ['uploading', 'hashing', 'finalizing', 'queued'].includes(i.status)
  );
  const activeIsUploading =
    typeof isUploading === 'boolean'
      ? isUploading
      : isWorking;
  const activeClear = clearCompleted || clearFinished;

  // Close when download tray opens or global close is dispatched
  useEffect(() => {
    const handleClose = () => setIsOpen(false);
    window.addEventListener('cloudguard:download-tray-opened', handleClose);
    window.addEventListener('cloudguard:close-upload-tray', handleClose);
    window.addEventListener('cloudguard:close-all-trays', handleClose);
    return () => {
      window.removeEventListener('cloudguard:download-tray-opened', handleClose);
      window.removeEventListener('cloudguard:close-upload-tray', handleClose);
      window.removeEventListener('cloudguard:close-all-trays', handleClose);
    };
  }, []);

  // Click outside listener
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const toggleOpen = (e) => {
    e.stopPropagation();
    setIsOpen((prev) => {
      const nextState = !prev;
      if (nextState) {
        // Explicitly close download tray when this opens
        window.dispatchEvent(new CustomEvent('cloudguard:upload-tray-opened'));
      }
      return nextState;
    });
  };

  const activeCount = activeQueue.filter(
    (i) =>
      i.status === 'uploading' ||
      i.status === 'pending' ||
      i.status === 'queued' ||
      i.status === 'hashing' ||
      i.status === 'finalizing' ||
      i.status === 'paused_for_upgrade'
  ).length;

  if (activeQueue.length === 0) return null;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={toggleOpen}
        title="View upload queue"
        className="relative p-2 rounded-lg bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer"
      >
        <UploadCloud className={`w-5 h-5 ${activeIsUploading ? 'animate-pulse text-blue-500' : ''}`} />
        {activeCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white shadow-sm">
            {activeCount}
          </span>
        )}
      </button>

      {/* Upload Dropdown Tray */}
      {isOpen && (
        <div 
          onClick={(e) => e.stopPropagation()}
          className="fixed left-3 right-3 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2.5 sm:w-96 max-h-[75vh] flex flex-col rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl z-50 select-none overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-3.5 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/40">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-neutral-900 dark:text-white">
                {isWorking ? `Uploading (${activeCount} left)` : 'Uploads Complete'}
              </span>
              {isWorking && globalSpeed && (
                <span className="text-xs font-mono font-medium text-neutral-500 dark:text-neutral-400 tracking-tight">
                  • {globalSpeed}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {!isWorking && (
                <button
                  type="button"
                  onClick={clearCompleted}
                  className="text-[11px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white px-2 py-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-white rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4"/>
              </button>
            </div>
          </div>

          {/* Item List */}
          <div className="overflow-y-auto p-2 space-y-1.5 divide-y divide-neutral-100 dark:divide-neutral-800/60 max-h-80">
            {activeQueue.map((item) => (
              <div key={item.id} className="pt-1.5 first:pt-0">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex flex-col min-w-0 flex-1">
                    <span
                      className="font-medium truncate text-neutral-800 dark:text-neutral-200 text-xs"
                      title={item.file?.name || item.name}
                    >
                      {item.file?.name || item.name}
                    </span>
                    {/* Live Uploaded Size vs Total Size */}
                    <span className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 tabular-nums">
                      {item.status === 'uploading' &&
                        `${formatBytes(item.uploadedBytes || 0)} of ${formatBytes(item.file?.size || item.size)}`}
                      {item.status === 'hashing' && `${formatBytes(item.file?.size || item.size)} • Preparing`}
                      {item.status === 'finalizing' && `${formatBytes(item.file?.size || item.size)} • Inspecting security`}
                      {item.status === 'queued' && `${formatBytes(item.file?.size || item.size)} • Queued`}
                      {item.status === 'paused_for_upgrade' && `${formatBytes(item.file?.size || item.size)} • Paused (Upgrade Required)`}
                      {(item.status === 'completed' || item.status === 'clean') && `${formatBytes(item.file?.size || item.size)} • Safe`}
                      {(item.status === 'malicious' || item.status === 'threat_purged') && `${formatBytes(item.file?.size || item.size)} • Deleted`}
                      {item.status === 'error' && `${formatBytes(item.file?.size || item.size)} • ${item.error || 'Failed'}`}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                    <span className="text-[10px] text-neutral-500 dark:text-neutral-400 font-medium tabular-nums">
                      {item.status === 'completed' || item.status === 'clean'
                        ? 'Done'
                        : item.status === 'malicious' || item.status === 'threat_purged'
                        ? 'Deleted'
                        : item.status === 'paused_for_upgrade'
                        ? 'Paused'
                        : `${item.progress || 0}%`}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeQueueItem(item.id)}
                      className="p-0.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 rounded transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {['uploading', 'hashing', 'finalizing'].includes(item.status) && (
                  <div className="w-full bg-neutral-200 dark:bg-neutral-800 h-1 rounded-full overflow-hidden mt-1">
                    <div
                      className={`h-full transition-all duration-150 ${
                        item.status === 'finalizing' ? 'bg-amber-500' : 'bg-blue-600'
                      }`}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
