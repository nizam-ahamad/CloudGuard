/**
 * CloudGuard - Client-Side Card Preview Generator
 *
 * Provides lazy, viewport-gated, bounded-LRU preview generation for grid cards:
 * - Direct resolution of lightweight .webp thumbnails from Backblaze B2 (via /api/photos)
 * - Strict Bandwidth Guardrail: Images NEVER download full-size multi-megabyte originals for thumbnails
 * - PDF page 1 thumbnail rendered onto canvas via pdfjs-dist
 * - Text / CSV / Code / Markdown real text snippet (first 2 KB via Range request)
 * - Video frame snapshot fallback for videos genuinely missing B2 thumbnails (metadata-only + immediate teardown)
 *
 * Guarantees:
 * - Zero EC2 server load (100% client-side in browser)
 * - Zero new Backblaze B2 storage
 * - Max 2 concurrent preview jobs (prevents mobile CPU/GPU stutter)
 * - 60-item bounded LRU cache with automatic blob: URL revocation
 * - In-flight Promise deduplication
 */

import axios from 'axios';
import { API_BASE_URL } from '../config';
import { fetchAccessUrl } from './accessUrlCache';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Module-level persistent cache for PDF page 1 thumbnails: fileId -> dataUrl (base64)
export const pdfThumbnailCache = new Map();

const MAX_CARD_PREVIEWS = 60;
const MAX_CONCURRENT_JOBS = 2;
const PHOTOS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes fresh cache

// Module-level thumbnail cache from /api/photos: fileId -> signed .webp thumbnailUrl
const mediaThumbnailMap = new Map();
let photosFetchPromise = null;
let lastPhotosFetchTime = 0;

/**
 * Returns cached B2 .webp thumbnail URL for a file if available.
 */
export function getMediaThumbnail(fileId) {
  if (!fileId) return null;
  return mediaThumbnailMap.get(String(fileId)) || null;
}

/**
 * Returns the entire media thumbnail map (for fast multi-lookup).
 */
export function getMediaThumbnailMap() {
  return mediaThumbnailMap;
}

/**
 * Clears the media thumbnail cache (e.g. after upload, rename, or delete).
 */
export function invalidateMediaThumbnailCache() {
  mediaThumbnailMap.clear();
  lastPhotosFetchTime = 0;
  photosFetchPromise = null;
}

// Auto-invalidate when files are updated anywhere in the app
if (typeof window !== 'undefined') {
  window.addEventListener('cloudguard:files-updated', () => {
    invalidateMediaThumbnailCache();
  });
}

/**
 * Loads media thumbnails for all user photos & videos from /api/photos.
 * Coalesces concurrent calls into a single in-flight Promise.
 */
export async function loadMediaThumbnails(token) {
  const now = Date.now();
  if (mediaThumbnailMap.size > 0 && now - lastPhotosFetchTime < PHOTOS_CACHE_TTL) {
    return mediaThumbnailMap;
  }

  if (photosFetchPromise) {
    return photosFetchPromise;
  }

  photosFetchPromise = (async () => {
    try {
      const authToken = token || (typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null);
      if (!authToken) return mediaThumbnailMap;

      const res = await axios.get(`${API_BASE_URL}/api/photos`, {
        headers: { Authorization: `Bearer ${authToken}` },
        withCredentials: true,
      });

      const list = Array.isArray(res.data) ? res.data : (res.data?.photos || []);
      for (const item of list) {
        if (item && item._id && item.thumbnailUrl) {
          mediaThumbnailMap.set(String(item._id), item.thumbnailUrl);
        }
      }
      lastPhotosFetchTime = Date.now();
    } catch (err) {
      console.warn('[cardPreviewGenerator] Could not load media thumbnails from /api/photos:', err?.message || err);
    } finally {
      photosFetchPromise = null;
    }
    return mediaThumbnailMap;
  })();

  return photosFetchPromise;
}

// Module-level LRU cache: fileId -> { type: 'image' | 'text' | 'none', url?, snippet?, isBlob?, isPdf?, isVideo? }
const previewCache = new Map();

// In-flight promises to deduplicate simultaneous requests for the same file
const inFlightPromises = new Map();

// Concurrency queue
let activeJobs = 0;
const jobQueue = [];

function enqueueJob(fn) {
  return new Promise((resolve, reject) => {
    jobQueue.push({ fn, resolve, reject });
    processNextJob();
  });
}

function processNextJob() {
  if (activeJobs >= MAX_CONCURRENT_JOBS || jobQueue.length === 0) return;
  const { fn, resolve, reject } = jobQueue.shift();
  activeJobs++;
  fn()
    .then(resolve)
    .catch(reject)
    .finally(() => {
      activeJobs--;
      processNextJob();
    });
}

/**
 * Returns cached preview result if available, refreshing its LRU order.
 */
export function getCachedCardPreview(fileId) {
  if (!fileId) return null;
  const key = String(fileId);
  if (pdfThumbnailCache.has(key)) {
    return { type: 'image', url: pdfThumbnailCache.get(key), isBlob: false, isPdf: true };
  }
  if (!previewCache.has(key)) return null;
  const val = previewCache.get(key);
  // Refresh order in Map
  previewCache.delete(key);
  previewCache.set(key, val);
  return val;
}

/**
 * Stores preview result into LRU cache, evicting oldest item if full.
 */
function setCachedCardPreview(fileId, data) {
  if (!fileId || !data) return;
  const key = String(fileId);

  if (previewCache.has(key)) {
    const existing = previewCache.get(key);
    if (existing && existing !== data && existing.isBlob && existing.url?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(existing.url);
      } catch (e) {
        // ignore
      }
    }
    previewCache.delete(key);
  } else if (previewCache.size >= MAX_CARD_PREVIEWS) {
    const oldestKey = previewCache.keys().next().value;
    if (oldestKey) {
      const evicted = previewCache.get(oldestKey);
      if (evicted && evicted.isBlob && evicted.url?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(evicted.url);
        } catch (e) {
          // ignore
        }
      }
      previewCache.delete(oldestKey);
    }
  }

  previewCache.set(key, data);
}

// Lazy pdfjs module loader with Vite same-origin worker assignment
let pdfjsPromise = null;
export async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist');
      if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      }
      return pdfjsLib;
    })();
  }
  return pdfjsPromise;
}

/**
 * Checks file type categories
 */
export function getFileCategory(fileName = '', mimeType = '') {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const mime = (mimeType || '').toLowerCase();

  if (ext === 'pdf' || mime.includes('pdf')) {
    return 'pdf';
  }

  const textExts = [
    'txt', 'csv', 'tsv', 'md', 'markdown', 'json', 'xml', 'log',
    'yml', 'yaml', 'js', 'jsx', 'ts', 'tsx', 'py', 'html', 'css',
    'scss', 'sql', 'sh', 'java', 'c', 'cpp', 'cs', 'php', 'rb', 'go', 'rs',
  ];
  if (textExts.includes(ext) || mime.startsWith('text/') || mime.includes('json') || mime.includes('xml')) {
    return 'text';
  }

  const videoExts = ['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v', '3gp'];
  if (videoExts.includes(ext) || mime.startsWith('video/')) {
    return 'video';
  }

  const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'heic', 'heif', 'bmp', 'tiff', 'avif'];
  if (imageExts.includes(ext) || mime.startsWith('image/')) {
    return 'image';
  }

  return 'other';
}

/**
 * 1. Text/Code/Data preview: Read up to first 2048 bytes via Range request
 */
async function generateTextSnippet(accessUrl) {
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = setTimeout(() => controller?.abort(), 6000);

    const isFilesCdn = typeof accessUrl === 'string' && (accessUrl.startsWith('https://files.cloudguard.site') || accessUrl.includes('.cloudguard.site'));
    const res = await fetch(accessUrl, {
      headers: { Range: 'bytes=0-2048' },
      signal: controller?.signal,
      ...(isFilesCdn ? { credentials: 'include' } : {}),
    });
    clearTimeout(timeoutId);

    if (!res.ok && res.status !== 206) return null;

    let text = '';
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const chunks = [];
      let totalBytes = 0;

      while (totalBytes < 2048) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        totalBytes += value.length;
        if (totalBytes >= 2048) {
          reader.cancel().catch(() => {});
          break;
        }
      }

      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        const slice = chunk.subarray(0, Math.min(chunk.length, totalBytes - offset));
        combined.set(slice, offset);
        offset += slice.length;
        if (offset >= totalBytes) break;
      }

      text = new TextDecoder('utf-8', { fatal: false }).decode(combined);
    } else {
      text = await res.text();
    }

    if (!text || !text.trim()) return null;

    // Extract first 10 lines
    const lines = text.split(/\r?\n/).slice(0, 10);
    const snippet = lines.join('\n').trim();

    return snippet ? { type: 'text', snippet } : null;
  } catch (err) {
    return null;
  }
}

/**
 * 2. PDF Page 1 Thumbnail: Render Page 1 to canvas using pdfjs-dist
 */
async function generatePdfThumbnail(fileId, accessUrl) {
  const key = fileId ? String(fileId) : null;
  if (key && pdfThumbnailCache.has(key)) {
    return { type: 'image', url: pdfThumbnailCache.get(key), isBlob: false, isPdf: true };
  }

  try {
    const pdfjsLib = await getPdfjs();
    const loadingTask = pdfjsLib.getDocument({
      url: accessUrl,
      withCredentials: false,
      disableAutoFetch: true,
      disableRange: false,
      disableStream: false,
    });

    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const unscaledViewport = page.getViewport({ scale: 1 });

    // Thumbnail scale ~0.6–0.8 (bounded for crisp display at ~320px)
    const baseWidth = unscaledViewport.width || 595;
    const scale = Math.min(0.8, Math.max(0.6, 320 / baseWidth));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d', { alpha: false });

    // Fill white background to prevent dark-mode transparency inversion
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport: viewport,
    }).promise;

    let dataUrl = null;
    try {
      dataUrl = canvas.toDataURL('image/webp', 0.8);
    } catch (_) {}
    if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
      try {
        dataUrl = canvas.toDataURL('image/png');
      } catch (_) {}
    }

    try {
      page.cleanup();
      pdf.destroy();
    } catch (e) {
      // ignore
    }

    if (!dataUrl) return null;

    if (key) {
      pdfThumbnailCache.set(key, dataUrl);
    }
    return { type: 'image', url: dataUrl, isBlob: false, isPdf: true };
  } catch (err) {
    console.warn('[cardPreviewGenerator] PDF thumbnail generation failed:', err?.message || err);
    return null;
  }
}

/**
 * 3. Video Snapshot Fallback: Capture a single frame from video metadata without downloading full file
 */
function generateVideoSnapshot(accessUrl) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.crossOrigin = 'anonymous';

    let isDone = false;
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 7000);

    function cleanup() {
      if (isDone) return;
      isDone = true;
      clearTimeout(timeoutId);
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch (e) {
        // ignore
      }
    }

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    video.onloadedmetadata = () => {
      const duration = video.duration || 1;
      const targetTime = Math.min(1.0, duration > 0 ? duration * 0.1 : 0.5);
      video.currentTime = targetTime;
    };

    video.onseeked = () => {
      try {
        const width = video.videoWidth || 320;
        const height = video.videoHeight || 240;
        const targetWidth = 320;
        const scale = targetWidth / width;
        const targetHeight = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

        canvas.toBlob((blob) => {
          cleanup();
          if (blob) {
            const url = URL.createObjectURL(blob);
            resolve({ type: 'image', url, isBlob: true, isVideo: true });
          } else {
            resolve(null);
          }
        }, 'image/webp', 0.8);
      } catch (err) {
        cleanup();
        resolve(null);
      }
    };

    video.src = accessUrl;
  });
}

/**
 * Main public entrypoint:
 * Generates or retrieves a cached card preview for the given file.
 */
export async function generateCardPreview(file, token) {
  if (!file) return null;
  const fileId = file._id || file.id;
  if (!fileId) return null;
  const key = String(fileId);

  // 1. Check persistent PDF Cache & LRU Cache
  if (pdfThumbnailCache.has(key)) {
    return { type: 'image', url: pdfThumbnailCache.get(key), isBlob: false, isPdf: true };
  }
  const cached = getCachedCardPreview(key);
  if (cached) return cached;

  // 2. In-flight Promise deduplication
  if (inFlightPromises.has(key)) {
    return inFlightPromises.get(key);
  }

  // 3. Determine file category
  const category = getFileCategory(file.name || file.originalName || '', file.mimeType || file.mimetype || '');
  if (category === 'other') {
    const noneResult = { type: 'none' };
    setCachedCardPreview(key, noneResult);
    return noneResult;
  }

  // Check file size limit for PDFs (skip if > 25MB to prevent memory issues)
  if (category === 'pdf' && file.size && file.size > 25 * 1024 * 1024) {
    const noneResult = { type: 'none' };
    setCachedCardPreview(key, noneResult);
    return noneResult;
  }

  const promise = (async () => {
    try {
      // 4. For Images and Videos: Check B2 lightweight .webp thumbnails first!
      if (category === 'image' || category === 'video') {
        let thumbUrl = file.thumbnailUrl || getMediaThumbnail(key);
        if (!thumbUrl) {
          await loadMediaThumbnails(token);
          thumbUrl = getMediaThumbnail(key);
        }

        if (thumbUrl) {
          const result = {
            type: 'image',
            url: thumbUrl,
            isBlob: false,
            isVideo: category === 'video',
          };
          setCachedCardPreview(key, result);
          return result;
        }

        // STRICT BANDWIDTH GUARDRAIL:
        // Never download full-resolution original image (3-6 MB) for a thumbnail.
        // If an image has no pre-generated B2 thumbnail, return 'none' to show stylized placeholder card.
        if (category === 'image') {
          const noneResult = { type: 'none' };
          setCachedCardPreview(key, noneResult);
          return noneResult;
        }

        // For videos genuinely missing B2 thumbnail, fall through to lightweight metadata snapshot
      }

      // 5. For PDFs, Text, or videos without B2 thumbnail: obtain secure signed access URL
      const accessUrl = await fetchAccessUrl(key, token);
      if (!accessUrl) {
        const noneResult = { type: 'none' };
        setCachedCardPreview(key, noneResult);
        return noneResult;
      }

      // Enqueue job with concurrency cap
      const result = await enqueueJob(async () => {
        if (category === 'pdf') {
          return await generatePdfThumbnail(key, accessUrl);
        }
        if (category === 'text') {
          return await generateTextSnippet(accessUrl);
        }
        if (category === 'video') {
          return await generateVideoSnapshot(accessUrl);
        }
        return null;
      });

      const finalResult = result || { type: 'none' };
      setCachedCardPreview(key, finalResult);
      return finalResult;
    } catch (err) {
      console.warn(`[cardPreviewGenerator] Failed generating preview for ${key}:`, err);
      const noneResult = { type: 'none' };
      setCachedCardPreview(key, noneResult);
      return noneResult;
    } finally {
      inFlightPromises.delete(key);
    }
  })();

  inFlightPromises.set(key, promise);
  return promise;
}
