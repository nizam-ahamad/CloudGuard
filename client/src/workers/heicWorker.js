/**
 * CloudGuard - Dedicated Web Worker for Off-Thread HEIC / HEIF Decoding
 *
 * Runs libheif-js WebAssembly off the main UI thread to eliminate click lag,
 * frame drops, and mobile UI freezing.
 * Uses OffscreenCanvas where available and caps output dimensions at maxDimension (2048px)
 * for lightning-fast mobile rendering and minimal memory footprint.
 */

let libheifInstance = null;

async function getLibheif() {
  if (libheifInstance) return libheifInstance;
  const mod = await import('libheif-js/wasm-bundle');
  const libheif = mod.default || mod;
  libheifInstance = typeof libheif === 'function' ? libheif() : libheif;
  return libheifInstance;
}

self.onmessage = async (e) => {
  const { id, buffer, maxDimension = 2048, quality = 0.85 } = e.data || {};

  try {
    if (!buffer) {
      throw new Error('No buffer provided for HEIC decoding');
    }

    const libheif = await getLibheif();
    const decoder = new libheif.HeifDecoder();
    const uint8Array = new Uint8Array(buffer);
    const images = decoder.decode(uint8Array);

    if (!images || images.length === 0) {
      throw new Error('No images found in HEIF container');
    }

    const image = images[0];
    const width = image.get_width();
    const height = image.get_height();

    if (!width || !height) {
      throw new Error(`Invalid HEIC image dimensions: ${width}x${height}`);
    }

    // 1. Calculate target dimensions capped at maxDimension (default 2048px)
    let targetWidth = width;
    let targetHeight = height;
    const maxEdge = Math.max(width, height);
    if (maxDimension && maxEdge > maxDimension) {
      const scale = maxDimension / maxEdge;
      targetWidth = Math.max(1, Math.round(width * scale));
      targetHeight = Math.max(1, Math.round(height * scale));
    }

    // 2. OffscreenCanvas rendering entirely off the main thread
    if (typeof OffscreenCanvas !== 'undefined') {
      const origCanvas = new OffscreenCanvas(width, height);
      const origCtx = origCanvas.getContext('2d');
      if (origCtx) {
        const imageData = origCtx.createImageData(width, height);
        await new Promise((resolve, reject) => {
          image.display(imageData, (displayData) => {
            if (displayData) resolve(displayData);
            else reject(new Error('HEIC display failed'));
          });
        });
        origCtx.putImageData(imageData, 0, 0);

        let finalCanvas = origCanvas;
        if (targetWidth !== width || targetHeight !== height) {
          finalCanvas = new OffscreenCanvas(targetWidth, targetHeight);
          const finalCtx = finalCanvas.getContext('2d');
          finalCtx.drawImage(origCanvas, 0, 0, targetWidth, targetHeight);
        }

        let blob = null;
        if (typeof finalCanvas.convertToBlob === 'function') {
          try {
            blob = await finalCanvas.convertToBlob({ type: 'image/webp', quality });
          } catch (e) {
            blob = null;
          }
          if (!blob) {
            try {
              blob = await finalCanvas.convertToBlob({ type: 'image/jpeg', quality });
            } catch (e) {
              blob = null;
            }
          }
        }

        if (blob) {
          self.postMessage({ id, success: true, blob });
          return;
        }
      }
    }

    // Fallback: If OffscreenCanvas or convertToBlob is not supported, transfer pixel buffer
    const rawData = new Uint8ClampedArray(width * height * 4);
    const fallbackImageData = typeof ImageData !== 'undefined'
      ? new ImageData(rawData, width, height)
      : { data: rawData, width, height };

    await new Promise((resolve, reject) => {
      image.display(fallbackImageData, (displayData) => {
        if (displayData) resolve(displayData);
        else reject(new Error('HEIC display failed'));
      });
    });

    self.postMessage(
      {
        id,
        success: true,
        raw: {
          data: rawData.buffer,
          width,
          height,
          targetWidth,
          targetHeight,
        },
      },
      [rawData.buffer]
    );
  } catch (err) {
    self.postMessage({
      id,
      success: false,
      error: err?.message || 'HEIC decode failed',
    });
  }
};
