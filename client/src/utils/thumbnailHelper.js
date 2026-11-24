/**
 * CloudGuard High-DPI Thumbnail Engine with Automatic EXIF Orientation
 * Generates compact, upright 320px WebP thumbnails (quality 0.78)
 * Supports JPEG, PNG, WebP, GIF, BMP, SVG, AVIF, HEIC, HEIF, TIFF, ICO, and video files.
 */

// Cached dynamic loader for heic2any fallback
let heic2anyLoader = null;
async function getHeic2any() {
  if (!heic2anyLoader) {
    heic2anyLoader = import('heic2any').then((mod) => mod.default || mod);
  }
  return heic2anyLoader;
}

export const IMAGE_EXTENSIONS_REGEX = /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|heif|tiff?|ico)$/i;

/**
 * Helper to identify HEIC / HEIF files by MIME type or file extension,
 * even when file.type is empty ("") or application/octet-stream.
 */
export const isHeicFile = (fileOrName) => {
  if (!fileOrName) return false;
  if (typeof fileOrName === 'string') {
    return /\.(heic|heif)$/i.test(fileOrName);
  }
  const type = fileOrName.type || fileOrName.mimeType || fileOrName.mimetype || '';
  const name = fileOrName.name || fileOrName.originalName || '';
  return /^image\/(heic|heif)(-sequence)?$/i.test(type) || /\.(heic|heif)$/i.test(name);
};

/**
 * Renders a decoded ImageBitmap or HTMLImageElement onto a 320px max-edge canvas
 * and exports an image/webp data URL (with JPEG fallback if WebP canvas encoding is unavailable).
 */
function drawSourceToWebpDataUrl(source, rawWidth, rawHeight, maxDimension, quality) {
  let width = rawWidth || maxDimension;
  let height = rawHeight || maxDimension;

  if (width > height) {
    if (width > maxDimension) {
      height = Math.max(1, Math.round((height * maxDimension) / width));
      width = maxDimension;
    }
  } else if (height > maxDimension) {
    width = Math.max(1, Math.round((width * maxDimension) / height));
    height = maxDimension;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  let dataUrl = null;
  try {
    dataUrl = canvas.toDataURL('image/webp', quality);
  } catch (_) {}
  if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
    try {
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    } catch (_) {
      dataUrl = null;
    }
  }
  return dataUrl;
}

/**
 * CloudGuard High-DPI Thumbnail Engine with Automatic EXIF Orientation
 * Generates compact, upright WebP thumbnails (max 320px, quality 0.78)
 * Supports JPEG, PNG, WebP, GIF, BMP, SVG, AVIF, HEIC/HEIF, TIFF, ICO, and video files.
 */
export async function generateMediaThumbnail(file, maxDimension = 320, quality = 0.78) {
  if (!file) return null;

  // 1. HEIC / HEIF detection & off-thread WASM decoding via heicDecoder.js (with heic2any fallback)
  const isHeic = isHeicFile(file);
  let imageSource = file;

  if (isHeic) {
    try {
      const { decodeHeicToBlob } = await import('./heicDecoder');
      imageSource = await decodeHeicToBlob(file, {
        quality: 0.85,
        maxDimension: Math.max(maxDimension, 512),
        priority: 'high',
      });
    } catch (workerErr) {
      try {
        const heic2any = await getHeic2any();
        const converted = await heic2any({
          blob: file,
          toType: 'image/jpeg',
          quality: 0.85,
        });
        imageSource = Array.isArray(converted) ? converted[0] : converted;
      } catch (err) {
        console.warn('[Thumbnail] HEIC decoding failed on upload:', err);
        return null;
      }
    }
  }

  // 2. Image Thumbnail Extraction (JPEG, PNG, WebP, GIF, BMP, SVG, AVIF, HEIC, HEIF, TIFF, ICO)
  const isImage =
    isHeic ||
    Boolean(file.type?.startsWith('image/')) ||
    IMAGE_EXTENSIONS_REGEX.test(file.name || '');

  if (isImage) {
    try {
      const bitmap = await createImageBitmap(imageSource, { imageOrientation: 'from-image' });
      const dataUrl = drawSourceToWebpDataUrl(bitmap, bitmap.width, bitmap.height, maxDimension, quality);
      if (typeof bitmap.close === 'function') {
        try {
          bitmap.close();
        } catch (_) {}
      }
      if (dataUrl) return dataUrl;
    } catch (_) {
      // Fallback for formats where createImageBitmap throws (e.g., SVG, ICO, or older Safari builds)
    }

    return new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(imageSource);
      const img = new Image();
      img.onload = () => {
        try {
          const width = img.naturalWidth || img.width || maxDimension;
          const height = img.naturalHeight || img.height || maxDimension;
          const dataUrl = drawSourceToWebpDataUrl(img, width, height, maxDimension, quality);
          resolve(dataUrl);
        } catch (_) {
          resolve(null);
        } finally {
          try {
            URL.revokeObjectURL(objectUrl);
          } catch (_) {}
        }
      };
      img.onerror = () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch (_) {}
        resolve(null);
      };
      img.src = objectUrl;
    });
  }

  // 3. Video Poster Frame Extraction (Default 5.0s seeker)
  if (file.type?.startsWith('video/') || file.name?.match(/\.(mp4|webm|mov|mkv)$/i)) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      const url = URL.createObjectURL(file);
      video.src = url;

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        try {
          clearTimeout(timeoutId);
        } catch (_) {}
        try {
          video.onloadedmetadata = null;
          video.onseeked = null;
          video.onerror = null;
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch (_) {}
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 5000);

      video.onloadedmetadata = () => {
        const duration = video.duration || 10;
        const targetTime = duration > 5 ? 5.0 : Math.max(0.2, duration * 0.5);
        video.currentTime = targetTime;
      };

      video.onseeked = () => {
        const dataUrl = drawSourceToWebpDataUrl(
          video,
          video.videoWidth || 320,
          video.videoHeight || 180,
          maxDimension,
          quality
        );
        cleanup();
        resolve(dataUrl);
      };

      video.onerror = () => {
        cleanup();
        resolve(null);
      };
    });
  }

  return null;
}

export const generateThumbnail = generateMediaThumbnail;
