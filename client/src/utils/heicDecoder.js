/**
 * CloudGuard - Client-Side WebAssembly HEIC / HEIF Decoder
 *
 * Uses modern libheif-js (WebAssembly libheif v1.17+) to decode modern
 * iOS 17/18 10-bit .heic and .heif images at full native resolution
 * 100% on the user's device with zero server/EC2 load.
 */

let libheifInstance = null;

async function getLibheif() {
  if (libheifInstance) return libheifInstance;
  const mod = await import('libheif-js/wasm-bundle');
  const libheif = mod.default || mod;
  libheifInstance = typeof libheif === 'function' ? libheif() : libheif;
  return libheifInstance;
}

/**
 * Decodes a HEIC/HEIF Blob, File, ArrayBuffer, or Uint8Array to a full-resolution WebP (or fallback JPEG) Blob.
 *
 * @param {Blob|File|ArrayBuffer|Uint8Array} inputBlobOrBuffer - Input HEIC data
 * @param {number} quality - Output quality (0.0 to 1.0, default 0.86)
 * @returns {Promise<Blob>} Full-resolution WebP/JPEG Blob
 */
export async function decodeHeicToBlob(inputBlobOrBuffer, quality = 0.86) {
  if (!inputBlobOrBuffer) {
    throw new Error('No input provided to decodeHeicToBlob');
  }

  // 1. Convert input to Uint8Array
  let uint8Array;
  if (inputBlobOrBuffer instanceof Uint8Array) {
    uint8Array = inputBlobOrBuffer;
  } else if (inputBlobOrBuffer instanceof ArrayBuffer) {
    uint8Array = new Uint8Array(inputBlobOrBuffer);
  } else if (typeof inputBlobOrBuffer.arrayBuffer === 'function') {
    const arrayBuffer = await inputBlobOrBuffer.arrayBuffer();
    uint8Array = new Uint8Array(arrayBuffer);
  } else {
    throw new Error('Unsupported input type for HEIC decoding');
  }

  // 2. Dynamically instantiate WebAssembly libheif decoder
  const libheif = await getLibheif();
  const decoder = new libheif.HeifDecoder();
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

  // 3. Render full native resolution onto an offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create 2D canvas context for HEIC rendering');
  }

  const imageData = ctx.createImageData(width, height);
  await new Promise((resolve, reject) => {
    image.display(imageData, (displayData) => {
      if (displayData) {
        resolve(displayData);
      } else {
        reject(new Error('HEIC display failed'));
      }
    });
  });

  ctx.putImageData(imageData, 0, 0);

  // 4. Convert canvas to full-resolution WebP Blob with automatic JPEG fallback
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          return resolve(blob);
        }
        // Fallback to image/jpeg if WebP export returns null
        canvas.toBlob(
          (fallbackBlob) => {
            if (fallbackBlob) {
              resolve(fallbackBlob);
            } else {
              reject(new Error('Canvas toBlob failed for both webp and jpeg'));
            }
          },
          'image/jpeg',
          quality
        );
      },
      'image/webp',
      quality
    );
  });
}
