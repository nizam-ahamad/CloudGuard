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
 * Helper to ensure we have a valid download URL for a file.
 * If file.s3Url or file.url is present (e.g. PhotosView), uses that.
 * If not (e.g. My Files), fetches the secure presigned download URL.
 */
async function getFileUrl(file) {
  if (typeof file === 'string') {
    file = { _id: file };
  }
  if (!file) return '';
  if (file.s3Url || file.url) return file.s3Url || file.url;

  if (file._id) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const res = await fetch(`${API_BASE_URL}/api/files/${file._id}/access?download=true`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.url) return data.url;
      }
    } catch (e) {
      console.warn('Failed to get access URL:', e);
    }
    try {
      const res2 = await fetch(`${API_BASE_URL}/api/files/${file._id}/download`, { headers });
      if (res2.ok) {
        const data2 = await res2.json();
        if (data2.downloadUrl) return data2.downloadUrl;
      }
    } catch (e) {
      console.warn('Failed to get download URL:', e);
    }
  }
  return file.s3Url || file.url || '';
}

/**
 * Downloads a single file with live byte & percentage progress.
 * Uses XHR responseType='blob' to stream directly to disk without bloating JS heap.
 */
export async function downloadSingleFileWithProgress(file, onProgress) {
  const fileUrl = (await getFileUrl(file)) || file.s3Url || file.url;
  const fileName = file.name || 'download';
  const targetUrl = resolveFetchUrl(fileUrl);
  const expectedSize = file.size || 0;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', targetUrl, true);
    xhr.responseType = 'blob';

    xhr.onprogress = (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : expectedSize;
      const loaded = event.loaded;
      const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;

      if (onProgress) {
        onProgress({
          loaded,
          total,
          percent,
          text: total > 0 
            ? `${formatDownloadBytes(loaded)} / ${formatDownloadBytes(total)} (${percent}%)`
            : `${formatDownloadBytes(loaded)} downloaded`,
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const blob = xhr.response;
        saveAs(blob, fileName);
        resolve();
      } else {
        reject(new Error(`Download failed: HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during download'));
    xhr.ontimeout = () => reject(new Error('Download timed out'));

    xhr.send();
  });
}

/**
 * Bundles multiple files into a ZIP with aggregate progress tracking.
 */
export async function downloadBatchZipWithProgress(selectedFiles, onProgress) {
  const zip = new JSZip();
  const totalFiles = selectedFiles.length;
  let totalBatchBytes = selectedFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  let aggregateLoadedBytes = 0;

  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    const fileUrl = (await getFileUrl(file)) || file.s3Url || file.url;
    const fileName = file.name || `file_${i + 1}`;
    const targetUrl = resolveFetchUrl(fileUrl);

    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', targetUrl, true);
      xhr.responseType = 'blob';

      let lastLoadedForFile = 0;

      xhr.onprogress = (event) => {
        const diff = event.loaded - lastLoadedForFile;
        lastLoadedForFile = event.loaded;
        aggregateLoadedBytes += diff;

        const percent = totalBatchBytes > 0 
          ? Math.min(95, Math.round((aggregateLoadedBytes / totalBatchBytes) * 100)) 
          : Math.round(((i) / totalFiles) * 100);

        if (onProgress) {
          onProgress({
            percent,
            text: totalBatchBytes > 0
              ? `${formatDownloadBytes(aggregateLoadedBytes)} / ${formatDownloadBytes(totalBatchBytes)} (${percent}%)`
              : `Downloading ${i + 1}/${totalFiles} (${percent}%)`,
          });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          zip.file(fileName, xhr.response);
          resolve();
        } else {
          console.warn(`Skipping ${fileName}: HTTP ${xhr.status}`);
          resolve(); // Continue with remaining files
        }
      };

      xhr.onerror = () => {
        console.warn(`Network error on ${fileName}`);
        resolve();
      };

      xhr.send();
    });
  }

  if (onProgress) {
    onProgress({ percent: 98, text: 'Compressing ZIP...' });
  }

  const zipBlob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 2 } },
    (meta) => {
      if (onProgress) {
        onProgress({ percent: Math.round(meta.percent), text: `Zipping ${Math.round(meta.percent)}%` });
      }
    }
  );

  saveAs(zipBlob, `CloudGuard_Batch_${Date.now()}.zip`);
}

// Backwards compatibility aliases
export const downloadSingleFile = downloadSingleFileWithProgress;
export const downloadBatchZip = downloadBatchZipWithProgress;
