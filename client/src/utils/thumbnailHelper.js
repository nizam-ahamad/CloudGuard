/**
 * CloudGuard High-DPI Thumbnail Engine with Automatic EXIF Orientation
 * Generates compact, upright JPEG thumbnails (< 40 KB, max 320px)
 * Optimized for Retina displays and high-resolution photo/video galleries.
 */
/**
 * Helper to identify HEIC / HEIF files by MIME type or file extension
 */
export const isHeicFile = (fileOrName) => {
  if (!fileOrName) return false;
  if (typeof fileOrName === 'string') {
    return /\.(heic|heif)$/i.test(fileOrName);
  }
  return Boolean(
    fileOrName.type === 'image/heic' ||
    fileOrName.type === 'image/heif' ||
    /\.(heic|heif)$/i.test(fileOrName.name || '')
  );
};

/**
 * CloudGuard High-DPI Thumbnail Engine with Automatic EXIF Orientation
 * Generates compact, upright JPEG/WebP thumbnails (< 40 KB, max 320px)
 * Optimized for Retina displays and high-resolution photo/video galleries.
 */
export async function generateMediaThumbnail(file, maxDimension = 320, quality = 0.7) {
  if (!file) return null;

  // 1. HEIC / HEIF detection & lazy conversion via heic2any
  const isHeic = isHeicFile(file);
  let imageSource = file;

  if (isHeic) {
    try {
      const { default: heic2any } = await import('heic2any');
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

  // 2. Image Thumbnail Extraction with Automatic EXIF Orientation
  if (isHeic || file.type?.startsWith('image/')) {
    try {
      const bitmap = await createImageBitmap(imageSource, { imageOrientation: 'from-image' });
      let { width, height } = bitmap;

      if (width > height) {
        if (width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        }
      } else if (height > maxDimension) {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);

      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (!dataUrl || dataUrl.startsWith('data:,')) {
        dataUrl = canvas.toDataURL('image/webp', quality);
      }
      return dataUrl;
    } catch (e) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = new Image();
          img.onload = () => {
            let { width, height } = img;
            if (width > height) {
              if (width > maxDimension) {
                height = Math.round((height * maxDimension) / width);
                width = maxDimension;
              }
            } else if (height > maxDimension) {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            let dataUrl = canvas.toDataURL('image/jpeg', quality);
            if (!dataUrl || dataUrl.startsWith('data:,')) {
              dataUrl = canvas.toDataURL('image/webp', quality);
            }
            resolve(dataUrl);
          };
          img.onerror = () => resolve(null);
          img.src = ev.target.result;
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(imageSource);
      });
    }
  }

  // 2. Video Poster Frame Extraction (Default 5.0s seeker)
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
        let width = video.videoWidth || 320;
        let height = video.videoHeight || 180;

        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(video, 0, 0, width, height);

        let dataUrl = null;
        try {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          if (!dataUrl || dataUrl.startsWith('data:,')) {
            dataUrl = canvas.toDataURL('image/webp', quality);
          }
        } catch (_) {}

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
