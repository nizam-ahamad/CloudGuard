import React from 'react';
import axios from 'axios';

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

    const presignRes = await axios.post(`${apiBaseUrl}/api/files/presigned-url`, {
      fileName: name,
      fileSize: size,
      mimeType: file.type || 'application/octet-stream',
      folderId: folderId || null
    });

    const presignedUrl = presignRes.data.presignedUrl || presignRes.data.signedUrl;
    currentFileId = presignRes.data.fileId;

    await s3Axios.put(presignedUrl, file, {
      headers: {
        'Content-Type': file.type || 'application/octet-stream'
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

    const finalizeRes = await axios.post(`${apiBaseUrl}/api/files/finalize-upload`, {
      fileId: currentFileId,
      sha256: item.fileHash || undefined
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
