import React, { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { Upload, UploadCloud, CheckCircle2, AlertTriangle, X, Loader2, Folder } from 'lucide-react';
import { computeFileSHA256 } from '../utils/cryptoHelper';
import { generateMediaThumbnail } from '../utils/thumbnailHelper';
import { useToast } from './ToastContext';
import { API_BASE_URL } from '../config';

const UploadContext = createContext(null);
const MAX_CONCURRENT_UPLOADS = 2;
const MULTIPART_THRESHOLD = 25 * 1024 * 1024; // 25 MB
const MULTIPART_PART_CONCURRENCY = 3;
const MAX_PART_RETRIES = 6;
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
  const lastEventDispatchRef = useRef(0);
  const eventDebounceTimerRef = useRef(null);
  const cancelledTicketsRef = useRef(new Set());
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
    const now = Date.now();
    if (immediate || now - lastEventDispatchRef.current >= 1500) {
      if (eventDebounceTimerRef.current) {
        clearTimeout(eventDebounceTimerRef.current);
        eventDebounceTimerRef.current = null;
      }
      lastEventDispatchRef.current = now;
      window.dispatchEvent(new CustomEvent('cloudguard:storage-updated'));
      window.dispatchEvent(new CustomEvent('cloudguard:files-updated', { detail: { folderId } }));
    } else if (!eventDebounceTimerRef.current) {
      eventDebounceTimerRef.current = setTimeout(() => {
        eventDebounceTimerRef.current = null;
        lastEventDispatchRef.current = Date.now();
        window.dispatchEvent(new CustomEvent('cloudguard:storage-updated'));
        window.dispatchEvent(new CustomEvent('cloudguard:files-updated', { detail: { folderId } }));
      }, 1500);
    }
  }, []);

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
    const deltaSec = (now - lastProgressSampleRef.current.time) / 1000;
    if (deltaSec < 0.25) return;

    const metrics = computeQueueMetrics(queueRef.current || []);
    const currentUploaded = metrics.uploadedBytes;
    const deltaBytes = Math.max(0, currentUploaded - lastProgressSampleRef.current.bytes);

    if (deltaBytes > 0) {
      const instantBytesPerSec = Math.max(0, deltaBytes / deltaSec);
      emaBytesPerSecRef.current =
        emaBytesPerSecRef.current > 0
          ? 0.3 * instantBytesPerSec + 0.7 * emaBytesPerSecRef.current
          : instantBytesPerSec;

      const speed = emaBytesPerSecRef.current;
      if (speed > 0) {
        const speedStr =
          speed >= 1024 * 1024
            ? `${(speed / (1024 * 1024)).toFixed(1)} MB/s`
            : `${Math.round(speed / 1024)} KB/s`;
        setGlobalSpeed(speedStr);
      }
      lastProgressSampleRef.current = { time: now, bytes: currentUploaded };
    } else if (deltaSec >= 3.0) {
      emaBytesPerSecRef.current = emaBytesPerSecRef.current * 0.5;
      if (emaBytesPerSecRef.current < 1024) {
        emaBytesPerSecRef.current = 0;
        setGlobalSpeed('');
      } else {
        const speed = emaBytesPerSecRef.current;
        const speedStr =
          speed >= 1024 * 1024
            ? `${(speed / (1024 * 1024)).toFixed(1)} MB/s`
            : `${Math.round(speed / 1024)} KB/s`;
        setGlobalSpeed(speedStr);
      }
      lastProgressSampleRef.current = { time: now, bytes: currentUploaded };
    }
  }, []);

  // Hybrid EMA ETA Engine: 500ms ticker with cold-start and positive-only countdown
  useEffect(() => {
    const hasActiveTransfers = queue.some((i) =>
      ['uploading', 'hashing', 'finalizing', 'queued', 'pending'].includes(i.status)
    );

    if (!hasActiveTransfers) {
      setEtaSeconds(null);
      setGlobalSpeed('');
      batchStartTimeRef.current = 0;
      emaBytesPerSecRef.current = 0;
      return;
    }

    if (batchStartTimeRef.current === 0) {
      batchStartTimeRef.current = Date.now();
      const initialMetrics = computeQueueMetrics(queueRef.current || []);
      lastProgressSampleRef.current = { time: Date.now(), bytes: initialMetrics.uploadedBytes };
      setEtaSeconds(-1);
    }

    const interval = setInterval(() => {
      trackByteSpeedTick();

      const metrics = computeQueueMetrics(queueRef.current || []);
      if (metrics.activeCount === 0 && metrics.queuedCount === 0) {
        setEtaSeconds(null);
        setGlobalSpeed('');
        batchStartTimeRef.current = 0;
        emaBytesPerSecRef.current = 0;
        return;
      }

      const now = Date.now();
      const elapsedSec = (now - batchStartTimeRef.current) / 1000;
      const speed = emaBytesPerSecRef.current;
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

  const enqueueFiles = useCallback((files, defaultFolderId = null) => {
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

    const newItems = fileList.map((item) => {
      // Support raw File objects as well as { file, targetFolderId } or { file, folderId } wrappers
      const actualFile = item?.file ? item.file : item;
      const resolvedFolderId = item?.targetFolderId !== undefined
        ? item.targetFolderId
        : (item?.folderId !== undefined ? item.folderId : (defaultFolderId || null));

      return {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file: actualFile,
        name: actualFile?.name || 'file',
        size: actualFile?.size || 0,
        folderId: resolvedFolderId,
        status: 'queued', // queued | hashing | uploading | finalizing | clean | threat_purged | error
        progress: 0,
        error: null,
        uploadedBytes: 0,
      };
    });

    setQueue((prev) => [...prev, ...newItems]);
    setIsOpen(true);
  }, []);

  // Worker loop enforcing MAX_CONCURRENT_UPLOADS (2 streams)
  useEffect(() => {
    if (batchCancelledRef.current) return;

    const activeCount = Math.max(
      queue.filter((item) =>
        ['hashing', 'uploading', 'finalizing'].includes(item.status)
      ).length,
      inFlightIdsRef.current.size
    );

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

    const slotsAvailable = Math.max(0, MAX_CONCURRENT_UPLOADS - activeCount);
    if (slotsAvailable > 0 && queuedItems.length > 0) {
      const itemsToStart = queuedItems.slice(0, slotsAvailable);
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

    if (batchCancelledRef.current || abortController.signal.aborted || isAborted) {
      throw new Error('Upload cancelled');
    }

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
          { headers, signal: abortController.signal }
        ),
        generateMediaThumbnail(file),
      ]);
    } catch (initErr) {
      if (
        batchCancelledRef.current ||
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
      throw new Error(initErr.response?.data?.error || 'Failed to initialize multipart upload');
    }

    const { fileId, s3Key, uploadId, partSize, partUrls } = initRes.data;
    activeTicketsRef.current.set(id, { fileId, s3Key, uploadId });

    // If batch was cancelled while multipart/init was in-flight, immediately abort the B2 session
    if (batchCancelledRef.current || abortController.signal.aborted || isAborted) {
      isAborted = true;
      abortController.abort();
      notifyBackendCancel({ fileId, s3Key, uploadId });
      throw new Error('Upload cancelled');
    }

    updateItem(id, { status: 'uploading', progress: 10 });

    const partProgressMap = new Array(partUrls.length).fill(0);
    const completedParts = new Array(partUrls.length);
    let nextPartIdx = 0;

    let lastProgressTime = 0;
    const syncAggregateProgress = () => {
      if (isAborted) return;
      const totalLoaded = partProgressMap.reduce((sum, b) => sum + b, 0);
      const percent = Math.min(95, Math.max(10, Math.round((totalLoaded * 100) / file.size)));
      const now = Date.now();
      if (now - lastProgressTime >= 150 || percent >= 95) {
        lastProgressTime = now;
        updateItem(id, { progress: percent, uploadedBytes: totalLoaded });
        trackByteSpeedTick();
      }
    };

    const uploadSinglePartWithRetry = async (partMeta, index) => {
      const start = index * partSize;
      const end = Math.min(start + partSize, file.size);
      const chunkBlob = file.slice(start, end); // Zero-copy disk slice

      let attempt = 0;
      while (attempt < MAX_PART_RETRIES) {
        if (isAborted || abortController.signal.aborted) throw new Error('Multipart upload aborted');
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
              if (isAborted || abortController.signal.aborted) return;
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

          const status = err.response?.status;
          const isTransient =
            !err.response ||
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

          // Jittered exponential backoff for Backblaze B2 pod recovery
          const backoffMs =
            Math.min(15000, 1500 * Math.pow(2, attempt - 1)) +
            Math.floor(Math.random() * 600);
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }
    };

    try {
      // 2. Stream chunks with workers (concurrency capped to 3) + compute header SHA-256 concurrently
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

  const processQueueItem = async (item) => {
    const { id, file, folderId } = item;
    if (batchCancelledRef.current) return;
    processingIdsRef.current.add(id);

    const controller = new AbortController();
    activeControllersRef.current.set(id, controller);

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
            signal: controller.signal,
          }));
        } catch (mpErr) {
          if (
            batchCancelledRef.current ||
            controller.signal.aborted ||
            axios.isCancel(mpErr) ||
            mpErr?.name === 'CanceledError' ||
            mpErr?.name === 'AbortError' ||
            mpErr?.code === 'ERR_CANCELED'
          ) {
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
              { headers, signal: controller.signal }
            ),
            generateMediaThumbnail(file),
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
              toast.error(`Not enough vault storage for "${file.name}".`, { id: `quota-${id}` });
            }
            return;
          }
          throw new Error(err.response?.data?.error || 'Failed to acquire upload ticket');
        }

        if (batchCancelledRef.current || controller.signal.aborted) return;
        updateItem(id, { status: 'uploading', progress: 10 });

        let lastSingleProgressTime = 0;
        const [computedHash] = await Promise.all([
          computeFileSHA256(file),
          s3Axios.put(ticket.presignedUrl, file, {
            signal: controller.signal,
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            transformRequest: [(data, reqHeaders) => {
              if (reqHeaders) {
                delete reqHeaders.Authorization;
                delete reqHeaders.authorization;
              }
              return data;
            }],
            onUploadProgress: (progressEvent) => {
              if (controller.signal.aborted || batchCancelledRef.current) return;
              if (progressEvent.total) {
                const percent = Math.min(
                  95,
                  Math.round((progressEvent.loaded * 100) / progressEvent.total)
                );
                const now = Date.now();
                if (now - lastSingleProgressTime >= 150 || percent >= 95) {
                  lastSingleProgressTime = now;
                  updateItem(id, {
                    progress: percent,
                    uploadedBytes: progressEvent.loaded,
                  });
                  trackByteSpeedTick();
                }
              }
            },
          }),
        ]);
        sha256 = computedHash;
      }

      if (batchCancelledRef.current || controller.signal.aborted) return;

      // Step 3: Finalize upload with backend, attaching thumbnail
      updateItem(id, { status: 'finalizing', progress: 96, uploadedBytes: file.size });

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
      if (
        batchCancelledRef.current ||
        controller.signal.aborted ||
        axios.isCancel(err) ||
        err?.name === 'CanceledError' ||
        err?.name === 'AbortError' ||
        err?.code === 'ERR_CANCELED'
      ) {
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
      if (!batchCancelledRef.current && !controller.signal.aborted) {
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
  };

  const cancelAllUploads = useCallback(() => {
    // Synchronously set cancellation flag and clear queue immediately so queued files never start
    batchCancelledRef.current = true;
    batchTotalRef.current = 0;
    batchStartTimeRef.current = 0;
    currentBatchCompletedRef.current = 0;
    currentBatchFailedRef.current = 0;
    emaBytesPerSecRef.current = 0;
    lastProgressSampleRef.current = { time: Date.now(), bytes: 0 };

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

    // 4. Show a single toast: toast('All pending uploads cancelled')
    if (typeof toastCtx === 'function') {
      toastCtx('All pending uploads cancelled');
    } else if (toastCtx?.info) {
      toastCtx.info('All pending uploads cancelled');
    } else if (toastCtx?.success) {
      toastCtx.success('All pending uploads cancelled');
    }
  }, [notifyCancelBackend, toastCtx]);

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
                          `${formatBytes(item.uploadedBytes || 0)} of ${formatBytes(item.file?.size || item.size)}`}
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
