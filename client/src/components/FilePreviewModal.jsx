import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { fetchAccessUrl } from '../utils/accessUrlCache';
import MobilePdfViewer from './MobilePdfViewer';

// -------------------------------------------------------------
// Bounded 25-Item Session LRU Cache & In-Flight Deduplication
// -------------------------------------------------------------
const MAX_CACHE_SIZE = 25;
const SIGNED_URL_TTL_MS = 600_000; // 10 minutes (600,000 ms)

const previewLruCache = new Map();
const inFlightPromises = new Map();

/**
 * Retrieves a preview entry from the LRU cache, refreshing its recency.
 */
export function getCachedPreviewEntry(fileId) {
  if (!fileId) return null;
  const key = String(fileId);
  const entry = previewLruCache.get(key);
  if (entry) {
    previewLruCache.delete(key);
    previewLruCache.set(key, entry);
    return entry;
  }
  return null;
}

/**
 * Stores or updates a preview entry in the bounded 25-item LRU cache.
 * Automatically evicts the oldest entry and revokes its decodedBlobUrl.
 */
export function putCachedPreviewEntry(fileId, updates) {
  if (!fileId) return;
  const key = String(fileId);
  const existing = previewLruCache.get(key) || {};
  const updatedEntry = {
    ...existing,
    ...updates,
  };

  if (previewLruCache.has(key)) {
    previewLruCache.delete(key);
  }
  previewLruCache.set(key, updatedEntry);

  if (previewLruCache.size > MAX_CACHE_SIZE) {
    const oldestKey = previewLruCache.keys().next().value;
    const evicted = previewLruCache.get(oldestKey);
    if (evicted?.decodedBlobUrl) {
      try {
        URL.revokeObjectURL(evicted.decodedBlobUrl);
      } catch (e) {
        console.warn('[LRU Cache] Revoke ObjectURL error on eviction:', e);
      }
    }
    previewLruCache.delete(oldestKey);
  }

  return updatedEntry;
}

/**
 * Returns a cached signed URL (valid for 10m) or fetches a new one,
 * deduplicating concurrent in-flight requests.
 */
export async function getOrFetchSignedUrl(file, signal) {
  if (!file) return null;
  const fileId = String(file._id || file.id || file.s3Key || '');
  if (!fileId) return file.url || file.accessUrl || file.downloadUrl || null;

  // 1. Check LRU cache
  const cached = getCachedPreviewEntry(fileId);
  if (cached?.signedUrl && cached.signedUrlFetchedAt && (Date.now() - cached.signedUrlFetchedAt < SIGNED_URL_TTL_MS)) {
    return cached.signedUrl;
  }

  // 2. In-flight Promise deduplication
  const inFlightKey = `url:${fileId}`;
  if (inFlightPromises.has(inFlightKey)) {
    return inFlightPromises.get(inFlightKey);
  }

  // 3. Direct URL already on file object
  if (file.url || file.accessUrl || file.downloadUrl) {
    const directUrl = file.url || file.accessUrl || file.downloadUrl;
    putCachedPreviewEntry(fileId, {
      signedUrl: directUrl,
      signedUrlFetchedAt: Date.now(),
    });
    return directUrl;
  }

  // 4. Fetch via fetchAccessUrl
  const promise = (async () => {
    try {
      const url = await fetchAccessUrl(fileId);
      if (url) {
        putCachedPreviewEntry(fileId, {
          signedUrl: url,
          signedUrlFetchedAt: Date.now(),
        });
      }
      return url || null;
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.warn(`[FilePreviewModal] Failed to get signed URL for ${fileId}:`, err);
      }
      return null;
    } finally {
      inFlightPromises.delete(inFlightKey);
    }
  })();

  inFlightPromises.set(inFlightKey, promise);
  return promise;
}

/**
 * Returns a cached decoded HEIC blob URL or fetches and decodes it,
 * deduplicating concurrent in-flight requests so neighbor preloading
 * seamlessly hands off to active viewing with zero duplicate work.
 */
export async function getOrDecodeHeic(file, signedUrl, signal, options = {}) {
  const fileId = String(file?._id || file?.id || file?.s3Key || '');
  if (!fileId && !signedUrl) return null;

  // 1. Check LRU cache
  if (fileId) {
    const cached = getCachedPreviewEntry(fileId);
    if (cached?.decodedBlobUrl) {
      return cached.decodedBlobUrl;
    }
  }

  // 2. In-flight Promise deduplication
  const inFlightKey = fileId ? `heic:${fileId}` : `heic:${signedUrl}`;
  if (inFlightPromises.has(inFlightKey)) {
    const existing = inFlightPromises.get(inFlightKey);
    try {
      return await existing;
    } catch (err) {
      inFlightPromises.delete(inFlightKey);
      if (fileId) inFlightPromises.delete(`heic:${fileId}`);
      if (signedUrl) inFlightPromises.delete(`heic:${signedUrl}`);
      if (signal?.aborted) throw err;
      // Previous promise aborted or failed; continue below to attempt fresh decode for this caller
    }
  }

  // 3. Decode promise
  const decodePromise = (async () => {
    try {
      let targetUrl = signedUrl;
      if (!targetUrl && file) {
        targetUrl = await getOrFetchSignedUrl(file, signal);
      }
      if (!targetUrl) throw new Error('No preview URL available for HEIC');

      const resp = await fetch(targetUrl, { signal });
      if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
      const arrayBuffer = await resp.arrayBuffer();

      const { decodeHeicToBlob } = await import('../utils/heicDecoder');
      const decodedBlob = await decodeHeicToBlob(arrayBuffer, 0.85, {
        priority: options.priority || 'high',
        signal,
        maxDimension: options.maxDimension !== undefined ? options.maxDimension : 2048,
      });

      const objectUrl = URL.createObjectURL(decodedBlob);

      if (fileId) {
        putCachedPreviewEntry(fileId, {
          decodedBlobUrl: objectUrl,
          signedUrl: targetUrl,
          signedUrlFetchedAt: Date.now(),
        });
      }

      return objectUrl;
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('[HEIC Decode Error] getOrDecodeHeic failed:', err);
      }
      throw err;
    } finally {
      inFlightPromises.delete(inFlightKey);
      if (fileId) {
        inFlightPromises.delete(`heic:${fileId}`);
      }
      if (signedUrl) {
        inFlightPromises.delete(`heic:${signedUrl}`);
      }
    }
  })();

  inFlightPromises.set(inFlightKey, decodePromise);
  if (fileId) {
    inFlightPromises.set(`heic:${fileId}`, decodePromise);
  }
  return decodePromise;
}

/**
 * Safely preloads a media item for adjacent slides (index ± 1):
 * - Checks previewLruCache first (no-op if already cached)
 * - Fetches signed URL via getSignedUrlFn(file) or fetchAccessUrl
 * - Standard images: warms browser cache via new Image().src = signedUrl
 * - HEIC / HEIF: fetches + decodes via decodeHeicToBlob into previewLruCache (deduplicated via inFlightPromises)
 * - Videos / PDFs / other large files: warms only lightweight signed URL metadata
 */
export async function preloadMediaItem(file, getSignedUrlFn, signal) {
  if (!file || signal?.aborted) return;
  const fileId = String(file._id || file.id || file.s3Key || '');
  if (!fileId) return;

  const fileExt = (file.type || (file.name || '').split('.').pop() || '').toLowerCase();
  const isHeic = fileExt === 'heic' || fileExt === 'heif' || file.mimeType === 'image/heic' || file.mimeType === 'image/heif';
  const isStandardImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(fileExt) || file.mimeType?.startsWith('image/');

  // 1. Check if already fully cached in LRU (no-op)
  const existing = getCachedPreviewEntry(fileId);
  if (isHeic && existing?.decodedBlobUrl) {
    return;
  }
  if (!isHeic && existing?.signedUrl && (Date.now() - existing.signedUrlFetchedAt < SIGNED_URL_TTL_MS)) {
    return;
  }

  try {
    // 2. Fetch signed URL using getSignedUrlFn or fallback to getOrFetchSignedUrl
    let signedUrl = existing?.signedUrl;
    if (!signedUrl || (Date.now() - existing.signedUrlFetchedAt >= SIGNED_URL_TTL_MS)) {
      if (typeof getSignedUrlFn === 'function') {
        signedUrl = await getSignedUrlFn(file);
      } else {
        signedUrl = await getOrFetchSignedUrl(file, signal);
      }
    }
    if (!signedUrl || signal?.aborted) return;

    // Cache signedUrl in LRU cache
    putCachedPreviewEntry(fileId, {
      signedUrl,
      signedUrlFetchedAt: Date.now(),
    });

    // 3. For .heic / .heif, fetch + decode via decodeHeicToBlob into previewLruCache
    // (deduplicated via inFlightPromises so clicking > mid-preload awaits the same promise instead of decoding twice)
    if (isHeic) {
      await getOrDecodeHeic(file, signedUrl, signal, { priority: 'low', maxDimension: 2048 });
      return;
    }

    // 4. For standard images (jpg, jpeg, png, webp, gif), warm browser cache and decode pixels off-screen via img.decode()
    if (isStandardImage) {
      const img = new Image();
      img.src = signedUrl;
      if (typeof img.decode === 'function') {
        try {
          await img.decode();
        } catch (_) {
          // ignore decode errors for background preload
        }
      }
      return;
    }

    // 5. For videos/PDFs, only lightweight signedUrl metadata is warmed (zero large binary stream downloads)
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.warn(`[Preload] Safe warm-up skipped for ${file.name || fileId}:`, err?.message || err);
    }
  }
}

/**
 * Stage 1 (Immediate - 0ms delay): Eagerly fetches signed /access URLs for
 * immediate neighbor files (index + 1, + 2, - 1) and populates LRU cache.
 */
export async function prefetchMediaUrl(file, getSignedUrlFn, signal) {
  if (!file || signal?.aborted) return null;
  const fileId = String(file._id || file.id || file.s3Key || '');
  if (!fileId) return null;

  const existing = getCachedPreviewEntry(fileId);
  if (existing?.signedUrl && (Date.now() - existing.signedUrlFetchedAt < SIGNED_URL_TTL_MS)) {
    return existing.signedUrl;
  }

  try {
    let signedUrl;
    if (typeof getSignedUrlFn === 'function') {
      signedUrl = await getSignedUrlFn(file);
    } else {
      signedUrl = await getOrFetchSignedUrl(file, signal);
    }
    if (signedUrl) {
      putCachedPreviewEntry(fileId, {
        signedUrl,
        signedUrlFetchedAt: Date.now(),
      });
    }
    return signedUrl || null;
  } catch (e) {
    return null;
  }
}

/**
 * Convenience wrapper for neighbor preloading.
 */
export async function preloadNeighborFile(file, signal) {
  return preloadMediaItem(file, null, signal);
}

/**
 * Lazy HEIC/HEIF Decoder & Renderer with LRU Caching
 * Leverages bounded LRU cache for 0ms transitions across slides with zero loading spinner flash.
 */
export function HeicPreviewImage({ fileId, src, alt, className, fallbackUrl, thumbnailUrl, file, onLoad }) {
  const targetFile = file || { _id: fileId, name: alt };
  const resolvedId = String(fileId || file?._id || file?.id || (src ? src.split('?')[0] : ''));

  // Synchronous cache hit check on initial render - renders immediately in 0 ms with zero spinner flash
  const cachedInitialBlob = resolvedId ? getCachedPreviewEntry(resolvedId)?.decodedBlobUrl || null : null;

  const [blobUrl, setBlobUrl] = useState(cachedInitialBlob);
  const [isLoading, setIsLoading] = useState(!cachedInitialBlob);
  const [hasError, setHasError] = useState(false);

  const onLoadRef = React.useRef(onLoad);
  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  const srcRef = React.useRef(src);
  useEffect(() => {
    srcRef.current = src;
  }, [src]);

  const photoKey = resolvedId || src;

  useEffect(() => {
    // 1. If already cached in LRU, use it immediately in 0ms with zero loading spinner flash
    if (resolvedId) {
      const cached = getCachedPreviewEntry(resolvedId);
      if (cached?.decodedBlobUrl) {
        if (blobUrl !== cached.decodedBlobUrl) {
          setBlobUrl(cached.decodedBlobUrl);
        }
        setIsLoading(false);
        setHasError(false);
        if (onLoadRef.current) onLoadRef.current(cached.decodedBlobUrl);
        return;
      }
    }

    if (!photoKey) {
      setIsLoading(false);
      setHasError(true);
      if (onLoadRef.current) onLoadRef.current(null);
      return;
    }

    let isMounted = true;
    const abortController = new AbortController();

    async function decodeHeic() {
      setIsLoading(true);
      setHasError(false);

      try {
        const targetSrc = srcRef.current || src;
        const objectUrl = await getOrDecodeHeic(targetFile, targetSrc, abortController.signal, {
          priority: 'high',
          maxDimension: 2048,
        });
        if (!isMounted) return;

        if (objectUrl) {
          setBlobUrl(objectUrl);
          setIsLoading(false);
          setHasError(false);
          if (onLoadRef.current) onLoadRef.current(objectUrl);
        } else {
          setIsLoading(false);
          setHasError(true);
          if (onLoadRef.current) onLoadRef.current(null);
        }
      } catch (err) {
        if (err?.name === 'AbortError') {
          // Decode was aborted/re-triggered: do NOT fall back to thumbnail or error state
          return;
        }
        console.error('[HEIC Decode Error]', err);
        if (isMounted) {
          setIsLoading(false);
          setHasError(true);
          if (onLoadRef.current) onLoadRef.current(null);
        }
      }
    }

    decodeHeic();

    return () => {
      isMounted = false;
      abortController.abort();
      // decodedBlobUrl is preserved in the 25-item LRU cache for 0ms back-and-forth navigation,
      // and is revoked only when evicted from previewLruCache.
    };
  }, [photoKey]);

  const effectiveFallback = fallbackUrl || thumbnailUrl;

  if (isLoading) {
    return (
      <div className="relative flex items-center justify-center max-h-[80vh] w-full min-h-[200px]">
        {effectiveFallback && !/\.(heic|heif)(\?|$)/i.test(effectiveFallback) && (
          <img
            src={effectiveFallback}
            alt={alt}
            crossOrigin={typeof effectiveFallback === 'string' && (effectiveFallback.startsWith('https://files.cloudguard.site') || effectiveFallback.includes('files.cloudguard.site')) ? 'use-credentials' : undefined}
            className={`${className} filter blur-[2px] opacity-70`}
          />
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/20 rounded-lg">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <span className="text-xs font-medium text-white/90 drop-shadow">Loading high-resolution photo...</span>
        </div>
      </div>
    );
  }

  if (hasError || !blobUrl) {
    if (effectiveFallback && !/\.(heic|heif)(\?|$)/i.test(effectiveFallback)) {
      return (
        <img
          src={effectiveFallback}
          alt={alt}
          crossOrigin={typeof effectiveFallback === 'string' && (effectiveFallback.startsWith('https://files.cloudguard.site') || effectiveFallback.includes('files.cloudguard.site')) ? 'use-credentials' : undefined}
          className={className}
        />
      );
    }
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-3 text-neutral-500 dark:text-neutral-400">
        <span className="material-symbols-outlined text-4xl">visibility_off</span>
        <p className="text-sm font-medium">Preview not available for this HEIC image.</p>
      </div>
    );
  }

  return <img src={blobUrl} alt={alt} className={className} />;
}

/**
 * Abortable video preview component that immediately halts network buffering and
 * detaches media streams when navigating slides or unmounting.
 */
export function PreviewVideo({ src, className, posterUrl, onDownload, ...props }) {
  const videoRef = React.useRef(null);
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoError, setVideoError] = useState(false);

  useEffect(() => {
    setIsVideoLoading(true);
    setVideoError(false);

    const video = videoRef.current;
    return () => {
      if (video) {
        try {
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch (e) {
          // ignore
        }
      }
    };
  }, [src]);

  if (videoError) {
    return (
      <div className="relative z-10 max-w-sm w-full mx-auto rounded-2xl bg-neutral-900/80 backdrop-blur-xl border border-white/15 p-6 text-center shadow-2xl flex flex-col items-center gap-3">
        <span className="material-symbols-outlined text-4xl text-amber-400">videocam_off</span>
        <p className="text-sm font-medium text-white">
          This video format couldn&apos;t stream inline
        </p>
        {typeof onDownload === 'function' && (
          <button
            type="button"
            onClick={onDownload}
            className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Download Video</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-center w-full h-full">
      <video
        ref={videoRef}
        src={src}
        poster={posterUrl || undefined}
        controls
        playsInline
        preload="metadata"
        crossOrigin={typeof src === 'string' && (src.startsWith('https://files.cloudguard.site') || src.includes('files.cloudguard.site')) ? 'use-credentials' : undefined}
        className={className}
        onLoadedData={(e) => {
          setIsVideoLoading(false);
          setVideoError(false);
          const p = e.currentTarget.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }}
        onCanPlay={() => {
          setIsVideoLoading(false);
          setVideoError(false);
        }}
        onPlaying={() => {
          setIsVideoLoading(false);
          setVideoError(false);
        }}
        onError={() => {
          setIsVideoLoading(false);
          setVideoError(true);
        }}
        {...props}
      >
        Your browser does not support the video tag.
      </video>
      {isVideoLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white pointer-events-none z-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <span className="text-xs font-medium drop-shadow">Loading video...</span>
        </div>
      )}
    </div>
  );
}

export default function FilePreviewModal(props) {
  const activeFile = props.previewFile || props.file;
  const isOpen = props.isOpen !== undefined ? props.isOpen : Boolean(activeFile);
  if (!isOpen || !activeFile) return null;
  return <FilePreviewModalInner {...props} previewFile={activeFile} />;
}

function FilePreviewModalInner({
  previewFile,
  previewUrl,
  url,
  previewText,
  closePreview,
  onClose,
  handleDownload,
  onDownload,
  files,
  fileList,
  allFiles,
  mediaList,
  currentIndex,
  onNavigate,
  onNext,
  onPrev,
}) {
  const fileId = previewFile._id || previewFile.id;
  const resolveClose = closePreview || onClose;
  const resolveDownload = handleDownload || onDownload;

  const [activeHeicLoadedId, setActiveHeicLoadedId] = useState(null);
  const [mediaLoaded, setMediaLoaded] = useState(false);

  const handleClose = useCallback(() => {
    setActiveHeicLoadedId(null);
    setMediaLoaded(false);
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
    }
    if (typeof resolveClose === 'function') {
      resolveClose();
    }
  }, [resolveClose]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Populate LRU cache whenever previewUrl is passed
  const passedUrl = previewUrl || url;
  useEffect(() => {
    if (previewFile && passedUrl && fileId) {
      putCachedPreviewEntry(fileId, {
        signedUrl: passedUrl,
        signedUrlFetchedAt: Date.now(),
      });
    }
  }, [previewFile, passedUrl, fileId]);

  const cachedEntry = fileId ? getCachedPreviewEntry(fileId) : null;
  const effectiveUrl = (cachedEntry?.signedUrl && (Date.now() - cachedEntry.signedUrlFetchedAt < SIGNED_URL_TTL_MS))
    ? cachedEntry.signedUrl
    : (passedUrl || previewFile.s3Url || previewFile.url || previewFile.downloadUrl || '');

  const items = files || fileList || allFiles || mediaList || [];
  const hasItems = Array.isArray(items) && items.length > 0;
  const activeIdx = typeof currentIndex === 'number' && currentIndex >= 0
    ? currentIndex
    : hasItems
    ? items.findIndex((f) => String(f._id || f.id) === String(fileId))
    : -1;

  const hasPrev = activeIdx > 0;
  const hasNext = activeIdx >= 0 && activeIdx < items.length - 1;

  const handlePrev = useCallback(() => {
    if (onPrev) {
      onPrev();
    } else if (onNavigate && hasPrev) {
      onNavigate(activeIdx - 1, items[activeIdx - 1]);
    }
  }, [onPrev, onNavigate, hasPrev, activeIdx, items]);

  const handleNext = useCallback(() => {
    if (onNext) {
      onNext();
    } else if (onNavigate && hasNext) {
      onNavigate(activeIdx + 1, items[activeIdx + 1]);
    }
  }, [onNext, onNavigate, hasNext, activeIdx, items]);

  // Keyboard navigation (< / > / Escape)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft' && hasPrev) {
        handlePrev();
      } else if (e.key === 'ArrowRight' && hasNext) {
        handleNext();
      } else if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasPrev, hasNext, handlePrev, handleNext, handleClose]);

  // File type detection
  const thumbnailUrl = previewFile?.thumbnailUrl || previewFile?.thumbnail;
  const fileExt = (previewFile.type || (previewFile.name || '').split('.').pop() || '').toLowerCase();
  const isPdf = fileExt === 'pdf' || previewFile?.mimeType === 'application/pdf';
  const isMobileViewport = typeof window !== 'undefined' && (window.innerWidth < 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  const isHeic = fileExt === 'heic' || fileExt === 'heif' || previewFile?.mimeType === 'image/heic' || previewFile?.mimeType === 'image/heif';
  const isVideo = Boolean(
    previewFile?.mimeType?.startsWith('video/') ||
    previewFile?.mimetype?.startsWith('video/') ||
    ['mp4', 'webm', 'ogg', 'mov', 'mkv'].includes(fileExt)
  );
  const isStandardImage = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico'].includes(fileExt) ||
    Boolean(!isHeic && (previewFile?.mimeType?.startsWith('image/') || previewFile?.mimetype?.startsWith('image/')));
  const isAudio = Boolean(
    previewFile?.mimeType?.startsWith('audio/') ||
    previewFile?.mimetype?.startsWith('audio/') ||
    /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(previewFile?.name || '')
  );
  const isText = ['txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'html', 'css', 'py', 'java', 'c', 'cpp', 'log', 'xml', 'yaml', 'yml'].includes(fileExt);

  const ambientBlurSrc = thumbnailUrl || (isStandardImage && effectiveUrl ? effectiveUrl : null);

  // Reset active slide states on file switch
  useEffect(() => {
    setActiveHeicLoadedId(null);
    setMediaLoaded(false);
  }, [fileId]);

  // Eagerly pre-warm HEIC worker and WebAssembly module as soon as modal opens
  useEffect(() => {
    import('../utils/heicDecoder')
      .then((m) => m.warmupHeicWorker?.())
      .catch(() => {});
  }, []);

  // Stage 1 (Immediate - 0ms delay on active slide change):
  // Pre-fetch lightweight signed /access URLs for index + 1, index + 2, and index - 1 immediately
  useEffect(() => {
    if (!previewFile || !hasItems || activeIdx < 0) return;

    const next1 = activeIdx + 1 < items.length ? items[activeIdx + 1] : null;
    const next2 = activeIdx + 2 < items.length ? items[activeIdx + 2] : null;
    const prev1 = activeIdx - 1 >= 0 ? items[activeIdx - 1] : null;
    if (!next1 && !next2 && !prev1) return;

    const abortController = new AbortController();
    if (next1) prefetchMediaUrl(next1, null, abortController.signal);
    if (next2) prefetchMediaUrl(next2, null, abortController.signal);
    if (prev1) prefetchMediaUrl(prev1, null, abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [previewFile, hasItems, activeIdx, items]);

  // Stage 2 (150ms after active slide finishes loading and decoding):
  // Pre-warm media in forward-first order (index + 1, then + 2, then - 1) with { priority: 'low' }
  const isActiveSlideBusy = isHeic
    ? (!cachedEntry?.decodedBlobUrl && activeHeicLoadedId !== fileId)
    : !effectiveUrl;

  useEffect(() => {
    if (!previewFile || isActiveSlideBusy || !hasItems || activeIdx < 0) return;

    const next1 = activeIdx + 1 < items.length ? items[activeIdx + 1] : null;
    const next2 = activeIdx + 2 < items.length ? items[activeIdx + 2] : null;
    const prev1 = activeIdx - 1 >= 0 ? items[activeIdx - 1] : null;
    if (!next1 && !next2 && !prev1) return;

    const abortController = new AbortController();
    const timeoutId = setTimeout(async () => {
      // Prioritize forward slides: index + 1, then index + 2, then index - 1
      if (next1 && !abortController.signal.aborted) {
        await preloadNeighborFile(next1, abortController.signal);
      }
      if (next2 && !abortController.signal.aborted) {
        await preloadNeighborFile(next2, abortController.signal);
      }
      if (prev1 && !abortController.signal.aborted) {
        await preloadNeighborFile(prev1, abortController.signal);
      }
    }, 150);

    return () => {
      clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [previewFile, isActiveSlideBusy, hasItems, activeIdx, items]);

  return (
    <div
      className="fixed inset-0 z-50 w-screen max-w-full overflow-x-hidden flex items-center justify-center bg-black/75 backdrop-blur-xl p-2 sm:p-4 animate-enter select-none"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col bg-[#141414]/95 border border-white/10 rounded-2xl shadow-2xl text-neutral-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 sm:gap-3 w-full max-w-full px-3 sm:px-4 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            {isVideo ? (
              <span className="material-symbols-outlined text-amber-400 text-[20px] shrink-0">movie</span>
            ) : isStandardImage || isHeic ? (
              <span className="material-symbols-outlined text-blue-400 text-[20px] shrink-0">image</span>
            ) : isPdf ? (
              <span className="material-symbols-outlined text-red-400 text-[20px] shrink-0">picture_as_pdf</span>
            ) : isAudio ? (
              <span className="material-symbols-outlined text-emerald-400 text-[20px] shrink-0">music_note</span>
            ) : (
              <span className="material-symbols-outlined text-neutral-400 text-[20px] shrink-0">description</span>
            )}
            <span
              className="block min-w-0 flex-1 truncate text-sm sm:text-base font-medium text-white"
              title={previewFile.originalName || previewFile.name}
            >
              {previewFile.originalName || previewFile.name}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => resolveDownload && resolveDownload(previewFile)}
              className="p-2 rounded-full bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white border border-neutral-700/50 transition-colors cursor-pointer shrink-0"
              title="Download File"
              aria-label="Download File"
            >
              <Download className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="p-2 rounded-full bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 hover:text-white border border-neutral-700/50 transition-colors cursor-pointer shrink-0"
              title="Close"
              aria-label="Close"
            >
              <X className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            </button>
          </div>
        </div>

        <div className="relative flex-1 overflow-hidden bg-black/40 p-2 sm:p-4 flex items-center justify-center min-h-[300px]">
          {ambientBlurSrc ? (
            <img
              src={ambientBlurSrc}
              alt=""
              aria-hidden="true"
              crossOrigin={typeof ambientBlurSrc === 'string' && (ambientBlurSrc.startsWith('https://files.cloudguard.site') || ambientBlurSrc.includes('files.cloudguard.site')) ? 'use-credentials' : undefined}
              className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-35 pointer-events-none select-none"
            />
          ) : (
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-br from-white/5 via-neutral-900/60 to-black/80 backdrop-blur-md pointer-events-none select-none"
            />
          )}

          {hasPrev && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
              className="absolute left-2 sm:left-4 z-30 p-2 sm:p-3 rounded-full bg-black/60 hover:bg-black/80 text-white/90 hover:text-white border border-white/20 shadow-xl transition-all cursor-pointer active:scale-95"
              aria-label="Previous file"
              title="Previous (Left Arrow)"
            >
              <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          )}

          {!isAudio && isVideo ? (
            <div className="relative z-10 flex items-center justify-center w-full h-full max-h-[75vh]">
              {effectiveUrl ? (
                <PreviewVideo
                  key={effectiveUrl}
                  src={effectiveUrl}
                  posterUrl={thumbnailUrl || undefined}
                  onDownload={() => resolveDownload && resolveDownload(previewFile)}
                  className="max-w-full max-h-[75vh] rounded-lg object-contain shadow-2xl bg-black"
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 text-white min-h-[200px] pointer-events-none">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                  <span className="text-xs font-medium drop-shadow">Loading video...</span>
                </div>
              )}
            </div>
          ) : isHeic ? (
            <div className="relative z-10 flex items-center justify-center w-full h-full max-h-[75vh]">
              <HeicPreviewImage
                key={fileId}
                src={effectiveUrl}
                alt={previewFile.name}
                file={previewFile}
                fileId={fileId}
                className="max-w-full max-h-[75vh] object-contain shadow-sm rounded-lg"
                fallbackUrl={thumbnailUrl}
                onLoad={() => setActiveHeicLoadedId(fileId)}
              />
            </div>
          ) : isStandardImage ? (
            <div className="relative z-10 flex items-center justify-center w-full h-full max-h-[75vh]">
              {!mediaLoaded && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-neutral-300 z-20 pointer-events-none">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                  <span className="text-xs font-medium">Loading high-resolution photo...</span>
                </div>
              )}
              {effectiveUrl && (
                <img
                  src={effectiveUrl}
                  alt={previewFile.name}
                  onLoad={() => setMediaLoaded(true)}
                  onError={() => setMediaLoaded(true)}
                  crossOrigin={typeof effectiveUrl === 'string' && (effectiveUrl.startsWith('https://files.cloudguard.site') || effectiveUrl.includes('files.cloudguard.site')) ? 'use-credentials' : undefined}
                  className={`max-w-full max-h-[75vh] object-contain shadow-sm rounded-lg transition-opacity duration-300 ${
                    mediaLoaded ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              )}
            </div>
          ) : isPdf ? (
            <div className="w-full h-[75vh] relative z-10 flex items-center justify-center">
              {isMobileViewport ? (
                <MobilePdfViewer
                  url={effectiveUrl}
                  fileName={previewFile.originalName || previewFile.name}
                  onDownload={() => resolveDownload && resolveDownload(previewFile)}
                />
              ) : effectiveUrl ? (
                <>
                  {!mediaLoaded && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-neutral-300 pointer-events-none">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                      <span className="text-xs font-medium">Loading document...</span>
                    </div>
                  )}
                  <iframe
                    src={effectiveUrl}
                    onLoad={() => setMediaLoaded(true)}
                    className="w-full h-full border-0 rounded-lg bg-white relative z-10"
                    title="PDF Preview"
                  />
                </>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 text-neutral-300 min-h-[200px]">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                  <span className="text-xs font-medium">Loading document...</span>
                </div>
              )}
            </div>
          ) : isText ? (
            <pre className="relative z-10 w-full h-full max-h-[75vh] text-left bg-white dark:bg-[#121212] text-neutral-900 dark:text-neutral-100 p-6 rounded-lg overflow-auto text-sm font-mono whitespace-pre-wrap shadow-inner border border-neutral-200 dark:border-neutral-800">
              {previewText || 'Loading preview...'}
            </pre>
          ) : (isAudio && effectiveUrl) ? (
            <div className="relative z-10 w-full max-w-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 sm:p-8 shadow-xl flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl">music_note</span>
              </div>
              <div className="max-w-full px-2">
                <h4 className="text-base sm:text-lg font-semibold text-neutral-900 dark:text-white truncate" title={previewFile.name}>
                  {previewFile.name}
                </h4>
              </div>
              <audio
                controls
                autoPlay
                preload="metadata"
                src={effectiveUrl}
                crossOrigin={typeof effectiveUrl === 'string' && (effectiveUrl.startsWith('https://files.cloudguard.site') || effectiveUrl.includes('files.cloudguard.site')) ? 'use-credentials' : undefined}
                className="w-full max-w-md"
              />
            </div>
          ) : (
            <div className="relative z-10 text-neutral-300 flex flex-col items-center gap-3 p-8 text-center">
              <span className="material-symbols-outlined text-4xl">visibility_off</span>
              <p className="text-sm">Preview not available for this file type.</p>
              {typeof resolveDownload === 'function' && (
                <button
                  type="button"
                  onClick={() => resolveDownload(previewFile)}
                  className="mt-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors cursor-pointer"
                >
                  Download to view
                </button>
              )}
            </div>
          )}

          {hasNext && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              className="absolute right-2 sm:right-4 z-30 p-2 sm:p-3 rounded-full bg-black/60 hover:bg-black/80 text-white/90 hover:text-white border border-white/20 shadow-xl transition-all cursor-pointer active:scale-95"
              aria-label="Next file"
              title="Next (Right Arrow)"
            >
              <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
