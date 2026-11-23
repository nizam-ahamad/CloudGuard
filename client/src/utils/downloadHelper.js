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

  const fileId = file._id || file.id;
  if (fileId) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const res = await fetch(`${API_BASE_URL}/api/files/${fileId}/download-url`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.downloadUrl) return data.downloadUrl;
        if (data.url) return data.url;
      }
    } catch (err) {
      console.warn(`Could not fetch fresh download URL for ${file.name || fileId}:`, err);
    }

    try {
      const res2 = await fetch(`${API_BASE_URL}/api/files/${fileId}/download`, { headers });
      if (res2.ok) {
        const data2 = await res2.json();
        if (data2.downloadUrl) return data2.downloadUrl;
        if (data2.url) return data2.url;
      }
    } catch (e) {}

    try {
      const res3 = await fetch(`${API_BASE_URL}/api/files/${fileId}/access?download=true`, { headers });
      if (res3.ok) {
        const data3 = await res3.json();
        if (data3.url) return data3.url;
        if (data3.downloadUrl) return data3.downloadUrl;
      }
    } catch (e) {}
  }

  if (file.s3Url || file.url || file.downloadUrl) {
    return file.s3Url || file.url || file.downloadUrl;
  }

  throw new Error(`Unable to generate download link for "${file.name || 'file'}". Please try again.`);
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
 * Triggers direct browser download via presigned attachment URL.
 * Bypasses in-memory XHR/Blob buffers and storage CORS limitations.
 */
export async function downloadSingleFileWithProgress(file, onProgress, registerAbort) {
  const rawUrl = await getFreshDownloadUrl(file);
  const targetUrl = resolveFetchUrl(rawUrl);
  if (!targetUrl) {
    throw new Error('Could not resolve file download URL');
  }
  const fileSize = file.size || 0;
  const fileName = file.name || file.originalName || 'download';

  if (typeof registerAbort === 'function') {
    registerAbort(() => {});
  }

  if (onProgress) {
    onProgress({
      percent: 100,
      speed: '',
      text: fileSize > 0 
        ? `Streaming ${fileName} (${formatDownloadBytes(fileSize)}) directly to disk...`
        : `Streaming ${fileName} directly to disk...`,
    });
  }

  triggerDirectDownload(targetUrl, fileName);
  await new Promise((r) => setTimeout(r, 600));
  return { mode: 'stream', count: 1 };
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
      if (typeof targetUrl === 'string' && targetUrl.startsWith('https://files.cloudguard.site')) {
        xhr.withCredentials = true;
      }
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
        console.warn(`Network or CORS restriction on ${fileName}; queuing for direct download fallback.`);
        triggerDirectDownload(targetUrl, fileName);
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

  const zipFileCount = Object.keys(zip.files).length;
  if (zipFileCount > 0) {
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
    return { mode: 'zip', count: zipFileCount };
  } else {
    // If CORS or network restrictions prevented in-memory ZIP creation, fallback to sequential direct download
    if (typeof onNotice === 'function') {
      onNotice('Archive creation bypassed due to storage policy; downloading files directly...');
    }
    for (let i = 0; i < selectedFiles.length; i++) {
      if (isAborted) break;
      const file = selectedFiles[i];
      const rawUrl = await getFreshDownloadUrl(file);
      const url = resolveFetchUrl(rawUrl);
      triggerDirectDownload(url, file.name);
      if (i < selectedFiles.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    }
    return { mode: 'stream', count: selectedFiles.length };
  }
}

// Backwards compatibility aliases
export const downloadSingleFile = downloadSingleFileWithProgress;
export const downloadBatchZip = downloadBatchZipWithProgress;
