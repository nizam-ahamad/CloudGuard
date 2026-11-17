import React, { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { Upload, UploadCloud, CheckCircle2, AlertTriangle, X, Loader2, Folder } from 'lucide-react';
import { computeFileSHA256 } from '../utils/cryptoHelper';
import { generateMediaThumbnail } from '../utils/thumbnailHelper';
import { useToast } from './ToastContext';
import { API_BASE_URL } from '../config';

const UploadContext = createContext(null);
// Concurrency limits: Mobile/iOS is strictly limited to 2 to prevent memory pressure
// and dropped temporary file handles from iOS Photo Library, while desktop gets 4 streams.
const isMobileDevice = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
const MAX_CONCURRENT_UPLOADS = isMobileDevice ? 2 : 4;
const MULTIPART_THRESHOLD = 25 * 1024 * 1024; // 25 MB
const MULTIPART_WORKERS = 4;
const MAX_PART_RETRIES = 3; // Up to 3 retries with backoff on network stall/timeout
const TERMINAL_STATUSES = new Set(['clean', 'threat_purged', 'error']);

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

// Format seconds into readable estimated time remaining (ETA)
export function formatEta(seconds) {
  if (typeof seconds !== 'number' || seconds <= 0 || !isFinite(seconds)) {
    return 'Estimating time...';
  }
  const s = Math.round(seconds);
  if (s < 60) {
    return `~${s}s left`;
  }
  if (s < 3600) {
    const mins = Math.floor(s / 60);
    const remSec = s % 60;
    return remSec > 0 ? `~${mins}m ${remSec}s left` : `~${mins}m left`;
  }
  const hours = Math.floor(s / 3600);
  const remMins = Math.floor((s % 3600) / 60);
  return remMins > 0 ? `~${hours}h ${remMins}m left` : `~${hours}h left`;
}

// Safely generate thumbnail with 1500ms max timeout so slow mobile image/canvas decodes never stall upload startup
export function generateThumbnailWithTimeout(file) {
  if (!file) return Promise.resolve(null);
  return Promise.race([
    generateMediaThumbnail(file),
    new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
  ]).catch(() => null);
}

// Await network restoration and tab foregrounding for seamless background resilience
export function waitForOnlineAndVisible(abortSignal) {
  if (
    (typeof navigator === 'undefined' || navigator.onLine !== false) &&
    (typeof document === 'undefined' || document.visibilityState !== 'hidden')
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let cleanup = null;

    const checkState = () => {
      const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
      const isVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
      if (isOnline && isVisible) {
        if (cleanup) cleanup();
        resolve();
      }
    };

    const abortHandler = () => {
      if (cleanup) cleanup();
      reject(new Error('Upload cancelled while paused'));
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        return reject(new Error('Upload cancelled while paused'));
      }
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    }

    const onlineHandler = () => checkState();
    const visibilityHandler = () => checkState();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', onlineHandler);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', visibilityHandler);
    }

    cleanup = () => {
      if (abortSignal) {
        abortSignal.removeEventListener('abort', abortHandler);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onlineHandler);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityHandler);
      }
    };
  });
}

// Compute queue-level metrics with clamped bytes to guarantee non-negative remainingBytes
function computeQueueMetrics(items) {
  if (!items || !items.length) {
    return {
      totalBytes: 0,
      uploadedBytes: 0,
      remainingBytes: 0,
      totalFiles: 0,
      completedCount: 0,
      remainingFiles: 0,
      activeCount: 0,
      queuedCount: 0,
    };
  }

  let totalBytes = 0;
  let uploadedBytes = 0;
  let completedCount = 0;
  let activeCount = 0;
  let queuedCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const size = item.file?.size || item.size || 0;
    totalBytes += size;

    if (TERMINAL_STATUSES.has(item.status) || item.status === 'completed' || item.status === 'malicious' || item.status === 'failed') {
      completedCount++;
      uploadedBytes += size;
    } else if (['uploading', 'hashing', 'finalizing'].includes(item.status)) {
      activeCount++;
      const currentUploaded = typeof item.uploadedBytes === 'number' ? item.uploadedBytes : 0;
      uploadedBytes += Math.min(size, Math.max(0, currentUploaded));
    } else if (['queued', 'pending', 'paused_for_upgrade'].includes(item.status)) {
      queuedCount++;
    }
  }

  const remainingBytes = Math.max(0, totalBytes - uploadedBytes);
  const remainingFiles = Math.max(0, items.length - completedCount);

  return {
    totalBytes,
    uploadedBytes,
    remainingBytes,
    totalFiles: items.length,
    completedCount,
    remainingFiles,
    activeCount,
    queuedCount,
  };
}

export function UploadProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const uploadQueue = queue;
  const [isOpen, setIsOpen] = useState(false);
  const [globalSpeed, setGlobalSpeed] = useState('');
  const [etaSeconds, setEtaSeconds] = useState(null);
  const [quotaUpgradeState, setQuotaUpgradeState] = useState(null);
  const [folderPrep, setFolderPrep] = useState(null);
  const dropdownRef = useRef(null);

  const processingIdsRef = useRef(new Set());
  const inFlightIdsRef = useRef(new Set());
  const activeControllersRef = useRef(new Map());
  const abortControllersRef = activeControllersRef;
  const activeTicketsRef = useRef(new Map());
  const batchCancelledRef = useRef(false);
  const batchTotalRef = useRef(0);
  const batchStartTimeRef = useRef(0);
  const currentBatchCompletedRef = useRef(0);
  const currentBatchFailedRef = useRef(0);
  const emaBytesPerSecRef = useRef(0);
  const lastProgressSampleRef = useRef({ time: Date.now(), bytes: 0 });
  const speedSamplesRef = useRef([]);
  const lastActiveSpeedRef = useRef(0);
  const lastEventDispatchRef = useRef(0);
  const eventDebounceTimerRef = useRef(null);
  const cancelledTicketsRef = useRef(new Set());
  const cancelledIdsRef = useRef(new Set());
  const wakeLockRef = useRef(null);
  const toastCtx = useToast();

  const notifyBackendCancel = useCallback((ticket) => {
    if (!ticket || (!ticket.fileId && !ticket.s3Key)) return;
    const key = String(ticket.fileId || ticket.s3Key);
    if (cancelledTicketsRef.current.has(key)) return;

    cancelledTicketsRef.current.add(key);
    for (const [id, t] of activeTicketsRef.current.entries()) {
      if ((ticket.fileId && t.fileId === ticket.fileId) || (ticket.s3Key && t.s3Key === ticket.s3Key)) {
        activeTicketsRef.current.delete(id);
      }
    }

    const token = localStorage.getItem('token');
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
    axios
      .post(
        `${API_BASE_URL || ''}/api/files/cancel-upload`,
        {
          fileId: ticket.fileId,
          s3Key: ticket.s3Key,
          uploadId: ticket.uploadId || null,
        },
        { headers: authHeaders }
      )
      .catch(() => {});
  }, []);

  const notifyCancelBackend = notifyBackendCancel;

  const toast = {
    error: (msg, opts) => (toastCtx?.error ? toastCtx.error(msg, opts) : console.error(msg)),
    success: (msg, opts) => (toastCtx?.success ? toastCtx.success(msg, opts) : console.log(msg)),
    info: (msg, opts) => (toastCtx?.info ? toastCtx.info(msg, opts) : console.log(msg)),
  };

  const dispatchThrottledUpdates = useCallback((folderId, immediate = false) => {
    if (immediate) {
      if (eventDebounceTimerRef.current) {
        clearTimeout(eventDebounceTimerRef.current);
        eventDebounceTimerRef.current = null;
      }
      lastEventDispatchRef.current = Date.now();
      window.dispatchEvent(new CustomEvent('cloudguard:storage-updated'));
      window.dispatchEvent(new CustomEvent('cloudguard:files-updated', { detail: { folderId } }));
      return;
    }

    // Trailing debounce (2000ms): reset timer on each completed file while others are uploading/scanning
    if (eventDebounceTimerRef.current) {
      clearTimeout(eventDebounceTimerRef.current);
    }
    eventDebounceTimerRef.current = setTimeout(() => {
      eventDebounceTimerRef.current = null;
      lastEventDispatchRef.current = Date.now();
      window.dispatchEvent(new CustomEvent('cloudguard:storage-updated'));
      window.dispatchEvent(new CustomEvent('cloudguard:files-updated', { detail: { folderId } }));
    }, 2000);
  }, []);

  // Cleanup trailing debounce timer on unmount
  useEffect(() => {
    return () => {
      if (eventDebounceTimerRef.current) {
        clearTimeout(eventDebounceTimerRef.current);
        eventDebounceTimerRef.current = null;
      }
    };
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch {}
      wakeLockRef.current = null;
    }
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    if (wakeLockRef.current && !wakeLockRef.current.released) return;

    // Only request when active transfers exist and total queue size >= 50 MB
    const metrics = computeQueueMetrics(queueRef.current || []);
    if (metrics.activeCount === 0 && metrics.queuedCount === 0) return;
    if (metrics.totalBytes < 50 * 1024 * 1024) return;

    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      wakeLockRef.current.addEventListener('release', () => {
        wakeLockRef.current = null;
      });
    } catch {
      wakeLockRef.current = null;
    }
  }, []);

  // Screen Wake Lock visibility-change re-acquisition and lifecycle cleanup
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const metrics = computeQueueMetrics(queueRef.current || []);
        if ((metrics.activeCount > 0 || metrics.queuedCount > 0) && metrics.totalBytes >= 50 * 1024 * 1024) {
          acquireWakeLock();
        }
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      releaseWakeLock();
    };
  }, [acquireWakeLock, releaseWakeLock]);

  // Accidental Tab-Close / Reload Guard while uploads are actively transferring
  useEffect(() => {
    const hasActive = queue.some((i) =>
      ['uploading', 'hashing', 'finalizing'].includes(i.status)
    );

    if (!hasActive) return;

    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [queue]);

  const startFolderPrep = useCallback(({ folderName, createdCount = 0, totalFolders = 0, totalFiles = 0, abortController = null }) => {
    setFolderPrep({
      folderName: folderName || 'Folder',
      createdCount,
      totalFolders,
      totalFiles,
      abortController,
      startTime: Date.now(),
    });
    setIsOpen(true);
    window.dispatchEvent(new CustomEvent('cloudguard:upload-tray-opened'));
  }, []);

  const updateFolderPrep = useCallback(({ createdCount, totalFolders, currentFolderName }) => {
    setFolderPrep((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        createdCount: createdCount !== undefined ? createdCount : prev.createdCount,
        totalFolders: totalFolders !== undefined ? totalFolders : prev.totalFolders,
        currentFolderName: currentFolderName || prev.currentFolderName,
      };
    });
  }, []);

  const clearFolderPrep = useCallback(() => {
    setFolderPrep(null);
  }, []);

  const cancelFolderPrep = useCallback(() => {
    setFolderPrep((prev) => {
      if (prev?.abortController) {
        try {
          prev.abortController.abort();
        } catch (e) {
          // ignore
        }
      }
      return null;
    });
  }, []);

  // Keep a live ref to queue so the speed timer does not re-trigger on every render
  const queueRef = useRef(uploadQueue);
  useEffect(() => {
    queueRef.current = uploadQueue;
  }, [uploadQueue]);

  const trackByteSpeedTick = useCallback(() => {
    const now = Date.now();
    const metrics = computeQueueMetrics(queueRef.current || []);
    const currentUploaded = metrics.uploadedBytes;

    const hasActiveTransfers = (queueRef.current || []).some((i) =>
      ['uploading', 'hashing', 'finalizing'].includes(i.status)
    );

    if (!hasActiveTransfers) {
      setGlobalSpeed('');
      lastActiveSpeedRef.current = 0;
      emaBytesPerSecRef.current = 0;
      speedSamplesRef.current = [];
      return;
    }

    // Sliding 2-second window of active bytes transferred
    const windowMs = 2000;
    const samples = speedSamplesRef.current.filter((s) => now - s.time <= windowMs);
    samples.push({ time: now, bytes: currentUploaded });
    speedSamplesRef.current = samples;

    const oldest = samples[0];
    const deltaSec = (now - oldest.time) / 1000;
    const deltaBytes = Math.max(0, currentUploaded - oldest.bytes);

    if (deltaSec >= 0.4 && deltaBytes > 0) {
      const activeWindowSpeed = deltaBytes / deltaSec;
      emaBytesPerSecRef.current =
        emaBytesPerSecRef.current > 0
          ? 0.35 * activeWindowSpeed + 0.65 * emaBytesPerSecRef.current
          : activeWindowSpeed;
      lastActiveSpeedRef.current = emaBytesPerSecRef.current;

      const speed = emaBytesPerSecRef.current;
      const speedStr =
        speed >= 1024 * 1024
          ? `${(speed / (1024 * 1024)).toFixed(1)} MB/s`
          : `${Math.round(speed / 1024)} KB/s`;
      setGlobalSpeed(speedStr);
      lastProgressSampleRef.current = { time: now, bytes: currentUploaded };
    } else if (hasActiveTransfers) {
      const anyFinalizing = (queueRef.current || []).some((i) => i.status === 'finalizing');
      const anyHashing = (queueRef.current || []).some((i) => i.status === 'hashing');

      if (anyFinalizing) {
        setGlobalSpeed('Finalizing...');
      } else if (anyHashing) {
        setGlobalSpeed('Scanning file...');
      } else if (lastActiveSpeedRef.current > 0) {
        const speed = lastActiveSpeedRef.current;
        const speedStr =
          speed >= 1024 * 1024
            ? `${(speed / (1024 * 1024)).toFixed(1)} MB/s`
            : `${Math.round(speed / 1024)} KB/s`;
        setGlobalSpeed(speedStr);
      } else {
        setGlobalSpeed('Uploading...');
      }
    }
  }, []);

  // Hybrid EMA ETA Engine: 500ms ticker with cold-start and positive-only countdown
  useEffect(() => {
    const hasActiveTransfers = queue.some((i) =>
      ['uploading', 'hashing', 'finalizing', 'queued', 'pending'].includes(i.status)
    );

    if (!hasActiveTransfers) {
      releaseWakeLock();
      setEtaSeconds(null);
      setGlobalSpeed('');
      batchStartTimeRef.current = 0;
      emaBytesPerSecRef.current = 0;
      lastActiveSpeedRef.current = 0;
      speedSamplesRef.current = [];
      return;
    }

    acquireWakeLock();

    if (batchStartTimeRef.current === 0) {
      batchStartTimeRef.current = Date.now();
      const initialMetrics = computeQueueMetrics(queueRef.current || []);
      lastProgressSampleRef.current = { time: Date.now(), bytes: initialMetrics.uploadedBytes };
      speedSamplesRef.current = [{ time: Date.now(), bytes: initialMetrics.uploadedBytes }];
      setEtaSeconds(-1);
    }

    const interval = setInterval(() => {
      trackByteSpeedTick();

      const metrics = computeQueueMetrics(queueRef.current || []);
      if (metrics.activeCount === 0 && metrics.queuedCount === 0) {
        releaseWakeLock();
        setEtaSeconds(null);
        setGlobalSpeed('');
        batchStartTimeRef.current = 0;
        emaBytesPerSecRef.current = 0;
        lastActiveSpeedRef.current = 0;
        speedSamplesRef.current = [];
        return;
      }

      const now = Date.now();
      const elapsedSec = (now - batchStartTimeRef.current) / 1000;
      const speed = emaBytesPerSecRef.current || lastActiveSpeedRef.current;
      const finishedCount = metrics.completedCount;

      // Show "Estimating time..." (etaSeconds = -1) only during the first 2 seconds before speed > 0 and finishedCount === 0
      if (elapsedSec < 2 && speed <= 0 && finishedCount === 0) {
        setEtaSeconds(-1);
      } else if (speed > 0 || finishedCount >= 1) {
        const effectiveSpeed = speed > 0 ? speed : (elapsedSec > 0 ? metrics.uploadedBytes / elapsedSec : 0);
        if (effectiveSpeed > 0) {
          const rawEta = Math.max(0, Math.ceil(metrics.remainingBytes / effectiveSpeed + metrics.remainingFiles * 0.4));
          setEtaSeconds(rawEta);
        } else {
          setEtaSeconds(-1);
        }
      } else {
        setEtaSeconds(-1);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [queue, trackByteSpeedTick]);

  const toggleOpen = () => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        window.dispatchEvent(new CustomEvent('cloudguard:upload-tray-opened'));
      }
      return next;
    });
  };

  const enqueueFiles = useCallback(async (files, defaultFolderId = null) => {
    if (!files || files.length === 0) return;
    batchCancelledRef.current = false;

    const fileList = Array.from(files);
    const currentActiveCount = (queueRef.current || []).filter((i) =>
      ['uploading', 'hashing', 'finalizing', 'queued', 'pending'].includes(i.status)
    ).length;
    if (currentActiveCount === 0) {
      currentBatchCompletedRef.current = 0;
      currentBatchFailedRef.current = 0;
    }
    batchTotalRef.current = Math.max(batchTotalRef.current, fileList.length, currentActiveCount + fileList.length);

    let emptyFilesCount = 0;
    const newItems = fileList.map((item) => {
      // Support raw File objects as well as { file, targetFolderId } or { file, folderId } wrappers
      const actualFile = item?.file ? item.file : item;
      const resolvedFolderId = item?.targetFolderId !== undefined
        ? item.targetFolderId
        : (item?.folderId !== undefined ? item.folderId : (defaultFolderId || null));
      const fileSize = actualFile?.size || 0;
      const isEmpty = !actualFile || fileSize === 0;

      if (isEmpty) {
        emptyFilesCount += 1;
      }

      return {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file: actualFile,
        name: actualFile?.name || 'file',
        size: fileSize,
        folderId: resolvedFolderId,
        status: isEmpty ? 'error' : 'queued', // Reject 0-byte files immediately so they never upload or finalize as Safe
        progress: isEmpty ? 100 : 0,
        error: isEmpty ? 'File is empty (0 bytes) or could not be read from device' : null,
        uploadedBytes: 0,
      };
    });

    if (emptyFilesCount > 0) {
      currentBatchFailedRef.current += emptyFilesCount;
      toast.error(
        emptyFilesCount === 1
          ? 'File is empty (0 bytes) or could not be read from device'
          : `${emptyFilesCount} files are empty (0 bytes) or could not be read from device`
      );
    }

    // Materialize iOS files <= 25 MB immediately on selection in sequential batches of 3
    // Once materialized as an in-memory Blob/File, iOS Safari cannot revoke temporary Photo Library handles
    if (isIOS) {
      const mobileItemsToMaterialize = newItems.filter(
        (it) => it.status === 'queued' && it.file && it.size > 0 && it.size <= 25 * 1024 * 1024
      );
      for (let i = 0; i < mobileItemsToMaterialize.length; i += 3) {
        const batch = mobileItemsToMaterialize.slice(i, i + 3);
        await Promise.all(
          batch.map(async (queueItem) => {
            try {
              const original = queueItem.file;
              const buf = await original.arrayBuffer();
              if (buf && buf.byteLength > 0) {
                let safeBlob;
                try {
                  safeBlob = new File([buf], queueItem.name, { type: original.type });
                } catch {
                  safeBlob = new Blob([buf], { type: original.type });
                  safeBlob.name = queueItem.name;
                }
                safeBlob._materialized = true;
                queueItem.file = safeBlob;
              }
            } catch (matErr) {
              console.warn('[Photo Library Materialization Warning]:', matErr.message);
            }
          })
        );
      }
    }

    setQueue((prev) => [...prev, ...newItems]);
    setIsOpen(true);
  }, []);

  // Worker loop enforcing mobile concurrency: max 2 (and 1 when uploading files > 25 MB)
  useEffect(() => {
    if (batchCancelledRef.current) return;

    const activeItems = queue.filter((item) =>
      ['hashing', 'uploading', 'finalizing'].includes(item.status)
    );
    const activeCount = Math.max(activeItems.length, inFlightIdsRef.current.size);

    const queuedItems = queue.filter(
      (item) =>
        (item.status === 'queued' || item.status === 'pending') &&
        !processingIdsRef.current.has(item.id) &&
        !inFlightIdsRef.current.has(item.id)
    );

    if (activeCount === 0 && queuedItems.length === 0) {
      batchStartTimeRef.current = 0;
      emaBytesPerSecRef.current = 0;
      return;
    }

    // Cap MAX_CONCURRENT_UPLOADS = 2 on mobile (and 1 when uploading files > 25 MB)
    const hasActiveLargeFile = activeItems.some(
      (item) => (item.file?.size || item.size || 0) > 25 * 1024 * 1024
    );

    const effectiveMaxConcurrent = isMobileDevice
      ? (hasActiveLargeFile ? 1 : 2)
      : 4;

    const slotsAvailable = Math.max(0, effectiveMaxConcurrent - activeCount);
    if (slotsAvailable > 0 && queuedItems.length > 0) {
      const itemsToStart = [];
      for (const item of queuedItems) {
        if (itemsToStart.length >= slotsAvailable) break;
        const itemSize = item.file?.size || item.size || 0;
        if (isMobileDevice && itemSize > 25 * 1024 * 1024 && (activeCount + itemsToStart.length) > 0) {
          // If candidate is a large file on mobile, wait until all active streams finish
          break;
        }
        itemsToStart.push(item);
      }

      itemsToStart.forEach((item) => {
        inFlightIdsRef.current.add(item.id);
        processQueueItem(item);
      });
    }
  }, [queue]);

  const updateItem = useCallback((id, updates) => {
    setQueue((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        if (TERMINAL_STATUSES.has(item.status)) {
          if (updates.status && !TERMINAL_STATUSES.has(updates.status)) return item;
          if (!updates.status) return item;
        }
        return { ...item, ...updates };
      })
    );
  }, []);

  const uploadLargeFileMultipart = async ({ id, file, folderId, headers, updateItem, signal }) => {
    // 1. Acquire multipart session + 512px thumbnail in parallel
    let isAborted = false;
    const abortController = new AbortController();
    activeControllersRef.current.set(id, abortController);

    if (signal) {
      if (signal.aborted) {
        isAborted = true;
        abortController.abort();
      } else {
        signal.addEventListener('abort', () => {
          isAborted = true;
          abortController.abort();
        }, { once: true });
      }
    }

    if (batchCancelledRef.current || cancelledIdsRef.current.has(id) || abortController.signal.aborted || isAborted) {
      throw new Error('Upload cancelled');
    }

    updateItem(id, { status: 'uploading', progress: 0, uploadedBytes: 0, statusLabel: 'Starting...' });

    let initRes = null;
    let thumbnail = null;
    const thumbPromise = generateThumbnailWithTimeout(file);

    let initAttempt = 0;
    const MAX_INIT_RETRIES = 2; // initial + 2 retries
    while (initAttempt <= MAX_INIT_RETRIES) {
      if (batchCancelledRef.current || cancelledIdsRef.current.has(id) || abortController.signal.aborted || isAborted) {
        throw new Error('Upload cancelled');
      }
      try {
        initRes = await axios.post(
          `${API_BASE_URL || ''}/api/files/multipart/init`,
          {
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || 'application/octet-stream',
            folderId: folderId || null,
          },
          {
            headers,
            signal: abortController.signal,
            timeout: 15000, // 15s timeout prevents mobile packet drops from freezing at 5%
          }
        );
        break;
      } catch (initErr) {
        if (
          batchCancelledRef.current ||
          cancelledIdsRef.current.has(id) ||
          axios.isCancel(initErr) ||
          initErr?.name === 'CanceledError' ||
          initErr?.name === 'AbortError' ||
          initErr?.code === 'ERR_CANCELED' ||
          abortController.signal.aborted
        ) {
          throw initErr;
        }
        if (initErr.response?.status === 403) {
          const quotaError = new Error('Storage quota exceeded');
          quotaError.isQuota = true;
          quotaError.errorData = initErr.response?.data;
          throw quotaError;
        }
        initAttempt += 1;
        const isNetworkOrTimeout =
          !initErr.response ||
          initErr.code === 'ECONNABORTED' ||
          initErr.message?.includes('timeout') ||
          initErr.response?.status >= 500;
        if (initAttempt > MAX_INIT_RETRIES || !isNetworkOrTimeout) {
          throw new Error(initErr.response?.data?.error || initErr.message || 'Failed to initialize multipart upload');
        }
        console.warn(`[Multipart Init Retry] Attempt ${initAttempt} failed, retrying in 1s...`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    thumbnail = await Promise.race([
      thumbPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 500)),
    ]).catch(() => null);

    const { fileId, s3Key, uploadId, partSize, chunkSize, partUrls } = initRes.data;
    const effectivePartSize = partSize || chunkSize || (file.size >= 250 * 1024 * 1024 ? 25 * 1024 * 1024 : 10 * 1024 * 1024);
    activeTicketsRef.current.set(id, { fileId, s3Key, uploadId });

    // If batch was cancelled while multipart/init was in-flight, immediately abort the B2 session
    if (batchCancelledRef.current || cancelledIdsRef.current.has(id) || abortController.signal.aborted || isAborted) {
      isAborted = true;
      abortController.abort();
      notifyBackendCancel({ fileId, s3Key, uploadId });
      throw new Error('Upload cancelled');
    }

    let completedBytes = 0;
    const inFlightBytesRef = { current: {} };
    const completedParts = new Array(partUrls.length);

    let lastProgressTime = 0;
    const syncAggregateProgress = () => {
      if (isAborted || abortController.signal.aborted) return;
      const inFlightTotal = Object.values(inFlightBytesRef.current).reduce((a, b) => a + (b || 0), 0);
      const totalUploadedBytes = Math.min(file.size, completedBytes + inFlightTotal);
      const percent = file.size > 0 ? Math.min(99, Math.round((totalUploadedBytes / file.size) * 100)) : 0;
      const now = Date.now();
      if (now - lastProgressTime >= 250 || percent >= 99 || (lastProgressTime === 0 && totalUploadedBytes > 0)) {
        lastProgressTime = now;
        updateItem(id, {
          progress: percent,
          uploadedBytes: totalUploadedBytes,
          statusLabel: null,
        });
        trackByteSpeedTick();
      }
    };

    const onPartProgress = (partNumber, loaded) => {
      inFlightBytesRef.current[partNumber] = loaded;
      syncAggregateProgress();
    };

    const uploadSinglePartWithRetry = async (partMeta, index) => {
      const partNumber = partMeta.partNumber || index + 1;
      const start = index * effectivePartSize;
      const end = Math.min(start + effectivePartSize, file.size);
      const partBytes = end - start;

      let currentPartMeta = partMeta;
      let targetUrl = currentPartMeta?.uploadUrl || currentPartMeta?.signedUrl;
      let attempt = 0;
      let backgroundResumeCycles = 0;
      const MAX_BACKGROUND_RESUMES = 10;

      while (attempt < MAX_PART_RETRIES) {
        if (isAborted || abortController.signal.aborted) throw new Error('Multipart upload aborted');
        try {
          // Re-slice freshly per attempt to ensure handle remains valid
          const chunkBlob = file.slice(start, end);
          if (!chunkBlob || chunkBlob.size === 0) {
            throw new Error('File chunk is empty (0 bytes) or could not be read from device');
          }

          // Stream Blob slices directly without arrayBuffer() for files > 25 MB (and on Android):
          // Keep arrayBuffer() materialization ONLY for iOS files <= 25 MB where iOS revokes Photo Library handles
          let bodyToSend = chunkBlob;
          if (isIOS && file.size <= 25 * 1024 * 1024) {
            const chunkBuf = await chunkBlob.arrayBuffer();
            if (chunkBuf.byteLength === 0) {
              throw new Error('iOS revoked file access — please retry this file');
            }
            bodyToSend = chunkBuf;
          }

          if (!targetUrl) {
            const signRes = await axios.post(
              `${API_BASE_URL || ''}/api/files/multipart/sign-part`,
              { s3Key, uploadId, partNumber },
              { headers, signal: abortController.signal }
            );
            targetUrl = signRes.data?.uploadUrl || signRes.data?.signedUrl;
            currentPartMeta.uploadUrl = targetUrl;
          }

          inFlightBytesRef.current[partNumber] = 0;

          // Native XMLHttpRequest provides zero-copy streaming and true real-time onprogress byte ticks
          const eTag = await new Promise((resolve, reject) => {
            if (isAborted || abortController.signal.aborted) {
              return reject(new Error('Multipart upload aborted'));
            }

            const xhr = new XMLHttpRequest();
            xhr.open('PUT', targetUrl, true);
            xhr.timeout = 60000; // 60s timeout per chunk prevents mobile socket hang
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');

            const abortHandler = () => {
              try { xhr.abort(); } catch {}
              reject(new Error('Multipart upload aborted'));
            };

            abortController.signal.addEventListener('abort', abortHandler, { once: true });

            // Attach xhr.upload.onprogress BEFORE calling xhr.send()
            xhr.upload.onprogress = (e) => {
              if (isAborted || abortController.signal.aborted || batchCancelledRef.current || cancelledIdsRef.current.has(id)) return;
              if (e.lengthComputable) {
                onPartProgress(partNumber, e.loaded);
              }
            };

            xhr.onload = () => {
              abortController.signal.removeEventListener('abort', abortHandler);
              if (xhr.status >= 200 && xhr.status < 300) {
                const rawEtag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag');
                if (!rawEtag) {
                  return reject(new Error('Bucket CORS missing ExposeHeaders: ["ETag"]'));
                }
                resolve(rawEtag);
              } else {
                const err = new Error(`Chunk upload failed with HTTP ${xhr.status}`);
                err.status = xhr.status;
                reject(err);
              }
            };

            xhr.onerror = () => {
              abortController.signal.removeEventListener('abort', abortHandler);
              const err = new Error('Chunk upload network error');
              reject(err);
            };

            xhr.ontimeout = () => {
              abortController.signal.removeEventListener('abort', abortHandler);
              const err = new Error('Chunk upload timed out after 60s');
              err.code = 'ECONNABORTED';
              reject(err);
            };

            xhr.onabort = () => {
              abortController.signal.removeEventListener('abort', abortHandler);
              reject(new Error('Multipart upload aborted'));
            };

            xhr.send(bodyToSend);
          });

          completedBytes += partBytes;
          delete inFlightBytesRef.current[partNumber];
          completedParts[index] = { PartNumber: partNumber, ETag: eTag };
          syncAggregateProgress();
          return;
        } catch (err) {
          delete inFlightBytesRef.current[partNumber];
          syncAggregateProgress();

          if (
            isAborted ||
            abortController.signal.aborted ||
            axios.isCancel(err) ||
            err?.name === 'CanceledError' ||
            err?.name === 'AbortError' ||
            err?.code === 'ERR_CANCELED'
          ) {
            throw err;
          }

          const status = err.status || err.response?.status;

          // 1. Expired Presigned URL Fallback (HTTP 403)
          if (status === 403) {
            console.warn(`[Multipart Part ${partNumber}] Presigned URL expired (HTTP 403). Refreshing signed URL...`);
            try {
              const signRes = await axios.post(
                `${API_BASE_URL || ''}/api/files/multipart/sign-part`,
                { s3Key, uploadId, partNumber },
                { headers, signal: abortController.signal }
              );
              const refreshedUrl = signRes.data?.uploadUrl || signRes.data?.signedUrl;
              if (refreshedUrl) {
                targetUrl = refreshedUrl;
                currentPartMeta.uploadUrl = refreshedUrl;
                continue;
              }
            } catch (refreshErr) {
              console.error(`[Multipart Part ${partNumber}] Failed to refresh presigned URL:`, refreshErr);
            }
          }

          // 2. Background Pause / Network Auto-Resume
          const isSuspendedOrOffline =
            (typeof document !== 'undefined' && document.visibilityState === 'hidden') ||
            (typeof navigator !== 'undefined' && navigator.onLine === false) ||
            err.code === 'ERR_NETWORK_IO_SUSPENDED' ||
            err.code === 'ERR_INTERNET_DISCONNECTED' ||
            err.message?.includes('ERR_NETWORK_IO_SUSPENDED') ||
            err.message?.includes('ERR_INTERNET_DISCONNECTED');

          if (isSuspendedOrOffline && backgroundResumeCycles < MAX_BACKGROUND_RESUMES) {
            backgroundResumeCycles += 1;
            updateItem(id, { statusLabel: 'Paused (in background) — auto-resuming...' });
            try {
              await waitForOnlineAndVisible(abortController.signal);
            } catch (waitErr) {
              throw waitErr;
            }
            updateItem(id, { statusLabel: null });
            await new Promise((r) => setTimeout(r, 300));
            continue;
          }

          // 3. Regular Transient Network Retry
          const isTransient =
            !status ||
            err.code === 'ECONNABORTED' ||
            err.message?.includes('timeout') ||
            err.message?.includes('network error') ||
            status === 503 ||
            status === 429 ||
            status === 500 ||
            status === 502 ||
            status === 504;

          if (!isTransient) {
            isAborted = true;
            abortController.abort();
            throw err;
          }

          attempt += 1;
          if (attempt >= MAX_PART_RETRIES) {
            isAborted = true;
            abortController.abort();
            throw err;
          }

          // Jittered exponential backoff for connection recovery (up to 3 retries)
          const backoffMs =
            Math.min(8000, 1000 * Math.pow(2, attempt - 1)) +
            Math.floor(Math.random() * 500);
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }
    };

    try {
      // 2. Strict 4-Worker Concurrency Pool (Never more than 4 chunk PUT requests in flight at once)
      const CONCURRENCY = 4;
      const workerCount = Math.min(CONCURRENCY, partUrls.length);
      let cursor = 0;
      const workers = Array.from({ length: workerCount }, async () => {
        while (!isAborted && !abortController.signal.aborted && cursor < partUrls.length) {
          const idx = cursor++;
          if (idx >= partUrls.length) break;
          await uploadSinglePartWithRetry(partUrls[idx], idx);
        }
      });
      await Promise.all(workers);

      const hashPromise = computeFileSHA256(file);
      const sha256 = await Promise.race([
        hashPromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 500)),
      ]).catch(() => null);

      // 3. Complete multipart assembly on S3 / Backblaze B2
      await axios.post(
        `${API_BASE_URL || ''}/api/files/multipart/complete`,
        { fileId, s3Key, uploadId, parts: completedParts },
        { headers, signal: abortController.signal }
      );

      return { fileId, s3Key, sha256, thumbnail };
    } catch (err) {
      isAborted = true;
      abortController.abort();

      // Deduplicated cancel: routes through notifyBackendCancel so only one cancel request fires per file
      notifyBackendCancel({ fileId, s3Key, uploadId });
      throw err;
    }
  };

  const uploadSingleFileWithRetry = async ({
    id,
    ticket,
    uploadFile,
    folderId,
    headers,
    controller,
    updateItem,
    trackByteSpeedTick,
  }) => {
    let attempt = 0;
    let backgroundResumeCycles = 0;
    const MAX_SINGLE_RETRIES = 3;
    const MAX_BACKGROUND_RESUMES = 10;
    let currentPresignedUrl = ticket?.presignedUrl || ticket?.signedUrl;

    while (attempt < MAX_SINGLE_RETRIES) {
      if (controller.signal.aborted || batchCancelledRef.current) {
        throw new Error('Upload cancelled');
      }

      let stallTimer = null;
      let totalTimer = null;
      const singleAbort = new AbortController();
      const abortHandler = () => {
        try {
          singleAbort.abort();
        } catch {}
      };
      controller.signal.addEventListener('abort', abortHandler, { once: true });

      const resetStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          console.warn(`[Single PUT Stall] No progress for 20s on attempt ${attempt + 1}, aborting socket.`);
          try {
            singleAbort.abort();
          } catch {}
        }, 20000);
      };

      try {
        resetStallTimer();
        totalTimer = setTimeout(() => {
          console.warn(`[Single PUT Timeout] Total request exceeded 45s on attempt ${attempt + 1}, aborting socket.`);
          try {
            singleAbort.abort();
          } catch {}
        }, 45000);

        let lastSingleProgressTime = 0;
        await s3Axios.put(currentPresignedUrl, uploadFile, {
          signal: singleAbort.signal,
          headers: { 'Content-Type': uploadFile.type || 'application/octet-stream' },
          transformRequest: [(data, reqHeaders) => {
            if (reqHeaders) {
              delete reqHeaders.Authorization;
              delete reqHeaders.authorization;
            }
            return data;
          }],
          onUploadProgress: (progressEvent) => {
            resetStallTimer();
            if (controller.signal.aborted || batchCancelledRef.current) return;
            if (progressEvent.total) {
              const percent = Math.min(
                99,
                Math.round((progressEvent.loaded / progressEvent.total) * 100)
              );
              const now = Date.now();
              if (now - lastSingleProgressTime >= 250 || percent >= 99 || (lastSingleProgressTime === 0 && progressEvent.loaded > 0)) {
                lastSingleProgressTime = now;
                updateItem(id, {
                  progress: percent,
                  uploadedBytes: progressEvent.loaded,
                  statusLabel: null,
                });
                trackByteSpeedTick();
              }
            }
          },
        });

        if (stallTimer) clearTimeout(stallTimer);
        if (totalTimer) clearTimeout(totalTimer);
        controller.signal.removeEventListener('abort', abortHandler);
        return;
      } catch (putErr) {
        if (stallTimer) clearTimeout(stallTimer);
        if (totalTimer) clearTimeout(totalTimer);
        controller.signal.removeEventListener('abort', abortHandler);

        if (
          controller.signal.aborted ||
          batchCancelledRef.current ||
          axios.isCancel(putErr) ||
          putErr?.name === 'CanceledError' ||
          putErr?.name === 'AbortError' ||
          putErr?.code === 'ERR_CANCELED'
        ) {
          throw putErr;
        }

        const status = putErr.status || putErr.response?.status;

        // 1. Expired Presigned URL Fallback (HTTP 403)
        if (status === 403) {
          console.warn(`[Single PUT ${id}] Presigned URL expired (HTTP 403). Refreshing URL...`);
          try {
            const authHdr = headers || (localStorage.getItem('token') ? { Authorization: `Bearer ${localStorage.getItem('token')}` } : {});
            const refreshRes = await axios.post(
              `${API_BASE_URL || ''}/api/files/presigned-url`,
              {
                fileName: uploadFile.name,
                fileSize: uploadFile.size,
                mimeType: uploadFile.type || 'application/octet-stream',
                folderId: folderId || null,
              },
              { headers: authHdr, signal: controller.signal }
            );
            if (refreshRes.data?.presignedUrl) {
              currentPresignedUrl = refreshRes.data.presignedUrl;
              ticket.presignedUrl = refreshRes.data.presignedUrl;
              if (refreshRes.data.fileId) ticket.fileId = refreshRes.data.fileId;
              if (refreshRes.data.s3Key) ticket.s3Key = refreshRes.data.s3Key;
              activeTicketsRef.current.set(id, {
                fileId: ticket.fileId,
                s3Key: ticket.s3Key,
                uploadId: null,
              });
              continue;
            }
          } catch (refreshErr) {
            console.error(`[Single PUT ${id}] Failed to refresh presigned URL:`, refreshErr);
          }
        }

        // 2. Background Pause / Network Auto-Resume
        const isSuspendedOrOffline =
          (typeof document !== 'undefined' && document.visibilityState === 'hidden') ||
          (typeof navigator !== 'undefined' && navigator.onLine === false) ||
          putErr.code === 'ERR_NETWORK_IO_SUSPENDED' ||
          putErr.code === 'ERR_INTERNET_DISCONNECTED' ||
          putErr.message?.includes('ERR_NETWORK_IO_SUSPENDED') ||
          putErr.message?.includes('ERR_INTERNET_DISCONNECTED');

        if (isSuspendedOrOffline && backgroundResumeCycles < MAX_BACKGROUND_RESUMES) {
          backgroundResumeCycles += 1;
          updateItem(id, { statusLabel: 'Paused (in background) — auto-resuming...' });
          try {
            await waitForOnlineAndVisible(controller.signal);
          } catch (waitErr) {
            throw waitErr;
          }
          updateItem(id, { statusLabel: null });
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }

        // 3. Regular Transient Network Retry
        const isNetworkOrTimeout =
          !putErr.response ||
          putErr.code === 'ECONNABORTED' ||
          putErr.message?.includes('timeout') ||
          putErr.message?.includes('Network Error') ||
          singleAbort.signal.aborted;

        attempt += 1;
        if (attempt >= MAX_SINGLE_RETRIES || !isNetworkOrTimeout) {
          throw putErr;
        }

        const backoffMs = 1000 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  };

  const processQueueItem = async (item) => {
    const { id, file, folderId } = item;
    if (batchCancelledRef.current) return;
    processingIdsRef.current.add(id);

    // Reject 0-byte or unreadable files immediately before requesting presigned URL
    if (!file || !file.size || file.size === 0) {
      updateItem(id, {
        status: 'error',
        progress: 100,
        error: 'File is empty (0 bytes) or could not be read from device',
      });
      currentBatchFailedRef.current += 1;
      processingIdsRef.current.delete(id);
      inFlightIdsRef.current.delete(id);
      activeControllersRef.current.delete(id);
      toast.error(`"${item.name || 'File'}" is empty (0 bytes) or could not be read from device.`);
      return;
    }

    const controller = new AbortController();
    activeControllersRef.current.set(id, controller);

    // Ensure iOS photo <= 25 MB is materialized into memory before uploading
    let uploadFile = file;
    if (isIOS && file.size <= 25 * 1024 * 1024 && !file._materialized) {
      try {
        const buf = await file.arrayBuffer();
        if (buf && buf.byteLength > 0) {
          try {
            uploadFile = new File([buf], file.name, { type: file.type });
          } catch {
            uploadFile = new Blob([buf], { type: file.type });
            uploadFile.name = file.name;
          }
          uploadFile._materialized = true;
          item.file = uploadFile;
        }
      } catch (matErr) {
        console.warn('[Inline Materialization Notice]:', matErr.message);
      }
    }

    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    try {
      let fileId, s3Key, sha256, thumbnail;

      if (uploadFile.size >= MULTIPART_THRESHOLD) {
        try {
          ({ fileId, s3Key, sha256, thumbnail } = await uploadLargeFileMultipart({
            id,
            file: uploadFile,
            folderId,
            headers,
            updateItem,
            signal: controller.signal,
          }));
        } catch (mpErr) {
          const isCancelled =
            batchCancelledRef.current ||
            cancelledIdsRef.current.has(id) ||
            controller.signal.aborted ||
            axios.isCancel(mpErr) ||
            mpErr?.name === 'CanceledError' ||
            mpErr?.name === 'AbortError' ||
            mpErr?.code === 'ERR_CANCELED' ||
            mpErr?.message?.includes('aborted') ||
            mpErr?.message?.includes('cancelled');

          if (isCancelled) {
            return;
          }
          if (mpErr.isQuota) {
            const errData = mpErr.errorData;
            const errorCode = errData?.code || errData?.error;

            if (['SUBSCRIPTION_EXPIRED', 'SUBSCRIPTION_PAST_DUE', 'TRIAL_EXPIRED'].includes(errorCode)) {
              updateItem(id, {
                status: 'error',
                error: errData?.error || 'Uploads locked: subscription expired or past due.',
                progress: 100,
              });
              if (!batchCancelledRef.current && !controller.signal.aborted) {
                toast.error(errData?.error || 'Your subscription has expired. Select a plan on the Pricing page to resume uploading.', { id: `write-lock-${id}` });
              }
              return;
            }

            if (errorCode === 'QUOTA_EXCEEDED') {
              setQueue((prev) =>
                prev.map((qItem) =>
                  qItem.id === id
                    ? { ...qItem, status: 'paused_for_upgrade', progress: 0 }
                    : qItem
                )
              );
              setQuotaUpgradeState({
                fileItem: item,
                quotaInfo: errData,
              });
              return;
            }
            updateItem(id, { status: 'error', error: 'Storage quota exceeded', progress: 100 });
            if (!batchCancelledRef.current && !controller.signal.aborted) {
              toast.error(`Not enough storage in vault for "${file.name}".`, { id: `quota-${id}` });
            }
            return;
          }
          throw mpErr;
        }
      } else {
        updateItem(id, { status: 'uploading', progress: 0, uploadedBytes: 0, statusLabel: 'Starting...' });

        // Parallelize thumbnail generation and ticket retrieval
        let ticket;
        try {
          const [ticketRes, thumb] = await Promise.all([
            axios.post(
              `${API_BASE_URL || ''}/api/files/presigned-url`,
              {
                fileName: uploadFile.name,
                fileSize: uploadFile.size,
                mimeType: uploadFile.type || 'application/octet-stream',
                folderId: folderId || null,
              },
              { headers, signal: controller.signal }
            ),
            generateThumbnailWithTimeout(uploadFile),
          ]);
          ticket = ticketRes.data;
          thumbnail = thumb;
          fileId = ticket.fileId;
          s3Key = ticket.s3Key;
          activeTicketsRef.current.set(id, { fileId, s3Key, uploadId: null });

          if (batchCancelledRef.current || controller.signal.aborted) {
            notifyCancelBackend({ fileId, s3Key, uploadId: null });
            return;
          }
        } catch (err) {
          if (
            batchCancelledRef.current ||
            controller.signal.aborted ||
            axios.isCancel(err) ||
            err?.name === 'CanceledError' ||
            err?.name === 'AbortError' ||
            err?.code === 'ERR_CANCELED'
          ) {
            return;
          }
          const errorData = err.response?.data;
          const errorCode = errorData?.code || errorData?.error;

          if (err.response?.status === 403 && ['SUBSCRIPTION_EXPIRED', 'SUBSCRIPTION_PAST_DUE', 'TRIAL_EXPIRED'].includes(errorCode)) {
            updateItem(id, {
              status: 'error',
              error: errorData?.error || 'Uploads locked: subscription expired or past due.',
              progress: 100,
            });
            if (!batchCancelledRef.current && !controller.signal.aborted) {
              toast.error(errorData?.error || 'Your subscription has expired. Select a plan on the Pricing page to resume uploading.', { id: `write-lock-${id}` });
            }
            return;
          }

          if (err.response?.status === 403 && errorCode === 'QUOTA_EXCEEDED') {
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
            if (!batchCancelledRef.current && !controller.signal.aborted) {
              toast.error(`Not enough vault storage for "${uploadFile.name}".`, { id: `quota-${id}` });
            }
            return;
          }
          throw new Error(err.response?.data?.error || 'Failed to acquire upload ticket');
        }

        if (batchCancelledRef.current || controller.signal.aborted) return;
        updateItem(id, { status: 'uploading', progress: 0, statusLabel: 'Starting...' });

        const hashPromise = computeFileSHA256(uploadFile);

        await uploadSingleFileWithRetry({
          id,
          ticket,
          uploadFile,
          folderId,
          headers,
          controller,
          updateItem,
          trackByteSpeedTick,
        });

        fileId = ticket.fileId;
        s3Key = ticket.s3Key;

        sha256 = await Promise.race([
          hashPromise,
          new Promise((resolve) => setTimeout(() => resolve(null), 500)),
        ]).catch(() => null);
      }

      if (batchCancelledRef.current || controller.signal.aborted) return;

      // Step 3: Finalize upload with backend, attaching thumbnail
      updateItem(id, { status: 'finalizing', progress: 96, uploadedBytes: uploadFile.size });

      if (batchCancelledRef.current || controller.signal.aborted) return;

      const finalizeRes = await axios.post(
        `${API_BASE_URL || ''}/api/files/finalize-upload`,
        {
          fileId,
          s3Key,
          sha256,
          thumbnail, // Attach generated 15KB thumbnail
        },
        { headers, signal: controller.signal }
      );

      if (batchCancelledRef.current || controller.signal.aborted) return;

      const finalFile = finalizeRes.data?.file;
      const finalStatus = finalFile?.securityStatus || finalizeRes.data?.securityStatus;
      const isBulkUpload = batchTotalRef.current > 5 || (queueRef.current || []).length > 5;

      if (finalizeRes.data?.isMalicious || finalStatus === 'threat_purged') {
        updateItem(id, {
          status: 'threat_purged',
          progress: 100,
          error: 'Threat detected & deleted',
        });
        currentBatchFailedRef.current += 1;
        if (!batchCancelledRef.current && !controller.signal.aborted) {
          toast.error(`Threat detected: "${file.name}" was automatically deleted from vault.`, {
            duration: 5000,
          });
        }
      } else if (finalStatus === 'unverified') {
        updateItem(id, { status: 'unverified', progress: 100 });
        if (!isBulkUpload && !batchCancelledRef.current && !controller.signal.aborted) {
          toast.info
            ? toast.info(`Deep scan incomplete. "${file.name}" marked unverified.`, { duration: 4000 })
            : toast.error(`Deep scan incomplete. "${file.name}" marked unverified.`, { duration: 4000 });
        }
      } else {
        updateItem(id, { status: 'clean', progress: 100 });
        currentBatchCompletedRef.current += 1;
        if (!isBulkUpload && !batchCancelledRef.current && !controller.signal.aborted) {
          toast.success(`"${file.name}" verified safe.`, { duration: 3000 });
        }
      }

      activeTicketsRef.current.delete(id);
      dispatchThrottledUpdates(folderId, false);
    } catch (err) {
      const isCancelled =
        batchCancelledRef.current ||
        cancelledIdsRef.current.has(id) ||
        controller.signal.aborted ||
        axios.isCancel(err) ||
        err?.name === 'CanceledError' ||
        err?.name === 'AbortError' ||
        err?.code === 'ERR_CANCELED' ||
        err?.message?.includes('aborted') ||
        err?.message?.includes('cancelled');

      if (isCancelled) {
        const ticket = activeTicketsRef.current.get(id);
        if (ticket) {
          notifyCancelBackend(ticket);
        }
        return;
      }

      console.error('[Upload Pipeline Error]:', err);
      currentBatchFailedRef.current += 1;
      const errorData = err.response?.data;
      const errorCode = errorData?.code || errorData?.error;
      const isWriteLock = err.response?.status === 403 && ['SUBSCRIPTION_EXPIRED', 'SUBSCRIPTION_PAST_DUE', 'TRIAL_EXPIRED'].includes(errorCode);

      updateItem(id, {
        status: 'error',
        progress: 100,
        error: isWriteLock ? (errorData?.error || 'Uploads locked: subscription expired or past due.') : (err.response?.data?.error || err.message || 'Upload failed'),
      });
      if (!batchCancelledRef.current && !controller.signal.aborted && !cancelledIdsRef.current.has(id)) {
        if (isWriteLock) {
          toast.error(errorData?.error || 'Your subscription has expired. Select a plan on the Pricing page to resume uploading.', { id: `write-lock-${id}` });
        } else {
          toast.error(`Upload failed: "${file.name}"`);
        }
      }
    } finally {
      inFlightIdsRef.current.delete(id);
      activeTicketsRef.current.delete(id);
      activeControllersRef.current.delete(id);
      processingIdsRef.current.delete(id);
      setTimeout(() => {
        if (batchCancelledRef.current) return;
        const remaining = (queueRef.current || []).filter((i) =>
          ['uploading', 'hashing', 'finalizing', 'queued', 'pending'].includes(i.status)
        );
        if (remaining.length === 0) {
          batchTotalRef.current = 0;
          batchStartTimeRef.current = 0;
          emaBytesPerSecRef.current = 0;
          dispatchThrottledUpdates(folderId, true);
          window.dispatchEvent(new CustomEvent('cloudguard:all-uploads-completed', { detail: { folderId } }));

          if (!batchCancelledRef.current && currentBatchCompletedRef.current > 0) {
            const completedCount = currentBatchCompletedRef.current;
            currentBatchCompletedRef.current = 0;
            currentBatchFailedRef.current = 0;
            if (completedCount === 1) {
              toast.success('1 file uploaded safely.', { duration: 5000 });
            } else if (completedCount > 1) {
              toast.success(`Batch upload completed: ${completedCount} files uploaded safely.`, { duration: 5000 });
            }
          } else {
            currentBatchCompletedRef.current = 0;
            currentBatchFailedRef.current = 0;
          }
        }
      }, 100);
    }
  };

  const resumePausedUpload = (fileId) => {
    inFlightIdsRef.current.delete(fileId);
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
    inFlightIdsRef.current.delete(fileId);
    setQueue((prev) => prev.filter((item) => item.id !== fileId));
    setQuotaUpgradeState(null);
  };

  const removeQueueItem = (id) => {
    cancelledIdsRef.current.add(id);
    inFlightIdsRef.current.delete(id);
    const ticket = activeTicketsRef.current.get(id);
    if (ticket) {
      notifyCancelBackend(ticket);
      activeTicketsRef.current.delete(id);
    }
    const controller = activeControllersRef.current.get(id);
    if (controller) {
      try {
        controller.abort();
      } catch (e) {
        // ignore
      }
      activeControllersRef.current.delete(id);
    }
    processingIdsRef.current.delete(id);
    setQueue((prev) => prev.filter((item) => item.id !== id));
    toast.info('Upload cancelled', { id: `cancel-${id}`, duration: 3000 });
  };

  const cancelAllUploads = useCallback(() => {
    // Synchronously set cancellation flag and clear queue immediately so queued files never start
    batchCancelledRef.current = true;
    (queueRef.current || []).forEach((item) => {
      cancelledIdsRef.current.add(item.id);
    });
    batchTotalRef.current = 0;
    batchStartTimeRef.current = 0;
    currentBatchCompletedRef.current = 0;
    currentBatchFailedRef.current = 0;
    emaBytesPerSecRef.current = 0;
    lastActiveSpeedRef.current = 0;
    speedSamplesRef.current = [];
    lastProgressSampleRef.current = { time: Date.now(), bytes: 0 };
    if (eventDebounceTimerRef.current) {
      clearTimeout(eventDebounceTimerRef.current);
      eventDebounceTimerRef.current = null;
    }

    // 1. Clear queue synchronously BEFORE aborting active controllers so queued items never start
    setQueue([]);
    inFlightIdsRef.current.clear();

    // 2. Fire non-blocking cancel-upload notifications for all in-flight tickets
    activeTicketsRef.current.forEach((ticket) => {
      notifyCancelBackend(ticket);
    });
    activeTicketsRef.current.clear();

    // 3. Abort every controller in activeControllersRef.current and clear the map
    activeControllersRef.current.forEach((controller) => {
      try {
        controller.abort();
      } catch (e) {
        // ignore
      }
    });
    activeControllersRef.current.clear();
    processingIdsRef.current.clear();

    // Reset ETA tracking and speed
    setEtaSeconds(null);
    setGlobalSpeed('');
    releaseWakeLock();

    // 4. Show a single clean toast: 'Upload cancelled'
    toast.info('Upload cancelled', { id: 'cancel-all', duration: 3000 });
  }, [notifyCancelBackend, toast, releaseWakeLock]);

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
        cancelAllUploads,
        cancelAll: cancelAllUploads,
        clearFinished,
        dropdownRef,
        quotaUpgradeState,
        resumePausedUpload,
        cancelPausedUpload,
        folderPrep,
        startFolderPrep,
        updateFolderPrep,
        clearFolderPrep,
        cancelFolderPrep,
        etaSeconds,
        etaLabel: formatEta(etaSeconds),
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
      cancelAllUploads: () => {},
      cancelAll: () => {},
      clearFinished: () => {},
      dropdownRef: { current: null },
      quotaUpgradeState: null,
      resumePausedUpload: () => {},
      cancelPausedUpload: () => {},
      folderPrep: null,
      startFolderPrep: () => {},
      updateFolderPrep: () => {},
      clearFolderPrep: () => {},
      cancelFolderPrep: () => {},
      etaSeconds: null,
      etaLabel: '',
    }
  );
};

/**
 * Top Header Upload Button with Status Badge and Dropdown Tray
 */
export const HeaderUploadButton = () => {
  const {
    uploadQueue,
    queue,
    isUploading,
    clearCompleted,
    clearFinished,
    globalSpeed,
    removeQueueItem,
    cancelAllUploads,
    folderPrep,
    cancelFolderPrep,
    etaSeconds,
  } = useUpload();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const activeQueue = uploadQueue || queue || [];
  const activeItems = activeQueue.filter((i) =>
    ['uploading', 'hashing', 'finalizing'].includes(i.status)
  );

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

  // Auto-open tray when folder preparation begins
  useEffect(() => {
    if (folderPrep) {
      setIsOpen(true);
      window.dispatchEvent(new CustomEvent('cloudguard:upload-tray-opened'));
    }
  }, [folderPrep]);

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

  // Single-pass O(1) aggregation metrics
  const totalCount = activeQueue.length;
  let totalBytes = 0;
  let uploadedBytes = 0;
  let completedCount = 0;
  let errorCount = 0;
  let purgedCount = 0;
  let activeCount = 0;

  for (let i = 0; i < totalCount; i++) {
    const item = activeQueue[i];
    const size = item.file?.size || item.size || 0;
    totalBytes += size;

    if (TERMINAL_STATUSES.has(item.status) || item.status === 'completed' || item.status === 'malicious' || item.status === 'failed') {
      uploadedBytes += size;
      if (item.status === 'completed' || item.status === 'clean') {
        completedCount++;
      } else if (item.status === 'threat_purged' || item.status === 'malicious') {
        purgedCount++;
      } else {
        errorCount++;
      }
    } else if (['uploading', 'hashing', 'finalizing'].includes(item.status)) {
      activeCount++;
      const currentUploaded = typeof item.uploadedBytes === 'number' ? item.uploadedBytes : 0;
      uploadedBytes += Math.min(size, Math.max(0, currentUploaded));
    } else if (['queued', 'pending', 'paused_for_upgrade'].includes(item.status)) {
      activeCount++;
    }
  }

  const finishedCount = completedCount + purgedCount + errorCount;
  const rawPct = totalBytes > 0
    ? (uploadedBytes / totalBytes) * 100
    : (totalCount > 0 ? (finishedCount / totalCount) * 100 : 0);

  let pctDisplay;
  if (rawPct > 0 && rawPct < 10) {
    pctDisplay = rawPct.toFixed(1);
  } else {
    pctDisplay = Math.min(100, Math.round(rawPct));
  }

  const batchPercent = totalBytes > 0
    ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100))
    : (totalCount > 0 ? Math.min(100, Math.round((finishedCount / totalCount) * 100)) : 0);

  const isWorking = activeCount > 0;
  const activeIsUploading = typeof isUploading === 'boolean' ? isUploading : isWorking;
  const activeClear = clearCompleted || clearFinished;

  // Folder prep live ETA
  let folderPrepEtaLabel = '';
  if (folderPrep?.startTime && folderPrep.createdCount > 0 && folderPrep.totalFolders > folderPrep.createdCount) {
    const elapsedSec = (Date.now() - folderPrep.startTime) / 1000;
    if (elapsedSec > 0.3) {
      const rate = folderPrep.createdCount / elapsedSec;
      const remSec = Math.round((folderPrep.totalFolders - folderPrep.createdCount) / rate);
      folderPrepEtaLabel = formatEta(remSec);
    }
  }

  const etaLabel = isWorking ? formatEta(etaSeconds) : '';

  // Windowed visible rows: prioritize active rows, then recent finished rows
  const MAX_VISIBLE_ROWS = 50;
  const visibleItems = useMemo(() => {
    if (activeQueue.length <= MAX_VISIBLE_ROWS) {
      return activeQueue;
    }
    const active = [];
    const finished = [];
    for (let i = 0; i < activeQueue.length; i++) {
      const item = activeQueue[i];
      if (['uploading', 'hashing', 'finalizing', 'queued', 'pending', 'paused_for_upgrade'].includes(item.status)) {
        active.push(item);
      } else {
        finished.push(item);
      }
    }
    if (active.length >= MAX_VISIBLE_ROWS) {
      return active.slice(0, MAX_VISIBLE_ROWS);
    }
    const remainingSlots = MAX_VISIBLE_ROWS - active.length;
    const recentFinished = finished.slice(-remainingSlots);
    return [...active, ...recentFinished];
  }, [activeQueue]);

  const getHeaderTitle = () => {
    if (folderPrep) {
      return `Preparing folders (${(folderPrep.createdCount || 0).toLocaleString()}/${(folderPrep.totalFolders || 0).toLocaleString()})`;
    }
    if (isWorking) {
      return `Uploading (${activeCount.toLocaleString()} left)`;
    }
    if (errorCount > 0 && completedCount === 0) {
      return errorCount === 1 ? 'Upload Failed' : `${errorCount.toLocaleString()} Uploads Failed`;
    }
    if (errorCount > 0 && completedCount > 0) {
      return `${completedCount.toLocaleString()} Uploaded, ${errorCount.toLocaleString()} Failed`;
    }
    return 'Uploads Complete';
  };

  if (activeQueue.length === 0 && !folderPrep) return null;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={toggleOpen}
        title="View upload queue"
        className="relative p-2 rounded-lg bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer"
      >
        <UploadCloud className={`w-5 h-5 ${activeIsUploading || folderPrep ? 'animate-pulse text-blue-500' : ''}`} />
        {(activeCount > 0 || folderPrep) && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white shadow-sm">
            {activeCount > 0 ? activeCount : '…'}
          </span>
        )}
      </button>

      {/* Upload Dropdown Tray */}
      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed left-4 right-4 sm:left-auto sm:right-0 top-16 sm:top-full sm:mt-2.5 w-[calc(100vw-2rem)] sm:w-96 max-h-[75vh] flex flex-col rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-white shadow-2xl z-50 select-none overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/40">
            <div className="min-w-0 truncate">
              <span className="font-semibold text-sm">
                {getHeaderTitle()}
              </span>
              {isWorking && !folderPrep && (activeItems[0]?.speed || globalSpeed) && (
                <span className="ml-2 text-neutral-500 dark:text-neutral-400 text-xs">
                  {activeItems[0]?.speed || globalSpeed}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {folderPrep ? (
                <button
                  type="button"
                  onClick={cancelFolderPrep}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              ) : isWorking ? (
                <button
                  type="button"
                  onClick={cancelAllUploads}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors cursor-pointer"
                >
                  Cancel all
                </button>
              ) : (
                <button
                  type="button"
                  onClick={activeClear}
                  className="text-[11px] font-medium text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors cursor-pointer"
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                title="Close"
                className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5"/>
              </button>
            </div>
          </div>

          {/* Folder Preparation Progress Banner */}
          {folderPrep && (
            <div className="p-3 bg-blue-50/70 dark:bg-blue-950/30 border-b border-blue-100 dark:border-blue-900/50">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Folder className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 animate-pulse" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-blue-900 dark:text-blue-200 truncate">
                      {folderPrep.folderName || 'Preparing folder'}
                    </p>
                    <p className="text-[11px] text-blue-700/80 dark:text-blue-400/80 truncate">
                      Creating folders: {(folderPrep.createdCount || 0).toLocaleString()} / {(folderPrep.totalFolders || 0).toLocaleString()}
                      {folderPrep.totalFiles ? ` • ${folderPrep.totalFiles.toLocaleString()} files queued` : ''}
                      {folderPrepEtaLabel ? ` • ${folderPrepEtaLabel}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={cancelFolderPrep}
                  className="px-2 py-0.5 rounded text-[11px] font-medium text-red-600 dark:text-red-400 bg-red-100 hover:bg-red-200 dark:bg-red-950/60 dark:hover:bg-red-900/60 transition-colors shrink-0 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
              <div className="w-full bg-blue-200 dark:bg-blue-900/60 h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 dark:bg-blue-400 transition-all duration-200"
                  style={{
                    width: `${
                      folderPrep.totalFolders > 0
                        ? Math.min(100, Math.round(((folderPrep.createdCount || 0) / folderPrep.totalFolders) * 100))
                        : 50
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Batch Summary Bar */}
          {totalCount > 1 && (
            <div className="px-4 py-2.5 bg-neutral-50/70 dark:bg-neutral-800/40 border-b border-neutral-100 dark:border-neutral-800">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] tabular-nums mb-1.5 font-medium">
                <span className="text-neutral-700 dark:text-neutral-300">
                  {finishedCount.toLocaleString()} / {totalCount.toLocaleString()} files ({pctDisplay}%)
                </span>
                {isWorking && etaLabel && (
                  <span className="text-neutral-500 dark:text-neutral-400 font-medium whitespace-nowrap">
                    {etaLabel}
                  </span>
                )}
              </div>
              <div className="w-full bg-neutral-200 dark:bg-neutral-700 h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-200"
                  style={{ width: `${Math.min(100, Math.max(0, rawPct))}%` }}
                />
              </div>
            </div>
          )}

          {/* Item List */}
          {visibleItems.length === 0 && folderPrep ? (
            <div className="p-6 text-center text-xs text-neutral-500 dark:text-neutral-400">
              Building folder structure before initiating file transfers...
            </div>
          ) : (
            <div className="overflow-y-auto p-2 space-y-1.5 divide-y divide-neutral-100 dark:divide-neutral-800/60 max-h-80">
              {visibleItems.map((item) => (
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
                          (item.statusLabel ||
                            (item.uploadedBytes > 0
                              ? `${formatBytes(item.uploadedBytes || 0)} of ${formatBytes(item.file?.size || item.size)}`
                              : `${formatBytes(item.file?.size || item.size)} • Starting...`))}
                        {item.status === 'hashing' && `${formatBytes(item.file?.size || item.size)} • Preparing`}
                        {item.status === 'finalizing' && `${formatBytes(item.file?.size || item.size)} • Inspecting security`}
                        {item.status === 'queued' && `${formatBytes(item.file?.size || item.size)} • Queued`}
                        {item.status === 'paused_for_upgrade' && `${formatBytes(item.file?.size || item.size)} • Paused (Upgrade Required)`}
                        {(item.status === 'completed' || item.status === 'clean') && `${formatBytes(item.file?.size || item.size)} • Safe`}
                        {(item.status === 'malicious' || item.status === 'threat_purged') && `${formatBytes(item.file?.size || item.size)} • Deleted`}
                        {(item.status === 'error' || item.status === 'failed') && `${formatBytes(item.file?.size || item.size)} • ${item.error || 'Failed'}`}
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
                          : item.status === 'error' || item.status === 'failed'
                          ? <span className="text-red-500 font-medium">Failed</span>
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
          )}

          {/* Muted Windowing Banner */}
          {totalCount > MAX_VISIBLE_ROWS && (
            <div className="px-4 py-2 text-center text-[11px] text-neutral-400 dark:text-neutral-500 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
              Showing {MAX_VISIBLE_ROWS} of {totalCount.toLocaleString()} files • Remaining files processing automatically
            </div>
          )}
        </div>
      )}
    </div>
  );
};
