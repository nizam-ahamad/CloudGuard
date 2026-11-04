import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { API_BASE_URL } from '../config';

// Helper to format bytes cleanly (e.g., 1.3 GB, 450 MB)
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
 * Requests a fresh 1-hour presigned URL from backend on demand.
 * If file._id is present, requests /api/files/:id/download-url to eliminate expired signatures (HTTP 403).
 */
export async function getFreshUrl(file) {
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
      console.warn(`Could not refresh URL for ${file.name || file._id}, using fallback url:`, err);
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

// Backwards compatibility alias
export const getFileUrl = getFreshUrl;

/**
 * Downloads a single file with live speed, byte progress, and cancel support.
 * Requests fresh on-demand presigned URL before downloading.
 */
export async function downloadSingleFileWithProgress(file, onProgress, registerAbort) {
  const freshUrl = await getFreshUrl(file);
  const targetUrl = resolveFetchUrl(freshUrl);
  if (!targetUrl) {
    throw new Error('Could not resolve file download URL');
  }
  const fileName = file.name || 'download';
  const expectedSize = file.size || 0;

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
      const total = event.lengthComputable && event.total > 0 ? event.total : expectedSize;
      const loaded = event.loaded;
      const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;

      const now = Date.now();
      const timeDiff = (now - lastTime) / 1000;
      if (timeDiff >= 0.5) {
        const bytesDiff = loaded - lastLoaded;
        const bytesPerSec = bytesDiff / timeDiff;
        speedText = `${formatDownloadBytes(bytesPerSec)}/s`;
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
        resolve();
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
 * Bundles multiple files into a ZIP with aggregate progress tracking and cancel support.
 * Requests fresh on-demand presigned URLs for each item.
 */
export async function downloadBatchZipWithProgress(selectedFiles, onProgress, registerAbort) {
  const zip = new JSZip();
  const totalFiles = selectedFiles.length;
  let totalBatchBytes = selectedFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  let aggregateLoadedBytes = 0;
  let cancelled = false;
  let currentXhr = null;

  if (registerAbort) {
    registerAbort(() => {
      cancelled = true;
      if (currentXhr) {
        currentXhr.abort();
      }
    });
  }

  let lastLoaded = 0;
  let lastTime = Date.now();
  let speedText = '';

  for (let i = 0; i < selectedFiles.length; i++) {
    if (cancelled) {
      throw new Error('DOWNLOAD_CANCELLED');
    }
    const file = selectedFiles[i];
    const freshUrl = await getFreshUrl(file);
    const targetUrl = resolveFetchUrl(freshUrl);
    const fileName = file.name || `file_${i + 1}`;

    await new Promise((resolve, reject) => {
      if (cancelled) {
        return reject(new Error('DOWNLOAD_CANCELLED'));
      }
      const xhr = new XMLHttpRequest();
      currentXhr = xhr;
      xhr.open('GET', targetUrl, true);
      xhr.responseType = 'blob';

      let lastLoadedForFile = 0;

      xhr.onprogress = (event) => {
        if (cancelled) return;
        const diff = event.loaded - lastLoadedForFile;
        lastLoadedForFile = event.loaded;
        aggregateLoadedBytes += diff;

        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;
        if (timeDiff >= 0.5) {
          const bytesDiff = aggregateLoadedBytes - lastLoaded;
          const bytesPerSec = bytesDiff / timeDiff;
          speedText = `${formatDownloadBytes(bytesPerSec)}/s`;
          lastLoaded = aggregateLoadedBytes;
          lastTime = now;
        }

        const percent = totalBatchBytes > 0 
          ? Math.min(95, Math.round((aggregateLoadedBytes / totalBatchBytes) * 100)) 
          : Math.round(((i) / totalFiles) * 100);

        if (onProgress) {
          onProgress({
            loaded: aggregateLoadedBytes,
            total: totalBatchBytes,
            percent,
            speed: speedText,
            text: totalBatchBytes > 0
              ? `${formatDownloadBytes(aggregateLoadedBytes)} / ${formatDownloadBytes(totalBatchBytes)} (${percent}%)`
              : `Downloading ${i + 1}/${totalFiles} (${percent}%)`,
          });
        }
      };

      xhr.onload = () => {
        currentXhr = null;
        if (cancelled) {
          return reject(new Error('DOWNLOAD_CANCELLED'));
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          zip.file(fileName, xhr.response);
          resolve();
        } else {
          console.warn(`Skipping ${fileName}: HTTP ${xhr.status}`);
          resolve(); // Continue with remaining files
        }
      };

      xhr.onerror = () => {
        currentXhr = null;
        if (cancelled) return reject(new Error('DOWNLOAD_CANCELLED'));
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

  if (cancelled) {
    throw new Error('DOWNLOAD_CANCELLED');
  }

  if (onProgress) {
    onProgress({ percent: 98, speed: '', text: 'Compressing ZIP...' });
  }

  const zipBlob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 2 } },
    (meta) => {
      if (cancelled) return;
      if (onProgress) {
        onProgress({ percent: Math.round(meta.percent), speed: '', text: `Zipping ${Math.round(meta.percent)}%` });
      }
    }
  );

  if (cancelled) {
    throw new Error('DOWNLOAD_CANCELLED');
  }

  saveAs(zipBlob, `CloudGuard_Batch_${Date.now()}.zip`);
}

// Backwards compatibility aliases
export const downloadSingleFile = downloadSingleFileWithProgress;
export const downloadBatchZip = downloadBatchZipWithProgress;
