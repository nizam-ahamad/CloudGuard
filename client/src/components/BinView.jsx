import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  Folder,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Archive,
  File,
  X,
  Loader2,
  Info,
  Clock,
  Check,
  CheckSquare,
  Square,
  Layers,
  ArrowUpRight
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { API_BASE_URL } from '../config';
import { FileCardPreviewBody } from './FileGridCard';

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!n || n <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  const safeI = Math.min(Math.max(0, i), sizes.length - 1);
  return `${(n / Math.pow(k, safeI)).toFixed(safeI === 0 ? 0 : 1)} ${sizes[safeI]}`;
}

function getFileIcon(mimeType = '', fileName = '') {
  const mime = (mimeType || '').toLowerCase();
  const ext = (fileName || '').split('.').pop().toLowerCase();

  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) {
    return ImageIcon;
  }
  if (mime.startsWith('video/') || ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'].includes(ext)) {
    return Film;
  }
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) {
    return Music;
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) || mime.includes('zip') || mime.includes('compressed')) {
    return Archive;
  }
  if (mime.startsWith('text/') || ['txt', 'md', 'doc', 'docx', 'csv', 'json', 'pdf'].includes(ext)) {
    return FileText;
  }
  return File;
}

export default function BinView({ onStorageUpdate, searchQuery = '', token: propToken }) {
  const token = propToken || (typeof window !== 'undefined' ? (localStorage.getItem('token') || sessionStorage.getItem('token')) : null);
  const appToast = useToast();
  const toast = useMemo(() => ({
    success: (msg, opts) => (appToast?.success ? appToast.success(msg, opts) : console.log('[Toast Success]', msg)),
    error: (msg, opts) => (appToast?.error ? appToast.error(msg, opts) : console.error('[Toast Error]', msg)),
    info: (msg, opts) => (appToast?.info ? appToast.info(msg, opts) : console.info('[Toast Info]', msg)),
    warning: (msg, opts) => (appToast?.warning ? appToast.warning(msg, opts) : console.warn('[Toast Warning]', msg)),
  }), [appToast]);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ folders: [], files: [], totalCount: 0, totalBytes: 0 });
  const [selectedFolderIds, setSelectedFolderIds] = useState([]);
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);

  // Modal State: null | { type: 'empty' | 'delete_selected' | 'delete_single' | 'restore_all', target?: object }
  const [modal, setModal] = useState(null);

  const fetchBin = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const res = await axios.get(`${API_BASE_URL}/api/files/bin`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data?.success) {
        setData({
          folders: res.data.folders || [],
          files: res.data.files || [],
          totalCount: res.data.totalCount || 0,
          totalBytes: res.data.totalBytes || 0
        });
      }
    } catch (err) {
      console.error('Failed to load Bin items:', err);
      toast.error('Could not load Bin');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBin();

    const handleUpdate = () => {
      fetchBin();
    };
    window.addEventListener('cloudguard:files-updated', handleUpdate);
    return () => window.removeEventListener('cloudguard:files-updated', handleUpdate);
  }, [fetchBin]);

  // Filter items by search query if user typed into global top search
  const filteredFolders = useMemo(() => {
    if (!searchQuery?.trim()) return data.folders;
    const q = searchQuery.toLowerCase().trim();
    return data.folders.filter((f) => (f.name || '').toLowerCase().includes(q));
  }, [data.folders, searchQuery]);

  const filteredFiles = useMemo(() => {
    if (!searchQuery?.trim()) return data.files;
    const q = searchQuery.toLowerCase().trim();
    return data.files.filter((f) => (f.name || f.originalName || '').toLowerCase().includes(q));
  }, [data.files, searchQuery]);

  const totalFilteredCount = filteredFolders.length + filteredFiles.length;
  const totalSelected = selectedFolderIds.length + selectedFileIds.length;
  const isAllSelected = totalFilteredCount > 0 && totalSelected === totalFilteredCount;

  // Toggle selection
  const handleToggleSelectFolder = (id) => {
    setSelectedFolderIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleToggleSelectFile = (id) => {
    setSelectedFileIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedFolderIds([]);
      setSelectedFileIds([]);
    } else {
      setSelectedFolderIds(filteredFolders.map((f) => f._id));
      setSelectedFileIds(filteredFiles.map((f) => f._id));
    }
  };

  const handleClearSelection = () => {
    setSelectedFolderIds([]);
    setSelectedFileIds([]);
  };

  const triggerStatsUpdate = () => {
    if (typeof onStorageUpdate === 'function') onStorageUpdate();
    window.dispatchEvent(new CustomEvent('cloudguard:storage-updated'));
    window.dispatchEvent(new Event('cloudguard:storage-updated'));
    window.dispatchEvent(new CustomEvent('cloudguard:files-updated'));
    window.dispatchEvent(new Event('cloudguard:files-updated'));
  };

  // -------------------------------------------------------------
  // RESTORE ACTIONS
  // -------------------------------------------------------------
  const handleRestoreSingle = async (item, isFolder) => {
    try {
      setActionLoading(true);
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const payload = isFolder ? { folderIds: [item._id] } : { fileIds: [item._id] };

      const res = await axios.post(`${API_BASE_URL}/api/files/bin/restore`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data?.success) {
        toast.success(`Restored "${item.name}"`);
        setSelectedFolderIds((prev) => prev.filter((i) => i !== item._id));
        setSelectedFileIds((prev) => prev.filter((i) => i !== item._id));
        fetchBin();
        triggerStatsUpdate();
      }
    } catch (err) {
      console.error('Restore error:', err);
      toast.error(err.response?.data?.error || 'Failed to restore item');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestoreSelected = async () => {
    if (totalSelected === 0) return;
    try {
      setActionLoading(true);
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const res = await axios.post(
        `${API_BASE_URL}/api/files/bin/restore`,
        { fileIds: selectedFileIds, folderIds: selectedFolderIds },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.data?.success) {
        toast.success(`Restored ${totalSelected} item${totalSelected === 1 ? '' : 's'}`);
        handleClearSelection();
        fetchBin();
        triggerStatsUpdate();
      }
    } catch (err) {
      console.error('Batch restore error:', err);
      toast.error(err.response?.data?.error || 'Failed to restore selected items');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmRestoreAll = async () => {
    try {
      setActionLoading(true);
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const res = await axios.post(
        `${API_BASE_URL}/api/files/bin/restore`,
        { restoreAll: true },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.data?.success) {
        toast.success('All items restored from Bin');
        setModal(null);
        handleClearSelection();
        fetchBin();
        triggerStatsUpdate();
      }
    } catch (err) {
      console.error('Restore all error:', err);
      toast.error(err.response?.data?.error || 'Failed to restore all items');
    } finally {
      setActionLoading(false);
    }
  };

  // -------------------------------------------------------------
  // PERMANENT DELETE ACTIONS
  // -------------------------------------------------------------
  const handleConfirmPermanentDelete = async () => {
    if (!modal) return;
    try {
      setActionLoading(true);
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      let payload = {};

      if (modal.type === 'empty') {
        payload = { emptyAll: true };
      } else if (modal.type === 'delete_single' && modal.target) {
        payload = modal.target.isFolder
          ? { folderIds: [modal.target._id] }
          : { fileIds: [modal.target._id] };
      } else if (modal.type === 'delete_selected') {
        payload = { fileIds: selectedFileIds, folderIds: selectedFolderIds };
      }

      const res = await axios.delete(`${API_BASE_URL}/api/files/bin/permanent`, {
        headers: { Authorization: `Bearer ${token}` },
        data: payload
      });

      if (res.data?.success) {
        const rawFreed = Number(res.data?.freedBytes) >= 0 ? Number(res.data.freedBytes) : (modalFreedBytes || 0);
        const formattedSize = formatBytes(rawFreed);
        let toastMessage = '';

        if (modal.type === 'empty') {
          toastMessage = `Bin emptied • Freed ${formattedSize}`;
        } else if (modal.type === 'delete_single' && modal.target) {
          const itemName = modal.target.name || modal.target.originalName || 'item';
          toastMessage = `Permanently deleted "${itemName}" • Freed ${formattedSize}`;
        } else if (modal.type === 'delete_selected') {
          const count = (selectedFolderIds.length + selectedFileIds.length) || (res.data?.deletedCount || 0);
          toastMessage = `Permanently deleted ${count} items • Freed ${formattedSize}`;
        } else {
          toastMessage = `Permanently deleted • Freed ${formattedSize}`;
        }

        toast.success(toastMessage);
        setModal(null);
        handleClearSelection();
        fetchBin();
        triggerStatsUpdate();
      }
    } catch (err) {
      console.error('Permanent delete error:', err);
      toast.error(err.response?.data?.error || 'Failed to permanently delete items');
    } finally {
      setActionLoading(false);
    }
  };

  // Calculate size to be freed for active modal
  const modalFreedBytes = useMemo(() => {
    if (!modal) return 0;
    if (modal.type === 'empty') return data.totalBytes;
    if (modal.type === 'delete_single' && modal.target) {
      return modal.target.size || 0;
    }
    if (modal.type === 'delete_selected') {
      let sum = 0;
      for (const f of data.files) {
        if (selectedFileIds.includes(f._id)) sum += (f.size || 0);
      }
      for (const fol of data.folders) {
        if (selectedFolderIds.includes(fol._id)) sum += (fol.size || 0);
      }
      return sum;
    }
    return 0;
  }, [modal, data, selectedFileIds, selectedFolderIds]);

  return (
    <div className="w-full flex-1 flex flex-col p-4 sm:p-6 lg:p-8 pb-24 animate-in fade-in duration-200">
      {/* 1. Header Banner Explaining 30-Day Policy */}
      <div className="flex items-start sm:items-center gap-3 p-3.5 sm:p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-200 text-xs sm:text-sm mb-6 shadow-sm">
        <Info className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 shrink-0 mt-0.5 sm:mt-0" />
        <div className="flex-1 min-w-0">
          <p className="leading-relaxed font-medium">
            Items in Bin still count toward your vault storage quota and are automatically deleted forever after 30 days.
          </p>
        </div>
      </div>

      {/* 2. Top Action Bar: Title, Count, and Contextual Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-neutral-200/80 dark:border-neutral-800/80 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/60 flex items-center justify-center text-neutral-700 dark:text-neutral-300 shrink-0">
            <Trash2 className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-neutral-900 dark:text-white tracking-tight flex items-center gap-2">
              Bin
            </h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">
              {data.totalCount} {data.totalCount === 1 ? 'item' : 'items'} • {formatBytes(data.totalBytes)} storage in use
            </p>
          </div>
        </div>

        {/* Action Controls in Header (visible when no items are selected) */}
        {totalSelected === 0 && data.totalCount > 0 ? (
          <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={handleToggleSelectAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-neutral-700 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 dark:text-zinc-300 dark:hover:text-white dark:bg-neutral-800 dark:hover:bg-neutral-700 border border-neutral-200 dark:border-neutral-700 transition-colors cursor-pointer whitespace-nowrap"
            >
              <CheckSquare className="w-3.5 h-3.5 text-emerald-500" />
              <span>Select All ({totalFilteredCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setModal({ type: 'restore_all' })}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5 text-blue-500" />
              <span>Restore All</span>
            </button>

            <button
              type="button"
              onClick={() => setModal({ type: 'empty' })}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10 border border-red-500/30 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Empty Bin</span>
            </button>
          </div>
        ) : null}
      </div>

      {/* 3. Main Content: Empty State or Items Grid */}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-neutral-400">
          <Loader2 className="w-7 h-7 animate-spin text-blue-500 mb-3" />
          <p className="text-sm">Loading Bin...</p>
        </div>
      ) : data.totalCount === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-center select-none">
          <div className="w-16 h-16 rounded-2xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center justify-center text-neutral-400 mb-4 shadow-inner">
            <Trash2 className="w-8 h-8 stroke-[1.5]" />
          </div>
          <h2 className="text-base sm:text-lg font-bold text-neutral-800 dark:text-neutral-200 mb-1">
            Bin is empty
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 max-w-sm leading-relaxed">
            Items deleted from your vault will stay here for 30 days before being permanently removed forever.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Folders Section */}
          {filteredFolders.length > 0 && (
            <div>
              <div className="text-neutral-500 dark:text-neutral-400 text-xs font-semibold uppercase tracking-wider mb-3">
                Folders ({filteredFolders.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredFolders.map((folder) => {
                  const isSelected = selectedFolderIds.includes(folder._id);
                  const daysRemaining = folder.daysRemaining ?? 30;
                  const daysAgo = folder.deletedDaysAgo ?? 0;

                  return (
                    <div
                      key={folder._id}
                      className={`group relative p-3.5 rounded-2xl border transition-all select-none flex flex-col justify-between ${
                        isSelected
                          ? 'bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500 dark:border-emerald-500 ring-2 ring-emerald-500/40 shadow-md'
                          : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800/80 hover:border-neutral-300 dark:hover:border-neutral-700 shadow-sm'
                      }`}
                    >
                      {/* Checkbox (Responsive: default visible on mobile, hover on desktop) */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleSelectFolder(folder._id);
                        }}
                        className={`absolute top-3 left-3 z-10 w-5 h-5 rounded-md border flex items-center justify-center transition-all cursor-pointer ${
                          isSelected
                            ? 'opacity-100 bg-emerald-500 border-emerald-500 text-white shadow-sm'
                            : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 border-neutral-400 dark:border-neutral-500 bg-neutral-100 dark:bg-neutral-900/80 hover:border-emerald-500 dark:hover:border-emerald-400 shadow-sm'
                        }`}
                        title={isSelected ? 'Deselect' : 'Select'}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </button>

                      <div className="flex items-start gap-3 min-w-0 pl-7">
                        <Folder className="w-7 h-7 text-amber-500 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-neutral-900 dark:text-white truncate" title={folder.name}>
                            {folder.name}
                          </p>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                            {folder.fileCount || 0} files • {formatBytes(folder.size || 0)}
                          </p>
                        </div>
                      </div>

                      {/* Deletion Countdown & Quick Actions */}
                      <div className="mt-3 pt-2.5 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold font-mono uppercase tracking-wider border ${
                              daysRemaining <= 3
                                ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
                                : daysRemaining <= 7
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                                : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700/60'
                            }`}
                            title={`Deleted ${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`}
                          >
                            <Clock className="w-2.5 h-2.5" />
                            {daysRemaining}d left
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleRestoreSingle(folder, true)}
                            disabled={actionLoading}
                            className="p-1.5 text-neutral-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                            title="Restore folder"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setModal({ type: 'delete_single', target: folder })}
                            disabled={actionLoading}
                            className="p-1.5 text-neutral-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                            title="Delete forever"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Files Section */}
          {filteredFiles.length > 0 && (
            <div>
              <div className="text-neutral-500 dark:text-neutral-400 text-xs font-semibold uppercase tracking-wider mb-3">
                Files ({filteredFiles.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredFiles.map((file) => {
                  const isSelected = selectedFileIds.includes(file._id);
                  const daysRemaining = file.daysRemaining ?? 30;
                  const daysAgo = file.deletedDaysAgo ?? 0;

                  return (
                    <div
                      key={file._id}
                      className={`group relative p-3 rounded-xl sm:rounded-2xl border transition-all select-none flex flex-col justify-between ${
                        isSelected
                          ? 'bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500 dark:border-emerald-500 ring-2 ring-emerald-500/40 shadow-md'
                          : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800/80 hover:border-neutral-300 dark:hover:border-neutral-700 shadow-sm'
                      }`}
                    >
                      {/* Checkbox (Responsive: default visible on mobile, hover on desktop) */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleSelectFile(file._id);
                        }}
                        className={`absolute top-2.5 left-2.5 z-10 w-5 h-5 rounded-md border flex items-center justify-center transition-all cursor-pointer ${
                          isSelected
                            ? 'opacity-100 bg-emerald-500 border-emerald-500 text-white shadow-sm'
                            : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 border-neutral-400 dark:border-neutral-500 bg-neutral-100 dark:bg-neutral-900/80 hover:border-emerald-500 dark:hover:border-emerald-400 shadow-sm'
                        }`}
                        title={isSelected ? 'Deselect' : 'Select'}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </button>

                      {/* File Card Preview Body (Lightweight B2 Thumbnail, PDF, Video, Text, or Document Sheet) */}
                      <FileCardPreviewBody file={file} token={token} />

                      {/* File Name & Size */}
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-semibold text-neutral-900 dark:text-white truncate" title={file.name || file.originalName}>
                          {file.name || file.originalName}
                        </p>
                        <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                          {formatBytes(file.size || 0)}
                        </p>
                      </div>

                      {/* Deletion Countdown & Quick Actions */}
                      <div className="mt-2.5 pt-2 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold font-mono uppercase tracking-wider border ${
                              daysRemaining <= 3
                                ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
                                : daysRemaining <= 7
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                                : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700/60'
                            }`}
                            title={`Deleted ${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`}
                          >
                            <Clock className="w-2.5 h-2.5" />
                            {daysRemaining}d left
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleRestoreSingle(file, false)}
                            disabled={actionLoading}
                            className="p-1.5 text-neutral-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                            title="Restore file"
                            aria-label="Restore file"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setModal({ type: 'delete_single', target: file })}
                            disabled={actionLoading}
                            className="p-1.5 text-neutral-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                            title="Delete forever"
                            aria-label="Delete forever"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 4. BOTTOM-CENTERED FLOATING SELECTION PILL BAR */}
      {/* ------------------------------------------------------------- */}
      {totalSelected > 0 && (
        <div className="fixed bottom-5 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 sm:gap-3 px-3 sm:px-5 py-2 sm:py-2.5 rounded-full bg-white/95 dark:bg-[#1e1f20]/95 text-neutral-900 dark:text-neutral-100 border border-neutral-200 dark:border-zinc-700/80 shadow-2xl backdrop-blur-md max-w-[96vw] text-xs sm:text-sm whitespace-nowrap select-none animate-in fade-in slide-in-from-bottom-2 duration-150">
          {/* 1. Count + Divider */}
          <span className="font-medium whitespace-nowrap pl-0.5 sm:pl-1">
            {totalSelected}<span className="hidden sm:inline"> selected</span>
          </span>
          <span className="h-4 w-px bg-neutral-300 dark:bg-zinc-700 shrink-0" />

          {/* 2. Select All / Deselect All */}
          <button
            type="button"
            onClick={handleToggleSelectAll}
            className="bg-transparent text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100 dark:text-zinc-300 dark:hover:text-white dark:hover:bg-zinc-800/60 font-medium px-2 sm:px-2.5 py-1 rounded-full transition-colors cursor-pointer whitespace-nowrap"
          >
            {isAllSelected ? (
              <>
                <span className="sm:hidden">Deselect</span>
                <span className="hidden sm:inline">Deselect All</span>
              </>
            ) : (
              <>
                <span className="sm:hidden">All</span>
                <span className="hidden sm:inline">Select All ({totalFilteredCount})</span>
              </>
            )}
          </button>

          {/* 3. Restore Selected */}
          <button
            type="button"
            onClick={handleRestoreSelected}
            disabled={actionLoading}
            className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-full font-medium text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100 dark:text-zinc-200 dark:hover:text-white dark:hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            title="Restore selected items"
          >
            <RotateCcw className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <span className="sm:hidden">Restore</span>
            <span className="hidden sm:inline">Restore Selected</span>
          </button>

          {/* 4. Delete Forever */}
          <button
            type="button"
            onClick={() => setModal({ type: 'delete_selected' })}
            disabled={actionLoading}
            className="rounded-full bg-red-600 hover:bg-red-500 text-white px-2.5 sm:px-3.5 py-1 sm:py-1.5 font-medium flex items-center gap-1.5 shadow-sm shadow-red-600/25 transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap"
            title="Permanently delete selected items"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" />
            <span className="sm:hidden">Delete</span>
            <span className="hidden sm:inline">Delete Forever</span>
          </button>

          {/* 5. Clear (✕) */}
          <button
            type="button"
            onClick={handleClearSelection}
            className="p-1 rounded-full text-neutral-500 hover:text-neutral-900 dark:text-zinc-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer shrink-0 ml-0.5"
            title="Clear selection"
          >
            <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 5. THEME-AWARE CONFIRMATION MODALS */}
      {/* ------------------------------------------------------------- */}

      {/* Modal A: Permanent Delete (Single / Selected / Empty Bin) */}
      {modal && modal.type !== 'restore_all' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none animate-in fade-in duration-150"
          onClick={() => !actionLoading && setModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#1e1f20] border border-neutral-200 dark:border-zinc-800 p-5 sm:p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 text-left"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Header */}
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base sm:text-lg font-bold text-neutral-900 dark:text-white leading-tight">
                  {modal.type === 'empty'
                    ? 'Empty Bin Forever?'
                    : modal.type === 'delete_single'
                    ? `Permanently delete "${modal.target?.name}"?`
                    : `Permanently delete ${totalSelected} items?`}
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
                  This action cannot be undone.
                </p>
              </div>
            </div>

            {/* Explanation Box */}
            <div className="p-3.5 rounded-xl bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/60 text-xs text-neutral-700 dark:text-neutral-300 space-y-1.5">
              <p>
                {modal.type === 'empty'
                  ? `All ${data.totalCount} items in Bin will be permanently purged from CloudGuard and encrypted cloud storage.`
                  : 'Selected items will be permanently erased from CloudGuard and encrypted cloud storage.'}
              </p>
              <div className="flex items-center justify-between pt-1 border-t border-neutral-200/60 dark:border-neutral-700/60 font-medium">
                <span className="text-neutral-500 dark:text-neutral-400">Storage to be freed:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatBytes(modalFreedBytes)}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setModal(null)}
                className="px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleConfirmPermanentDelete}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/25 transition-all cursor-pointer disabled:opacity-50"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Forever</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal B: Restore All Confirmation */}
      {modal && modal.type === 'restore_all' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none animate-in fade-in duration-150"
          onClick={() => !actionLoading && setModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#1e1f20] border border-neutral-200 dark:border-zinc-800 p-5 sm:p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 text-left"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Header */}
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-500 flex items-center justify-center shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base sm:text-lg font-bold text-neutral-900 dark:text-white leading-tight">
                  Restore all items from Bin?
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
                  All {data.totalCount} items will be moved back to your vault.
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/60 text-xs text-neutral-600 dark:text-neutral-300">
              <p>
                Files and folders will return to their original locations. Any items whose parent folder was permanently deleted will be placed safely in your Home directory.
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setModal(null)}
                className="px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleConfirmRestoreAll}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Restoring...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restore All</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
