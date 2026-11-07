import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { API_BASE_URL } from '../config';

// Smart browser memory limit: archives <= 300 MB zip cleanly in-memory.
// Larger batches automatically fallback to sequential native downloads to protect device RAM.
const BROWSER_ZIP_LIMIT = 300 * 1024 * 1024; // 300 MB in bytes

export function formatDownloadBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function resolveFetchUrl(rawUrl) {
  if (!rawUrl) return '';
  const isPresigned =
    rawUrl.includes('X-Amz-Signature') ||
    rawUrl.includes('X-Amz-Algorithm') ||
    rawUrl.includes('AWSAccessKeyId');

  if (isPresigned) return rawUrl;
  return rawUrl.includes('?') ? `${rawUrl}&dl=1` : `${rawUrl}?dl=1`;
}

/**
 * Gets a fresh, valid presigned S3 URL from backend with attachment headers
 */
export async function getFreshDownloadUrl(file) {
  if (typeof file === 'string') {
    file = { _id: file };
  }
  if (!file) return '';

  if (file._id) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const res = await fetch(`${API_BASE_URL}/api/files/${file._id}/download-url`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.downloadUrl) return data.downloadUrl;
      }
    } catch (err) {
      console.warn(`Could not fetch fresh download URL for ${file.name || file._id}:`, err);
    }

    try {
      const res2 = await fetch(`${API_BASE_URL}/api/files/${file._id}/download`, { headers });
      if (res2.ok) {
        const data2 = await res2.json();
        if (data2.downloadUrl) return data2.downloadUrl;
      }
    } catch (e) {}

    try {
      const res3 = await fetch(`${API_BASE_URL}/api/files/${file._id}/access?download=true`, { headers });
      if (res3.ok) {
        const data3 = await res3.json();
        if (data3.url) return data3.url;
      }
    } catch (e) {}
  }

  return file.s3Url || file.url || '';
}

// Backwards compatibility aliases
export const getFreshUrl = getFreshDownloadUrl;
export const getFileUrl = getFreshDownloadUrl;

/**
 * Native direct trigger: streams directly to disk via browser download manager.
 * Consumes 0 MB of tab RAM and bypasses all 2GB browser ArrayBuffer limits.
 */
export function triggerDirectDownload(url, fileName) {
  const targetUrl = resolveFetchUrl(url);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = targetUrl;
  a.download = fileName || 'download';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) {
      document.body.removeChild(a);
    }
  }, 2000);
}

/**
 * Single File Download with threshold protection
 */
export async function downloadSingleFileWithProgress(file, onProgress, registerAbort) {
  const rawUrl = await getFreshDownloadUrl(file);
  const targetUrl = resolveFetchUrl(rawUrl);
  if (!targetUrl) {
    throw new Error('Could not resolve file download URL');
  }
  const fileSize = file.size || 0;
  const fileName = file.name || 'download';

  // If file is >= 1 GB, bypass in-memory XHR buffering completely
  if (fileSize >= 1 * 1024 * 1024 * 1024) {
    if (onProgress) {
      onProgress({
        percent: 100,
        speed: '',
        text: `Streaming ${formatDownloadBytes(fileSize)} directly to disk...`,
      });
    }
    triggerDirectDownload(targetUrl, fileName);
    await new Promise((r) => setTimeout(r, 1200));
    return { mode: 'stream', count: 1 };
  }

  // Files < 1 GB can be streamed with live XHR tracking
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', targetUrl, true);
    xhr.responseType = 'blob';

    if (registerAbort) {
      registerAbort(() => {
        xhr.abort();
        reject(new Error('DOWNLOAD_CANCELLED'));
      });
    }

    let lastLoaded = 0;
    let lastTime = Date.now();
    let speedText = '';

    xhr.onprogress = (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : fileSize;
      const loaded = event.loaded;
      const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;

      const now = Date.now();
      const timeDiff = (now - lastTime) / 1000;
      if (timeDiff >= 0.5) {
        const bytesDiff = loaded - lastLoaded;
        speedText = `${formatDownloadBytes(bytesDiff / timeDiff)}/s`;
        lastLoaded = loaded;
        lastTime = now;
      }

      if (onProgress) {
        onProgress({
          loaded,
          total,
          percent,
          speed: speedText,
          text: total > 0 
            ? `${formatDownloadBytes(loaded)} / ${formatDownloadBytes(total)} (${percent}%)`
            : `${formatDownloadBytes(loaded)} downloaded`,
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        saveAs(xhr.response, fileName);
        resolve({ mode: 'blob', count: 1 });
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during download'));
    xhr.onabort = () => reject(new Error('DOWNLOAD_CANCELLED'));
    xhr.ontimeout = () => reject(new Error('Download timed out'));

    xhr.send();
  });
}

/**
 * Batch Download: Smart Hybrid Routing with Polished Sequential Handoff
 * @param {Array} selectedFiles - Array of file objects to download
 * @param {Function} onProgress - Callback for header tray progress { percent, speed, text }
 * @param {Function} registerAbort - Callback to register abort controller
 * @param {Function} onNotice - Optional callback to fire an informational toast notification
 */
export async function downloadBatchZipWithProgress(
  selectedFiles,
  onProgress,
  registerAbort,
  onNotice
) {
  // 1. Declare abort state and current XHR at the root of the function
  let isAborted = false;
  let currentXhr = null;

  if (typeof registerAbort === 'function') {
    registerAbort(() => {
      isAborted = true;
      if (currentXhr) {
        currentXhr.abort();
      }
    });
  }

  const totalBatchBytes = selectedFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  const hasOversizedFile = selectedFiles.some((f) => (f.size || 0) >= BROWSER_ZIP_LIMIT);

  // Fallback branch for batches >= 1.5 GB or files >= 1.5 GB
  if (totalBatchBytes >= BROWSER_ZIP_LIMIT || hasOversizedFile) {
    const formattedTotal = formatDownloadBytes(totalBatchBytes);

    // 1. Fire informative toast notification
    if (typeof onNotice === 'function') {
      onNotice(
        `Batch size (${formattedTotal}) exceeds 300 MB browser archive limit. Initiating direct sequential downloads...`
      );
    }

    // 2. Sequentially trigger native direct downloads with a 900ms stagger
    for (let i = 0; i < selectedFiles.length; i++) {
      if (isAborted) break;

      const file = selectedFiles[i];
      const progressPercent = Math.round(((i + 1) / selectedFiles.length) * 100);

      // 3. Keep top header tray updated with exact file index and name
      if (onProgress) {
        onProgress({
          percent: progressPercent,
          speed: '',
          text: `Triggering ${i + 1}/${selectedFiles.length}: ${file.name}`,
        });
      }

      const rawUrl = await getFreshDownloadUrl(file);
      const url = resolveFetchUrl(rawUrl);
      triggerDirectDownload(url, file.name);

      // Increased stagger: 900ms gives browser shelf ample time to register each stream
      if (i < selectedFiles.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    }

    if (onProgress) {
      onProgress({
        percent: 100,
        speed: '',
        text: 'All downloads dispatched to browser.',
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
    return { mode: 'stream', count: selectedFiles.length };
  }

  // Standard JSZip flow for batches under 1.5 GB
  const zip = new JSZip();
  let aggregateLoadedBytes = 0;

  let lastLoaded = 0;
  let lastTime = Date.now();
  let speedText = '';

  for (let i = 0; i < selectedFiles.length; i++) {
    if (isAborted) {
      throw new Error('DOWNLOAD_CANCELLED');
    }
    const file = selectedFiles[i];
    const rawUrl = await getFreshDownloadUrl(file);
    const targetUrl = resolveFetchUrl(rawUrl);
    const fileName = file.name || `file_${i + 1}`;

    await new Promise((resolve, reject) => {
      if (isAborted) {
        return reject(new Error('DOWNLOAD_CANCELLED'));
      }
      const xhr = new XMLHttpRequest();
      currentXhr = xhr;
      xhr.open('GET', targetUrl, true);
      xhr.responseType = 'blob';

      let lastLoadedForFile = 0;

      xhr.onprogress = (event) => {
        if (isAborted) return;
        const diff = event.loaded - lastLoadedForFile;
        lastLoadedForFile = event.loaded;
        aggregateLoadedBytes += diff;

        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;
        if (timeDiff >= 0.5) {
          const bytesDiff = aggregateLoadedBytes - lastLoaded;
          speedText = `${formatDownloadBytes(bytesDiff / timeDiff)}/s`;
          lastLoaded = aggregateLoadedBytes;
          lastTime = now;
        }

        const percent = totalBatchBytes > 0 
          ? Math.min(95, Math.round((aggregateLoadedBytes / totalBatchBytes) * 100)) 
          : Math.round((i / selectedFiles.length) * 100);

        if (onProgress) {
          onProgress({
            loaded: aggregateLoadedBytes,
            total: totalBatchBytes,
            percent,
            speed: speedText,
            text: totalBatchBytes > 0
              ? `${formatDownloadBytes(aggregateLoadedBytes)} / ${formatDownloadBytes(totalBatchBytes)} (${percent}%)`
              : `Downloading ${i + 1}/${selectedFiles.length} (${percent}%)`,
          });
        }
      };

      xhr.onload = () => {
        currentXhr = null;
        if (isAborted) return reject(new Error('DOWNLOAD_CANCELLED'));
        if (xhr.status >= 200 && xhr.status < 300) {
          zip.file(fileName, xhr.response);
          resolve();
        } else {
          console.warn(`Skipping ${fileName}: HTTP ${xhr.status}`);
          resolve();
        }
      };

      xhr.onerror = () => {
        currentXhr = null;
        if (isAborted) return reject(new Error('DOWNLOAD_CANCELLED'));
        console.warn(`Network error on ${fileName}`);
        resolve();
      };

      xhr.onabort = () => {
        currentXhr = null;
        reject(new Error('DOWNLOAD_CANCELLED'));
      };

      xhr.send();
    });
  }

  if (isAborted) {
    throw new Error('DOWNLOAD_CANCELLED');
  }

  if (onProgress) {
    onProgress({ percent: 98, speed: '', text: 'Compressing ZIP...' });
  }

  const zipBlob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } },
    (meta) => {
      if (isAborted) return;
      if (onProgress) {
        onProgress({ percent: Math.round(meta.percent), speed: '', text: `Zipping ${Math.round(meta.percent)}%` });
      }
    }
  );

  if (isAborted) {
    throw new Error('DOWNLOAD_CANCELLED');
  }

  saveAs(zipBlob, `CloudGuard_Batch_${Date.now()}.zip`);
  return { mode: 'zip', count: selectedFiles.length };
}

// Backwards compatibility aliases
export const downloadSingleFile = downloadSingleFileWithProgress;
export const downloadBatchZip = downloadBatchZipWithProgress;
