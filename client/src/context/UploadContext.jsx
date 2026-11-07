import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { UploadCloud, CheckCircle2, AlertTriangle, X, Loader2 } from 'lucide-react';
import { computeFileSHA256 } from '../utils/cryptoHelper';
import { generateThumbnail } from '../utils/thumbnailHelper';
import { useToast } from './ToastContext';
import { API_BASE_URL } from '../config';

const UploadContext = createContext(null);
const MAX_CONCURRENT_UPLOADS = 3;

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
  const [isOpen, setIsOpen] = useState(false);
  const [globalSpeed, setGlobalSpeed] = useState('');
  const dropdownRef = useRef(null);

  const processingIdsRef = useRef(new Set());
  const toastCtx = useToast();

  const toast = {
    error: (msg, opts) => (toastCtx?.error ? toastCtx.error(msg, opts) : console.error(msg)),
    success: (msg, opts) => (toastCtx?.success ? toastCtx.success(msg, opts) : console.log(msg)),
    info: (msg, opts) => (toastCtx?.info ? toastCtx.info(msg, opts) : console.log(msg)),
  };

  // Keep a live ref to queue so the speed timer does not re-trigger on every render
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const speedTrackerRef = useRef({ lastBytes: 0, lastTime: Date.now(), idleTicks: 0 });

  // Close dropdown on outside click or when download tray opens
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleDownloadOpen = () => setIsOpen(false);

    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('cloudguard:download-tray-opened', handleDownloadOpen);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('cloudguard:download-tray-opened', handleDownloadOpen);
    };
  }, []);

  // Check if any items are pending or actively running
  const hasActiveTransfers = queue.some((i) =>
    ['uploading', 'hashing', 'finalizing', 'queued'].includes(i.status)
  );

  // Smooth, rolling upload speed meter that persists through batch image uploads
  useEffect(() => {
    if (!hasActiveTransfers) {
      setGlobalSpeed('');
      speedTrackerRef.current = { lastBytes: 0, lastTime: Date.now(), idleTicks: 0 };
      return;
    }

    const interval = setInterval(() => {
      const totalUploadedBytes = queueRef.current.reduce(
        (sum, item) => sum + (item.uploadedBytes || 0),
        0
      );
      const now = Date.now();
      const timeDiff = (now - speedTrackerRef.current.lastTime) / 1000;

      if (timeDiff >= 0.4) {
        const bytesDiff = totalUploadedBytes - speedTrackerRef.current.lastBytes;

        if (bytesDiff > 0) {
          const bytesPerSec = bytesDiff / timeDiff;
          const speedStr =
            bytesPerSec >= 1024 * 1024
              ? `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
              : `${Math.round(bytesPerSec / 1024)} KB/s`;
          setGlobalSpeed(speedStr);
          speedTrackerRef.current.idleTicks = 0;
        } else {
          // If in between small image chunks, preserve the last speed for up to 1.5s
          speedTrackerRef.current.idleTicks += 1;
          if (speedTrackerRef.current.idleTicks > 3) {
            setGlobalSpeed('');
          }
        }

        speedTrackerRef.current.lastBytes = totalUploadedBytes;
        speedTrackerRef.current.lastTime = now;
      }
    }, 400);

    return () => clearInterval(interval);
  }, [hasActiveTransfers]);

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

  // Worker loop handling concurrency (Google Drive standard: 3 concurrent)
  useEffect(() => {
    const activeUploads = queue.filter(
      (item) =>
        ['hashing', 'uploading', 'finalizing'].includes(item.status) ||
        processingIdsRef.current.has(item.id)
    );

    if (activeUploads.length >= MAX_CONCURRENT_UPLOADS) return;

    const nextItem = queue.find(
      (item) => item.status === 'queued' && !processingIdsRef.current.has(item.id)
    );
    if (!nextItem) return;

    processQueueItem(nextItem);
  }, [queue]);

  const updateItem = (id, updates) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const processQueueItem = async (item) => {
    const { id, file, folderId } = item;
    processingIdsRef.current.add(id);

    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    try {
      updateItem(id, { status: 'hashing', progress: 5, uploadedBytes: 0 });

      // Parallelize thumbnail generation and ticket retrieval
      let ticket;
      let thumbnail = null;
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
          generateThumbnail(file),
        ]);
        ticket = ticketRes.data;
        thumbnail = thumb;
      } catch (err) {
        if (err.response?.status === 403) {
          updateItem(id, {
            status: 'error',
            error: 'Storage quota exceeded',
            progress: 100,
          });
          toast.error(`Not enough vault storage for "${file.name}".`, { id: `quota-${id}` });
          return;
        }
        throw new Error(err.response?.data?.error || 'Failed to acquire upload ticket');
      }

      updateItem(id, { status: 'uploading', progress: 10 });

      const [sha256] = await Promise.all([
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

      // Step 3: Finalize upload with backend, attaching thumbnail
      updateItem(id, { status: 'finalizing', progress: 96, uploadedBytes: file.size });

      const finalizeRes = await axios.post(
        `${API_BASE_URL || ''}/api/files/finalize-upload`,
        {
          fileId: ticket.fileId,
          s3Key: ticket.s3Key,
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
      window.dispatchEvent(new CustomEvent('cloudguard:files-updated'));
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
    }
  };

  const removeQueueItem = (id) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const clearFinished = () => {
    setQueue((prev) =>
      prev.filter((item) => ['uploading', 'hashing', 'finalizing', 'queued'].includes(item.status))
    );
  };

  return (
    <UploadContext.Provider
      value={{
        queue,
        isOpen,
        globalSpeed,
        toggleOpen,
        enqueueFiles,
        removeQueueItem,
        clearFinished,
        dropdownRef,
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
      isOpen: false,
      globalSpeed: '',
      toggleOpen: () => {},
      enqueueFiles: () => {},
      removeQueueItem: () => {},
      clearFinished: () => {},
      dropdownRef: { current: null },
    }
  );
};

/**
 * Top Header Upload Button with Status Badge and Dropdown Tray
 */
export function HeaderUploadButton() {
  const { queue, isOpen, globalSpeed, toggleOpen, removeQueueItem, clearFinished, dropdownRef } =
    useUpload();

  const activeCount = queue.filter((i) =>
    ['uploading', 'hashing', 'finalizing', 'queued'].includes(i.status)
  ).length;
  const isWorking = activeCount > 0;

  if (queue.length === 0) return null;

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      {/* Navbar Icon Button */}
      <button
        onClick={toggleOpen}
        title="Upload Activity"
        type="button"
        className={`relative p-2 rounded-lg transition-colors border cursor-pointer ${
          isWorking
            ? 'bg-blue-500/10 text-blue-500 border-blue-500/30 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800'
            : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 border-transparent dark:text-neutral-400 dark:hover:text-white dark:hover:bg-neutral-800'
        }`}
      >
        <UploadCloud className={`w-5 h-5 ${isWorking ? 'animate-bounce' : ''}`} />
        {isWorking && (
          <span className="absolute -top-1 -right-1 px-1.5 py-0.2 text-[10px] font-bold bg-blue-600 text-white rounded-full shadow-sm">
            {activeCount}
          </span>
        )}
      </button>

      {/* Dropdown Flyout */}
      {isOpen && (
        <div className="fixed sm:absolute top-16 sm:top-full left-4 sm:left-auto right-4 sm:right-0 mt-2 sm:w-96 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-2xl z-50 overflow-hidden text-neutral-900 dark:text-white text-xs animate-in fade-in zoom-in-95">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/40">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">
                {isWorking ? `Uploading (${activeCount} left)` : 'Uploads Complete'}
              </span>
              {/* Unboxed speed text adaptive to light and dark theme */}
              {isWorking && globalSpeed && (
                <span className="text-[11px] font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
                  • {globalSpeed}
                </span>
              )}
            </div>
            {!isWorking && (
              <button
                onClick={clearFinished}
                type="button"
                className="text-[11px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors cursor-pointer"
              >
                Clear all
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-72 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800/60">
            {queue.map((item) => (
              <div
                key={item.id}
                className="p-3 hover:bg-neutral-50/70 dark:hover:bg-neutral-800/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-medium truncate text-neutral-800 dark:text-neutral-200" title={item.name}>
                      {item.name}
                    </span>
                    {/* Live Uploaded Size vs Total Size */}
                    <span className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 tabular-nums">
                      {item.status === 'uploading' &&
                        `${formatBytes(item.uploadedBytes || 0)} of ${formatBytes(item.size)}`}
                      {item.status === 'hashing' && `${formatBytes(item.size)} • Preparing`}
                      {item.status === 'finalizing' && `${formatBytes(item.size)} • Inspecting security`}
                      {item.status === 'queued' && `${formatBytes(item.size)} • Queued`}
                      {item.status === 'clean' && formatBytes(item.size)}
                      {item.status === 'unverified' && `${formatBytes(item.size)} • Unverified`}
                      {item.status === 'threat_purged' && `${formatBytes(item.size)} • Threat blocked`}
                      {item.status === 'error' && `${formatBytes(item.size)} • ${item.error || 'Failed'}`}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                    {item.status === 'clean' && (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Safe
                      </span>
                    )}
                    {item.status === 'unverified' && (
                      <span className="flex items-center gap-1 text-amber-500 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5" /> Unverified
                      </span>
                    )}
                    {item.status === 'threat_purged' && (
                      <span className="flex items-center gap-1 text-red-500 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5" /> Deleted
                      </span>
                    )}
                    {item.status === 'error' && (
                      <span className="text-red-500 font-medium">Failed</span>
                    )}
                    {item.status === 'uploading' && (
                      <span className="text-blue-500 font-medium tabular-nums flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> {item.progress}%
                      </span>
                    )}
                    {item.status === 'hashing' && (
                      <span className="text-neutral-400 font-medium">Hashing...</span>
                    )}
                    {item.status === 'finalizing' && (
                      <span className="text-amber-500 font-medium flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Scanning
                      </span>
                    )}
                    {item.status === 'queued' && (
                      <span className="text-neutral-400 font-medium">Waiting</span>
                    )}

                    <button
                      onClick={() => removeQueueItem(item.id)}
                      type="button"
                      className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 rounded transition-colors cursor-pointer"
                      title="Dismiss"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                {['uploading', 'hashing', 'finalizing'].includes(item.status) && (
                  <div className="w-full bg-neutral-200 dark:bg-neutral-800 h-1 rounded-full overflow-hidden mt-1">
                    <div
                      className={`h-full transition-all duration-150 rounded-full ${
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
}
