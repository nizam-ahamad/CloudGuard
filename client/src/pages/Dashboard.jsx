import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { formatBytes } from '../utils/formatters';
import { API_BASE_URL } from '../config';
import { computeFileSHA256, computeSHA256 } from '../utils/cryptoHelper';

export { computeFileSHA256, computeSHA256 };

let globalDashboardStorageCache = null;

/**
 * Direct-to-S3 Upload Pipeline with concurrent SHA-256 fingerprinting
 */
export const uploadFileDirectlyToS3 = async (file, targetFolderId, onProgress) => {
  const token = localStorage.getItem('token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  // Step 1: Request presigned upload ticket from backend (~5ms)
  const { data: ticket } = await axios.post(
    `${API_BASE_URL}/api/files/presigned-url`,
    {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      folderId: targetFolderId || null,
    },
    { headers }
  );

  if (!ticket || !ticket.presignedUrl) {
    throw new Error('Failed to acquire secure presigned upload ticket.');
  }

  const s3Axios = axios.create();
  delete s3Axios.defaults.headers.common['Authorization'];

  // Step 2: Concurrently compute SHA-256 while streaming file directly to S3
  const [sha256] = await Promise.all([
    computeFileSHA256(file),
    s3Axios.put(ticket.presignedUrl, file, {
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
      transformRequest: [(data, reqHeaders) => {
        if (reqHeaders) {
          delete reqHeaders.Authorization;
          delete reqHeaders.authorization;
        }
        return data;
      }],
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          if (typeof onProgress === 'function') onProgress(percent);
        }
      },
    }),
  ]);

  // Step 3: Finalize upload with backend (triggers MalwareBazaar check & PE Range scan)
  const { data: finalizeResult } = await axios.post(
    `${API_BASE_URL}/api/files/finalize-upload`,
    {
      fileId: ticket.fileId,
      s3Key: ticket.s3Key,
      sha256,
    },
    { headers }
  );

  // Step 4: Handle scan verdict
  if (finalizeResult.isMalicious) {
    return { success: false, isMalicious: true, message: finalizeResult.message };
  }

  return { success: true, isMalicious: false, file: finalizeResult.file };
};

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

// Storage Meter Widget Component
export const StorageMeter = ({ storageStats: propStats, fetchStorageStats }) => {
  const [storageStats, setStorageStats] = useState(() => propStats || globalDashboardStorageCache || null);

  useEffect(() => {
    if (propStats) {
      globalDashboardStorageCache = propStats;
      setStorageStats(propStats);
    }
  }, [propStats]);

  useEffect(() => {
    if (typeof fetchStorageStats === 'function') {
      fetchStorageStats();
    }
  }, [fetchStorageStats]);

  const percentage = storageStats?.percentage !== undefined
    ? storageStats.percentage
    : (storageStats?.usedPercentage !== undefined
      ? storageStats.usedPercentage
      : (storageStats
        ? Math.min(100, Math.round(((storageStats.storageUsed || storageStats.usedBytes || storageStats.used || 0) / (storageStats.storageLimit || storageStats.totalLimitBytes || storageStats.limit || 5368709120)) * 100))
        : '...'));

  return (
    <div className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
      <div className="relative w-12 h-12 flex items-center justify-center">
        {/* Percentage meter ring */}
        <span className="text-xs font-semibold text-zinc-200">
          {storageStats ? `${percentage}%` : '...'}
        </span>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          Storage Used
        </p>
        <p className="text-sm font-semibold text-zinc-100">
          {storageStats
            ? `${formatBytes(storageStats.storageUsed || storageStats.used || storageStats.usedBytes || 0)} / ${formatBytes(storageStats.storageLimit || storageStats.limit || storageStats.totalLimitBytes || 5368709120)}`
            : 'Loading...'}
        </p>
      </div>
    </div>
  );
};

export const Dashboard = (props) => {
  const [storageStats, setStorageStats] = useState(() => props.storageStats || globalDashboardStorageCache || null);

  useEffect(() => {
    // If storageStats is passed via props and updates in App.jsx, synchronize local state
    if (props.storageStats) {
      globalDashboardStorageCache = props.storageStats;
      setStorageStats(props.storageStats);
    }
  }, [props.storageStats]);

  useEffect(() => {
    // Fallback mount trigger if Dashboard fetches independently
    if (typeof props.fetchStorageStats === 'function') {
      props.fetchStorageStats();
    }
  }, []);

  return (
    <div className="space-y-4">
      <StorageMeter storageStats={storageStats} fetchStorageStats={props.fetchStorageStats} />
      <FolderNavigationSkeleton />
    </div>
  );
};

export default Dashboard;
