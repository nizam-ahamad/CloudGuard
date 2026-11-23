import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchAccessUrl } from '../utils/accessUrlCache';

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
export function PreviewVideo({ src, className, posterUrl, ...props }) {
  const videoRef = React.useRef(null);
  const [isBuffering, setIsBuffering] = useState(true);

  useEffect(() => {
    setIsBuffering(true);
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

  return (
    <div className="relative flex items-center justify-center">
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
          setIsBuffering(false);
          const p = e.currentTarget.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }}
        onPlaying={() => setIsBuffering(false)}
        onWaiting={() => setIsBuffering(true)}
        onError={() => setIsBuffering(false)}
        {...props}
      >
        Your browser does not support the video tag.
      </video>
      {isBuffering && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/30 pointer-events-none rounded-lg">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <span className="text-xs font-medium text-white/90 drop-shadow">Loading video...</span>
        </div>
      )}
    </div>
  );
}

export default function FilePreviewModal({
  previewFile,
  previewUrl,
  previewText,
  closePreview,
  handleDownload,
  files,
  fileList,
  allFiles,
  mediaList,
  currentIndex,
  onNavigate,
  onNext,
  onPrev,
}) {
  if (!previewFile) return null;

  const fileId = previewFile._id || previewFile.id;

  // Populate LRU cache whenever previewUrl is passed
  useEffect(() => {
    if (previewFile && previewUrl && fileId) {
      putCachedPreviewEntry(fileId, {
        signedUrl: previewUrl,
        signedUrlFetchedAt: Date.now(),
      });
    }
  }, [previewFile, previewUrl, fileId]);

  const cachedEntry = fileId ? getCachedPreviewEntry(fileId) : null;
  const effectiveUrl = (cachedEntry?.signedUrl && (Date.now() - cachedEntry.signedUrlFetchedAt < SIGNED_URL_TTL_MS))
    ? cachedEntry.signedUrl
    : (previewUrl || previewFile.s3Url || previewFile.url || previewFile.downloadUrl || '');

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
      } else if (e.key === 'Escape' && closePreview) {
        closePreview();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasPrev, hasNext, handlePrev, handleNext, closePreview]);

  // File type detection
  const [activeHeicLoadedId, setActiveHeicLoadedId] = useState(null);
  const thumbnailUrl = previewFile?.thumbnailUrl || previewFile?.thumbnail;
  const fileExt = (previewFile.type || (previewFile.name || '').split('.').pop() || '').toLowerCase();
  const isHeic = fileExt === 'heic' || fileExt === 'heif' || previewFile?.mimeType === 'image/heic' || previewFile?.mimeType === 'image/heif';
  const isAudio = Boolean(
    previewFile?.mimeType?.startsWith('audio/') ||
    previewFile?.mimetype?.startsWith('audio/') ||
    /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(previewFile?.name || '')
  );

  // Reset active HEIC loaded state on file switch
  useEffect(() => {
    setActiveHeicLoadedId(null);
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

  return !isAudio && ['mp4', 'webm', 'ogg', 'mov', 'mkv'].includes(fileExt) ? (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-md">
      <div className="flex items-center justify-between p-4 bg-transparent text-white w-full">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-white">movie</span>
          <h3 className="font-title-md text-title-md font-medium truncate">{previewFile.name}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleDownload(previewFile)}
            className="p-2 text-white/80 hover:bg-white/10 rounded-full transition-colors flex items-center cursor-pointer"
            title="Download File"
          >
            <span className="material-symbols-outlined">download</span>
          </button>
          <button
            onClick={closePreview}
            className="p-2 text-white/80 hover:bg-white/10 rounded-full transition-colors cursor-pointer"
            title="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden flex items-center justify-center p-4 w-full max-w-5xl mx-auto">
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
        {effectiveUrl ? (
          <PreviewVideo
            key={effectiveUrl}
            src={effectiveUrl}
            posterUrl={thumbnailUrl || undefined}
            className="max-w-full max-h-[80vh] rounded-lg object-contain shadow-2xl bg-black"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 text-white/80 min-h-[200px]">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <span className="text-xs font-medium">Loading preview...</span>
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
  ) : (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#18181b] rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-100">
        <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60">
          <h3 className="font-title-lg text-neutral-900 dark:text-white font-semibold truncate pr-4">{previewFile.name}</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDownload(previewFile)}
              className="bg-primary text-on-primary hover:bg-primary/90 transition-colors p-2 rounded-lg flex items-center justify-center cursor-pointer"
              title="Download File"
            >
              <span className="material-symbols-outlined">download</span>
            </button>
            <button
              onClick={closePreview}
              className="p-2 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-full transition-colors cursor-pointer"
              title="Close"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
        <div className="relative flex-1 overflow-auto bg-neutral-100 dark:bg-neutral-950 p-4 flex items-center justify-center">
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

          {isHeic ? (
            <HeicPreviewImage
              key={fileId}
              src={effectiveUrl}
              alt={previewFile.name}
              file={previewFile}
              fileId={fileId}
              className="max-w-full max-h-[70vh] object-contain shadow-sm rounded"
              fallbackUrl={previewFile.thumbnailUrl || previewFile.thumbnail}
              onLoad={() => setActiveHeicLoadedId(fileId)}
            />
          ) : ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(fileExt) ? (
            effectiveUrl ? (
              <img
                src={effectiveUrl}
                alt={previewFile.name}
                crossOrigin={typeof effectiveUrl === 'string' && (effectiveUrl.startsWith('https://files.cloudguard.site') || effectiveUrl.includes('files.cloudguard.site')) ? 'use-credentials' : undefined}
                className="max-w-full max-h-[70vh] object-contain shadow-sm rounded"
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 text-neutral-400 min-h-[200px]">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                <span className="text-xs font-medium">Loading high-resolution photo...</span>
              </div>
            )
          ) : fileExt === 'pdf' ? (
            effectiveUrl ? (
              <iframe src={effectiveUrl} className="w-full h-[70vh] border-0 rounded" title="PDF Preview" />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 text-neutral-400 min-h-[200px]">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                <span className="text-xs font-medium">Loading preview...</span>
              </div>
            )
          ) : (fileExt === 'txt' || fileExt === 'md') ? (
            <pre className="w-full h-full text-left bg-white dark:bg-[#121212] text-neutral-900 dark:text-neutral-100 p-6 rounded-lg overflow-auto text-sm font-mono whitespace-pre-wrap shadow-inner border border-neutral-200 dark:border-neutral-800">
              {previewText || 'Loading preview...'}
            </pre>
          ) : (isAudio && effectiveUrl) ? (
            <div className="w-full max-w-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 sm:p-8 shadow-xl flex flex-col items-center text-center space-y-4">
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
            <div className="text-neutral-500 dark:text-neutral-400 flex flex-col items-center gap-3">
              <span className="material-symbols-outlined text-4xl">visibility_off</span>
              <p>Preview not available for this file type.</p>
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
