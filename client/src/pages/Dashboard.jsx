import React from 'react';
import axios from 'axios';

/**
 * Native Web Crypto API SHA-256 calculation
 */
export async function computeSHA256(file) {
  try {
    if (!file) return null;
    // For files under 50MB, hash the full buffer
    if (file.size <= 50 * 1024 * 1024) {
      const buffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
    // For large files (>50MB), hash the initial 10MB slice for rapid fingerprinting
    const slice = file.slice(0, 10 * 1024 * 1024);
    const buffer = await slice.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (e) {
    console.warn('Could not compute client-side hash:', e);
    return null;
  }
}

/**
 * Clean Dark-Themed Skeleton Loader Component for Folder and File Navigation
 */
export const FolderNavigationSkeleton = () => (
  <div className="space-y-2 mt-4 animate-pulse">
    {/* Folder Skeletons */}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 bg-neutral-900/60 border border-neutral-800/60 rounded-lg" />
      ))}
    </div>

    {/* File Row Skeletons */}
    {[1, 2, 3, 4, 5].map((i) => (
      <div
        key={i}
        className="h-12 w-full bg-neutral-900/40 border border-neutral-800/40 rounded-lg flex items-center justify-between px-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 bg-neutral-800 rounded" />
          <div className="w-36 h-3 bg-neutral-800 rounded" />
        </div>
        <div className="w-16 h-3 bg-neutral-800 rounded" />
      </div>
    ))}
  </div>
);

/**
 * Direct S3 Presigned Upload & Finalize Pipeline Helper
 */
export const processQueueItem = async ({
  item,
  folderId,
  apiBaseUrl,
  abortSignal,
  onProgress,
  onStatusChange,
}) => {
  const { file, name, size } = item;
  let currentFileId = null;

  try {
    const s3Axios = axios.create();
    delete s3Axios.defaults.headers.common['Authorization'];

    // Ensure actual File reference is resolved whether item is a File or an Object wrapper
    const fileObj = item.file instanceof File ? item.file : (item instanceof File ? item : item.file || item);

    const payload = {
      fileName: fileObj.name || name,
      name: fileObj.name || name,
      fileSize: fileObj.size !== undefined ? fileObj.size : size,
      size: fileObj.size !== undefined ? fileObj.size : size,
      mimeType: fileObj.type || 'application/octet-stream',
      type: fileObj.type || 'application/octet-stream',
      folderId: folderId || null,
      folder: folderId || null,
    };

    const token = localStorage.getItem('token');
    const presignRes = await axios.post(`${apiBaseUrl}/api/files/presigned-url`, payload, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });

    const presignedUrl = presignRes.data.presignedUrl || presignRes.data.signedUrl;
    currentFileId = presignRes.data.fileId;

    await s3Axios.put(presignedUrl, fileObj, {
      headers: {
        'Content-Type': fileObj.type || 'application/octet-stream'
      },
      transformRequest: [(data, headers) => {
        if (headers) {
          delete headers.Authorization;
          delete headers.authorization;
        }
        return data;
      }],
      signal: abortSignal,
      onUploadProgress: onProgress
    });

    if (onStatusChange) onStatusChange('analyzing');

    const computedHash = item.fileHash || await computeSHA256(fileObj);

    const finalizeRes = await axios.post(`${apiBaseUrl}/api/files/finalize-upload`, {
      fileId: currentFileId,
      sha256: computedHash || undefined
    }, {
      signal: abortSignal
    });

    return finalizeRes.data;
  } catch (err) {
    if (axios.isCancel(err) && currentFileId) {
      try { await axios.delete(`${apiBaseUrl}/api/files/${currentFileId}`); } catch (e) {}
    }
    throw err;
  }
};

export default FolderNavigationSkeleton;
