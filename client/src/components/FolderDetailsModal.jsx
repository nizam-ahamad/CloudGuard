import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { X, Folder, Calendar, HardDrive, Layers, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../config';

/**
 * Format bytes to readable string (B, KB, MB, GB, TB)
 */
export const formatBytes = (bytes) => {
  if (bytes === '--' || bytes === undefined || bytes === null) return '0 B';
  const num = Number(bytes);
  if (isNaN(num) || num <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(num) / Math.log(k)), sizes.length - 1);
  if (i === 0) return `${num} B`;
  return `${(num / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

/**
 * Recursive helper to collect all descendant folder IDs locally
 */
const getSubfolderIds = (parentFolderId, folderList) => {
  if (!parentFolderId || !Array.isArray(folderList)) return [];
  const ids = [];
  const visited = new Set();
  const rootStr = parentFolderId.toString();
  visited.add(rootStr);
  const queue = [rootStr];

  while (queue.length > 0) {
    const curParent = queue.shift();
    const children = folderList.filter(
      f => f && (f.parentId || f.parentFolderId) && (f.parentId || f.parentFolderId).toString() === curParent
    );
    for (const child of children) {
      const childId = (child._id || child.id)?.toString();
      if (childId && !visited.has(childId)) {
        visited.add(childId);
        ids.push(childId);
        queue.push(childId);
      }
    }
  }
  return ids;
};

/**
 * Folder Details Modal with strictly scoped file count and recursive size
 */
export default function FolderDetailsModal({
  isOpen,
  onClose,
  folder,
  folders = [],
  files = [],
  token
}) {
  const [apiStats, setApiStats] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // 1. Resolve folder ID cleanly
  const targetId = String(folder?._id || folder?.id || '');

  // Collect descendant folder IDs (if recursive)
  const descendantFolderIds = useMemo(() => {
    return getSubfolderIds(targetId, folders);
  }, [targetId, folders]);

  // 2. Filter files strictly belonging to this folder (and subfolders if recursive)
  // Exclude any trash or soft-deleted records, and never fallback to global files.length
  const scopedLocalFiles = useMemo(() => {
    if (!targetId) return [];
    return (files || []).filter(f => {
      if (!f || f.isFolder) return false;
      if (f.isTrash || f.isDeleted || f.status === 'trash') return false;
      const fId = String(f.folderId?._id || f.folderId || f.folder?._id || f.folder || '');
      return fId === targetId || (descendantFolderIds && descendantFolderIds.includes(fId));
    });
  }, [files, targetId, descendantFolderIds]);

  const statsData = apiStats || {};

  // Derive final count and bytes: use authoritative API stats if present, else strictly scoped local files
  const finalCount = statsData.totalFiles !== undefined 
    ? statsData.totalFiles 
    : (statsData.fileCount !== undefined ? statsData.fileCount : scopedLocalFiles.length);

  const finalBytes = statsData.totalBytes !== undefined 
    ? statsData.totalBytes 
    : (statsData.totalSizeBytes !== undefined ? statsData.totalSizeBytes : scopedLocalFiles.reduce((acc, f) => acc + (Number(f.size) || 0), 0));

  const subfolderCount = statsData.subfolderCount !== undefined 
    ? statsData.subfolderCount 
    : (statsData.totalSubfolders !== undefined ? statsData.totalSubfolders : descendantFolderIds.length);

  // Authoritatively fetch stats via API
  useEffect(() => {
    if (!isOpen || !targetId) {
      setApiStats(null);
      return;
    }

    let isMounted = true;
    const fetchStats = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const authToken = token || localStorage.getItem('token') || sessionStorage.getItem('token');
        const res = await axios.get(`${API_BASE_URL}/api/folders/${targetId}/details`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
        });

        if (isMounted) {
          const data = res.data?.data || res.data || {};
          if (data.totalFiles !== undefined || data.fileCount !== undefined || data.totalBytes !== undefined) {
            setApiStats(data);
          }
        }
      } catch (err) {
        console.error('Failed to fetch details, trying /stats fallback', err);
        if (isMounted) {
          try {
            const authToken = token || localStorage.getItem('token') || sessionStorage.getItem('token');
            const fallbackRes = await axios.get(`${API_BASE_URL}/api/folders/${targetId}/stats`, {
              headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
            });
            if (isMounted) {
              const data = fallbackRes.data?.data || fallbackRes.data || {};
              if (data.totalFiles !== undefined || data.fileCount !== undefined || data.totalBytes !== undefined) {
                setApiStats(data);
              }
            }
          } catch (fallbackErr) {
            console.error('Failed to fetch fallback stats', fallbackErr);
            // Local scoped calculation serves as fallback
          }
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchStats();
    return () => { isMounted = false; };
  }, [isOpen, targetId, token]);

  if (!isOpen || !folder) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div 
        className="bg-[#121212] border border-neutral-800 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-details-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <Folder size={18} className="text-amber-400 flex-shrink-0" />
            <h3 id="folder-details-title" className="font-semibold text-white text-base truncate">
              Folder Details
            </h3>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Details Content */}
        <div className="p-5 space-y-4 text-sm">
          {/* Folder Name */}
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-neutral-500 block mb-1">
              Name
            </span>
            <p className="text-white font-medium break-all flex items-center gap-2">
              <span>{folder.name}</span>
            </p>
          </div>

          {/* Created At */}
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-neutral-500 block mb-1">
              Created At
            </span>
            <p className="text-neutral-300 flex items-center gap-2">
              <Calendar size={14} className="text-neutral-500" />
              <span>
                {new Date(folder.createdAt || Date.now()).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </span>
            </p>
          </div>

          {/* Stats Section: Contains & Size */}
          {isLoading && !apiStats && scopedLocalFiles.length === 0 ? (
            <div className="py-4 flex items-center justify-center gap-2.5 text-neutral-400 bg-neutral-900/40 rounded-xl border border-neutral-800/80">
              <Loader2 size={16} className="animate-spin text-white" />
              <span className="text-xs font-mono">Calculating stats...</span>
            </div>
          ) : error && !apiStats && scopedLocalFiles.length === 0 ? (
            <div className="py-3 px-3 text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-xl">
              {error}
            </div>
          ) : (
            <>
              {/* Contains */}
              <div>
                <span className="text-xs font-mono uppercase tracking-wider text-neutral-500 block mb-1">
                  Contains
                </span>
                <div className="text-neutral-200 font-medium flex items-center gap-2">
                  <Layers size={14} className="text-neutral-400 flex-shrink-0" />
                  <p>
                    {subfolderCount > 0 && finalCount > 0 ? (
                      `${finalCount} ${finalCount === 1 ? 'file' : 'files'}, ${subfolderCount} ${subfolderCount === 1 ? 'folder' : 'folders'}`
                    ) : subfolderCount > 0 ? (
                      `${subfolderCount} ${subfolderCount === 1 ? 'folder' : 'folders'}`
                    ) : finalCount > 0 ? (
                      `${finalCount} ${finalCount === 1 ? 'file' : 'files'}`
                    ) : (
                      'Empty folder'
                    )}
                  </p>
                </div>
              </div>

              {/* Size */}
              <div>
                <span className="text-xs font-mono uppercase tracking-wider text-neutral-500 block mb-1">
                  Size
                </span>
                <div className="text-neutral-200 font-medium flex items-center gap-2">
                  <HardDrive size={14} className="text-neutral-400 flex-shrink-0" />
                  <p>{formatBytes(finalBytes)}</p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3.5 bg-neutral-900/80 border-t border-neutral-800">
          <button 
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold bg-white text-black hover:bg-neutral-200 rounded transition-colors duration-200 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
