/**
 * CloudGuard - Client-Side WebAssembly HEIC / HEIF Decoder Manager
 *
 * Dispatches HEIC/HEIF decoding to a dedicated background Web Worker
 * running libheif-js (WebAssembly libheif v1.17+) off the main UI thread.
 *
 * Features:
 * - Off-thread decoding: Eliminates UI click lag and scrolling stutter.
 * - Single-worker priority queue: Visible photo ('high') jumps ahead of
 *   background preloads ('low') so preloading never starves the active slide.
 * - Bulletproof settle() guard: Exactly one resolution/rejection path per task,
 *   guaranteeing timers, listeners, and worker state are always cleared.
 * - Active-Job Abort Terminate & Respawn: If the user changes slides during
 *   synchronous WASM decoding, immediately kills the hung worker and starts
 *   the new slide in 0ms on a freshly spawned worker.
 * - Crash & OOM Recovery: Handles worker.onerror and worker.onmessageerror by
 *   respawning the worker and pumping the queue so subsequent photos never freeze.
 * - 15-second hard watchdog: Starts on enqueue to cap total wait and execution time.
 * - Max dimension capping: 2048px max edge prevents mobile memory exhaustion.
 */

let worker = null;
let currentTaskId = 0;
let activeTask = null;
const queue = [];
const HARD_TIMEOUT_MS = 15000; // 15s hard cap from enqueue to completion

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../workers/heicWorker.js', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = handleWorkerError;
    worker.onmessageerror = handleWorkerError;
  }
  return worker;
}

function terminateWorker() {
  if (worker) {
    try {
      worker.terminate();
    } catch (e) {
      // ignore
    }
    worker = null;
  }
}

function respawnWorker() {
  terminateWorker();
  return getWorker();
}

async function handleWorkerMessage(e) {
  const { id, success, blob, raw, error } = e.data || {};
  if (!activeTask || activeTask.id !== id) {
    return;
  }

  const task = activeTask;

  if (task.signal?.aborted) {
    task.settle(() => task.reject(new DOMException('Aborted', 'AbortError')));
    return;
  }

  if (!success || error) {
    task.settle(() => task.reject(new Error(error || 'HEIC decode failed in worker')));
    return;
  }

  if (blob) {
    task.settle(() => task.resolve(blob));
    return;
  }

  if (raw) {
    try {
      const convertedBlob = await rawToBlob(raw, task.quality);
      task.settle(() => task.resolve(convertedBlob));
    } catch (err) {
      task.settle(() => task.reject(err));
    }
    return;
  }

  task.settle(() => task.reject(new Error('Unknown response from HEIC worker')));
}

function handleWorkerError(err) {
  console.error('[heicDecoder] Worker crash or error:', err);
  const task = activeTask;
  // Respawn a fresh worker immediately so subsequent decodes work
  respawnWorker();
  if (task) {
    task.settle(() => task.reject(new Error(err?.message || 'HEIC worker crashed or encountered an error')));
  } else {
    processQueue();
  }
}

function processQueue() {
  // Enforce single-worker concurrency so CPU is never overloaded
  if (activeTask) {
    return;
  }

  if (queue.length === 0) {
    return;
  }

  // Find next non-settled, non-aborted task
  while (queue.length > 0) {
    const nextTask = queue.shift();
    if (nextTask.isSettled()) {
      continue;
    }
    if (nextTask.signal?.aborted) {
      nextTask.settle(() => nextTask.reject(new DOMException('Aborted', 'AbortError')));
      continue;
    }
    activeTask = nextTask;
    break;
  }

  if (!activeTask) return;

  const w = getWorker();

  // Dispatch message with transferable ArrayBuffer
  try {
    w.postMessage(
      {
        id: activeTask.id,
        buffer: activeTask.buffer,
        maxDimension: activeTask.maxDimension,
        quality: activeTask.quality,
      },
      [activeTask.buffer]
    );
  } catch (err) {
    // If transfer fails (e.g. detached), fallback to regular postMessage
    try {
      w.postMessage({
        id: activeTask.id,
        buffer: activeTask.buffer,
        maxDimension: activeTask.maxDimension,
        quality: activeTask.quality,
      });
    } catch (postErr) {
      const failedTask = activeTask;
      respawnWorker();
      failedTask.settle(() => failedTask.reject(postErr));
    }
  }
}

/**
 * Fallback to DOM canvas when OffscreenCanvas is unavailable in worker.
 */
async function rawToBlob(raw, quality) {
  const { data, width, height, targetWidth, targetHeight } = raw;
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) throw new Error('Could not get 2D canvas context for HEIC raw data');

  const imgData = srcCtx.createImageData(width, height);
  imgData.data.set(new Uint8ClampedArray(data));
  srcCtx.putImageData(imgData, 0, 0);

  let outputCanvas = srcCanvas;
  if (targetWidth !== width || targetHeight !== height) {
    outputCanvas = document.createElement('canvas');
    outputCanvas.width = targetWidth;
    outputCanvas.height = targetHeight;
    const outCtx = outputCanvas.getContext('2d');
    if (!outCtx) throw new Error('Could not get 2D context for scaling canvas');
    outCtx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight);
  }

  return new Promise((resolve, reject) => {
    outputCanvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          outputCanvas.toBlob(
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
        }
      },
      'image/webp',
      quality
    );
  });
}

/**
 * Decodes a HEIC/HEIF Blob, File, ArrayBuffer, or Uint8Array to a WebP (or fallback JPEG) Blob
 * capped at maxDimension (default 2048px).
 *
 * @param {Blob|File|ArrayBuffer|Uint8Array} inputBlobOrBuffer - Input HEIC data
 * @param {number|Object} quality - Output quality (0.0 to 1.0, default 0.85) or options object
 * @param {Object} [options] - Options: { priority: 'high'|'low', signal: AbortSignal, maxDimension: number }
 * @returns {Promise<Blob>} Decoded WebP/JPEG Blob
 */
export async function decodeHeicToBlob(inputBlobOrBuffer, quality = 0.85, options = {}) {
  if (!inputBlobOrBuffer) {
    throw new Error('No input provided to decodeHeicToBlob');
  }

  let q = 0.85;
  let opts = {};
  if (typeof quality === 'object' && quality !== null) {
    opts = quality;
    q = opts.quality ?? 0.85;
  } else {
    q = typeof quality === 'number' ? quality : 0.85;
    opts = options || {};
  }

  const priority = opts.priority || 'high';
  const signal = opts.signal || null;
  const maxDimension = opts.maxDimension !== undefined ? opts.maxDimension : 2048;

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  // Convert input into an independent ArrayBuffer to avoid mutating caller state
  let buffer;
  if (typeof inputBlobOrBuffer.arrayBuffer === 'function') {
    buffer = await inputBlobOrBuffer.arrayBuffer();
  } else if (inputBlobOrBuffer instanceof ArrayBuffer) {
    buffer = inputBlobOrBuffer.slice(0);
  } else if (ArrayBuffer.isView(inputBlobOrBuffer)) {
    buffer = inputBlobOrBuffer.buffer.slice(
      inputBlobOrBuffer.byteOffset,
      inputBlobOrBuffer.byteOffset + inputBlobOrBuffer.byteLength
    );
  } else {
    throw new Error('Unsupported input type for HEIC decoding');
  }

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  return new Promise((resolve, reject) => {
    const taskId = ++currentTaskId;
    let settled = false;
    let timeoutId = null;
    let onAbortListener = null;

    const task = {
      id: taskId,
      buffer,
      maxDimension,
      quality: q,
      priority,
      signal,
      resolve,
      reject,
      isSettled: () => settled,
      settle: (action) => {
        if (settled) return;
        settled = true;

        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (signal && onAbortListener) {
          signal.removeEventListener('abort', onAbortListener);
          onAbortListener = null;
        }

        // If this was the active task, clear active pointer
        if (activeTask && activeTask.id === taskId) {
          activeTask = null;
        } else {
          // If still in waiting queue, remove it
          const idx = queue.findIndex((t) => t.id === taskId);
          if (idx !== -1) {
            queue.splice(idx, 1);
          }
        }

        // Perform resolution / rejection
        try {
          if (typeof action === 'function') {
            action();
          }
        } finally {
          // Always pump queue so next task starts immediately
          processQueue();
        }
      },
    };

    // Hard 15s watchdog starts on enqueue to cap total wait + decode duration
    timeoutId = setTimeout(() => {
      if (settled) return;
      console.warn(`[heicDecoder] Decode task ${taskId} timed out after 15s`);
      const isCurrentlyActive = Boolean(activeTask && activeTask.id === taskId);
      if (isCurrentlyActive) {
        respawnWorker(); // Terminate hung WASM worker immediately
      }
      task.settle(() => reject(new Error('HEIC decoding timed out after 15s')));
    }, HARD_TIMEOUT_MS);

    // AbortSignal handling:
    // If active task's signal aborts (slide switched), terminate & respawn immediately!
    if (signal) {
      onAbortListener = () => {
        if (settled) return;
        const isCurrentlyActive = Boolean(activeTask && activeTask.id === taskId);
        if (isCurrentlyActive) {
          respawnWorker(); // Synchronous WASM decode is running; terminate immediately
        }
        task.settle(() => reject(new DOMException('Aborted', 'AbortError')));
      };
      signal.addEventListener('abort', onAbortListener, { once: true });
    }

    // Priority insertion:
    // 'high' priority tasks jump ahead of 'low' priority neighbor preloads
    if (priority === 'high') {
      const firstLowIdx = queue.findIndex((t) => t.priority === 'low');
      if (firstLowIdx !== -1) {
        queue.splice(firstLowIdx, 0, task);
      } else {
        queue.push(task);
      }
    } else {
      queue.push(task);
    }

    processQueue();
  });
}
