import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import {
  LayoutGrid,
  List,
  Grid3X3,
  Grid2X2,
  ChevronLeft,
  ChevronRight,
  Play,
  Image as ImageIcon,
  Download,
  RotateCw,
  Check,
  X,
  Loader2,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useDownload } from '../context/DownloadContext';
import CentralizedFloatingBar from '../components/FloatingBar';

// --------------------------------------------------------------------------
// MODULE-LEVEL CACHES: Persist across tab switching to prevent network refetching
// --------------------------------------------------------------------------
let globalPhotosCache = null;
let lastPhotosFetchTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds fresh cache

// Compatibility cache exports so other components importing them don't break
export const invalidatePhotosCache = () => {
  globalPhotosCache = null;
  lastPhotosFetchTimestamp = 0;
};
export const fetchPhotos = async () => globalPhotosCache || [];
export const updatePhotosCacheWithNewFile = (newFile) => {
  if (globalPhotosCache && newFile) {
    globalPhotosCache = [newFile, ...globalPhotosCache];
  }
};
export const removePhotosFromCache = (fileId) => {
  if (globalPhotosCache && fileId) {
    globalPhotosCache = globalPhotosCache.filter((item) => item._id !== fileId);
  }
};

// Helper to format file sizes
const formatBytes = (bytes) => {
  const n = Number(bytes);
  if (!n || n <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  const safeI = Math.min(Math.max(0, i), sizes.length - 1);
  return `${(n / Math.pow(k, safeI)).toFixed(1)} ${sizes[safeI]}`;
};

// Date group header formatter (Google Photos style)
const getDateHeader = (dateString) => {
  if (!dateString) return 'Earlier';
  const itemDate = new Date(dateString);
  if (isNaN(itemDate.getTime())) return 'Earlier';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (itemDate.toDateString() === today.toDateString()) return 'Today';
  if (itemDate.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return itemDate.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: itemDate.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
};

// Helper to normalize media items for DownloadContext
const prepareDownloadPayload = (item) => ({
  ...item,
  _id: item._id,
  id: item._id,
  name: item.originalName || item.name,
  originalName: item.originalName || item.name,
  url: item.url,
  downloadUrl: item.url,
  accessUrl: item.url,
  s3Url: item.url,
  size: item.size || 0,
  mimeType: item.mimeType,
  s3Key: item.s3Key,
});

export default function PhotosView({ token: propToken }) {
  const toast = useToast();
  const { startDownload, activeDownload } = useDownload();
  const isDownloading = Boolean(activeDownload);

  // Initialize instantly from cache if available
  const [mediaList, setMediaList] = useState(() => globalPhotosCache || []);
  const [loading, setLoading] = useState(() => !globalPhotosCache);
  const [previewIndex, setPreviewIndex] = useState(null);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDownloadingItem, setIsDownloadingItem] = useState(false);

  // Layout view modes
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem('photos_view_mode') || 'grid';
    } catch (e) {
      return 'grid';
    }
  });

  const [gridSize, setGridSize] = useState(() => {
    try {
      return localStorage.getItem('photos_grid_size') || 'medium';
    } catch (e) {
      return 'medium';
    }
  });

  // Mobile swipe tracking
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const urlCacheRef = useRef(new Map()); // fileId -> accessUrl
  const activeLoadIdRef = useRef(null);

  // Native CloudGuard Pill Toast (Theme-Aware & Responsive)
  const showPillToast = useCallback(({ message, actionText = null, onAction = null, duration = 6000 }) => {
    if (!toast?.custom) {
      toast?.success?.(message);
      return;
    }
    toast.custom(
      (t) => (
        <div
          className={`${
            t.visible ? 'animate-in fade-in slide-in-from-bottom-3 duration-200' : 'animate-out fade-out slide-out-to-bottom-2 duration-150'
          } pointer-events-auto flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl shadow-xl border backdrop-blur-md transition-all select-none
          w-full max-w-[calc(100vw-2rem)] sm:max-w-md mx-auto
          bg-white/95 text-neutral-900 border-neutral-200/90 shadow-neutral-900/10
          dark:bg-neutral-900/95 dark:text-neutral-100 dark:border-neutral-800/90 dark:shadow-black/50`}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <p className="text-xs sm:text-sm font-medium truncate leading-tight">
              <span className="font-semibold text-neutral-900 dark:text-white" title={typeof message === 'string' ? message : undefined}>
                {message}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {actionText && onAction && (
              <>
                <div className="h-4 w-[1px] bg-neutral-200 dark:bg-neutral-800" />
                <button
                  type="button"
                  onClick={() => {
                    if (t.dismiss) t.dismiss();
                    else if (toast.dismiss) toast.dismiss(t.id);
                    onAction();
                  }}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 active:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/30 transition-all cursor-pointer whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                >
                  {actionText}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                if (t.dismiss) t.dismiss();
                else if (toast.dismiss) toast.dismiss(t.id);
              }}
              className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 transition-colors cursor-pointer"
              title="Dismiss"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5 stroke-[2]"/>
            </button>
          </div>
        </div>
      ),
      { duration, position: 'bottom-center' }
    );
  }, [toast]);

  const isMountedRef = useRef(false);

  const fetchMedia = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const res = await axios.get('/api/photos', {
        headers: { Authorization: `Bearer ${token}` },
      });

      const list = Array.isArray(res.data) ? res.data : (res.data?.photos || []);
      globalPhotosCache = list;
      lastPhotosFetchTimestamp = Date.now();
      setMediaList(list);
    } catch (err) {
      console.error('Failed to load photos:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Execute fetch ONLY once on initial mount
  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('photos_view_mode', mode);
    } catch (e) {}
  };

  const handleGridSizeChange = (size) => {
    setGridSize(size);
    try {
      localStorage.setItem('photos_grid_size', size);
    } catch (e) {}
  };

  // Group media by date
  const groupedMedia = useMemo(() => {
    const groups = {};
    mediaList.forEach((item) => {
      const dateKey = getDateHeader(item.createdAt || item.uploadedAt);
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(item);
    });
    return groups;
  }, [mediaList]);

  // Responsive grid classes
  const gridColumnClass = useMemo(() => {
    switch (gridSize) {
      case 'small':
        return 'grid-cols-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-8 gap-1.5 sm:gap-2';
      case 'large':
        return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-2.5 sm:gap-4';
      case 'medium':
      default:
        return 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3';
    }
  }, [gridSize]);

  // Selection handlers
  const toggleSelectItem = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === mediaList.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(mediaList.map((m) => m._id)));
    }
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  // 1. Centralized Batch Download (Triggers DownloadContext progress banner, zips <1.5GB, and saves to disk)
  const handleBatchDownload = useCallback(() => {
    const selectedItems = mediaList
      .filter((m) => selectedIds.has(m._id))
      .map(prepareDownloadPayload);

    if (selectedItems.length === 0) return;

    startDownload(selectedItems);
  }, [mediaList, selectedIds, startDownload]);

  // 2. Single Item Download (List View Row Button)
  const handleSingleDownload = useCallback((item, e) => {
    if (e) e.stopPropagation();
    startDownload(prepareDownloadPayload(item));
  }, [startDownload]);

  // Carousel navigation & state
  const currentPreviewItem = previewIndex !== null ? mediaList[previewIndex] : null;
  const previewItem = currentPreviewItem;
  const mediaItems = mediaList;
  const [fullMediaUrl, setFullMediaUrl] = useState(null);
  const [loadingFullMedia, setLoadingFullMedia] = useState(false);
  const setOriginalUrl = setFullMediaUrl;
  const setLoadingOriginal = setLoadingFullMedia;

  const closePreview = useCallback(() => {
    setPreviewIndex(null);
    setFullMediaUrl(null);
    activeLoadIdRef.current = null;
  }, []);

  const setPreviewItem = useCallback((item) => {
    if (!item) {
      closePreview();
      return;
    }
    const idx = mediaList.findIndex((m) => m._id === item._id);
    setPreviewIndex(idx >= 0 ? idx : null);
  }, [mediaList, closePreview]);

  // 2. Single unified media loader with cache check
  const loadMediaUrl = useCallback(async (item) => {
    if (!item || !item._id) return;

    const fileId = item._id;

    // Check cache first for 0ms instant display and 0 network requests
    if (urlCacheRef.current.has(fileId)) {
      setOriginalUrl(urlCacheRef.current.get(fileId));
      setLoadingOriginal(false);
      return;
    }

    // Prevent duplicate back-to-back requests for the same file
    if (activeLoadIdRef.current === fileId) {
      return;
    }
    activeLoadIdRef.current = fileId;

    setOriginalUrl(null);
    setLoadingOriginal(true);

    try {
      const token = propToken || (typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null);
      const res = await axios.get(`/api/files/${fileId}/access`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      const accessUrl = res.data?.accessUrl || res.data?.url;
      if (accessUrl) {
        urlCacheRef.current.set(fileId, accessUrl);
      }

      // Only update state if the user hasn't already clicked away to another item
      if (activeLoadIdRef.current === fileId) {
        setOriginalUrl(accessUrl || item.url || null);
      }
    } catch (err) {
      console.error('Failed to load media asset:', err);
      if (item.url && activeLoadIdRef.current === fileId) {
        setOriginalUrl(item.url);
      }
    } finally {
      if (activeLoadIdRef.current === fileId) {
        setLoadingOriginal(false);
      }
    }
  }, [propToken]);

  // 3. Carousel Navigation Handlers: Only change state, do not double-fetch
  const handleNext = useCallback(() => {
    if (!currentPreviewItem || mediaList.length === 0) return;
    const currentIndex = mediaList.findIndex((m) => m._id === currentPreviewItem._id);
    const nextIndex = (currentIndex + 1) % mediaList.length;
    const nextItem = mediaList[nextIndex];
    setPreviewIndex(nextIndex);
    loadMediaUrl(nextItem);
  }, [currentPreviewItem, mediaList, loadMediaUrl]);

  const handlePrev = useCallback(() => {
    if (!currentPreviewItem || mediaList.length === 0) return;
    const currentIndex = mediaList.findIndex((m) => m._id === currentPreviewItem._id);
    const prevIndex = (currentIndex - 1 + mediaList.length) % mediaList.length;
    const prevItem = mediaList[prevIndex];
    setPreviewIndex(prevIndex);
    loadMediaUrl(prevItem);
  }, [currentPreviewItem, mediaList, loadMediaUrl]);

  const navigateNext = handleNext;
  const navigatePrev = handlePrev;

  // 4. Grid card click handler
  const openPreview = useCallback((item, index = null) => {
    if (!item) return;
    const targetIndex = index !== null && index >= 0 
      ? index 
      : mediaList.findIndex((m) => m._id === item._id);
    setPreviewIndex(targetIndex >= 0 ? targetIndex : null);
    loadMediaUrl(item);
  }, [mediaList, loadMediaUrl]);

  // 3. Lightbox Preview Download (Top-Right Button)
  const handlePreviewDownload = useCallback(() => {
    if (!currentPreviewItem) return;
    const downloadItem = {
      ...currentPreviewItem,
      url: fullMediaUrl || currentPreviewItem.url,
      accessUrl: fullMediaUrl || currentPreviewItem.accessUrl || currentPreviewItem.url,
    };
    startDownload(prepareDownloadPayload(downloadItem));
  }, [currentPreviewItem, fullMediaUrl, startDownload]);

  const handleDownloadMedia = async (item, e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!item || isDownloadingItem) return;

    setIsDownloadingItem(true);

    const fileName = item.originalName || item.name || 'download';
    let targetUrl = item.downloadUrl || item.accessUrl || item.url || fullMediaUrl;

    if (!targetUrl && item._id) {
      try {
        const token = propToken || (typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null);
        const res = await axios.get(`/api/files/${item._id}/access`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        targetUrl = res.data?.downloadUrl || res.data?.accessUrl || res.data?.url;
      } catch (err) {
        console.warn('Failed to fetch access URL for download:', err);
      }
    }

    try {
      if (typeof startDownload === 'function') {
        // DownloadContext handles queue and starting toast
        await startDownload([{
          _id: item._id,
          id: item._id,
          name: fileName,
          url: targetUrl,
          downloadUrl: targetUrl,
          size: item.size || 0,
        }]);
        return; // Strict return: do NOT fall through
      }

      // Fallback ONLY if DownloadContext is unavailable
      if (toast?.info) toast.info(`Downloading started: "${fileName}"`);
      const res = await fetch(targetUrl);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download failed:', err);
      if (toast?.error) toast.error('Failed to download file');
    } finally {
      // Reset lock after short delay to prevent double-click bounce
      setTimeout(() => setIsDownloadingItem(false), 1000);
    }
  };

  // Undo Delete
  const handleUndoDelete = async (itemsToRestore) => {
    try {
      const token = propToken || localStorage.getItem('token');
      const fileIds = itemsToRestore.map((i) => i._id);

      await axios.post(
        '/api/files/restore-batch',
        { fileIds, folderIds: [] },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );

      showPillToast({ message: 'Deletion undone', duration: 3000 });
      fetchMedia(true);
    } catch (err) {
      console.error('Failed to undo delete:', err);
      toast.error('Could not undo deletion');
    }
  };

  // Confirm Permanent Deletion
  const handleConfirmPermanentDelete = async () => {
    const itemsToDelete = mediaList.filter((m) => selectedIds.has(m._id));
    setIsDeleteModalOpen(false);
    deselectAll();

    try {
      const token = propToken || localStorage.getItem('token');
      const fileIds = itemsToDelete.map((m) => m._id);

      await axios.post(
        '/api/files/delete-batch',
        { fileIds, folderIds: [] },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );

      const updated = mediaList.filter((m) => !fileIds.includes(m._id));
      globalPhotosCache = updated;
      setMediaList(updated);

      const itemsToRestore = [...itemsToDelete];
      const getDeleteToastContent = (items) => {
        if (!items || items.length === 0) return { action: 'Deleted', target: 'item' };
        if (items.length === 1) {
          return {
            action: 'Deleted',
            target: items[0].name || 'item',
          };
        }
        return {
          action: 'Deleted',
          target: `${items.length} items`,
        };
      };

      const toastData = getDeleteToastContent(itemsToRestore);

      toast.custom(
        (t) => (
          <div
            className={`${
              t.visible ? 'animate-in fade-in slide-in-from-bottom-3 duration-200' : 'animate-out fade-out slide-out-to-bottom-2 duration-150'
            } pointer-events-auto flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl shadow-xl border backdrop-blur-md transition-all select-none
            w-full max-w-[calc(100vw-2rem)] sm:max-w-md mx-auto
            bg-white/95 text-neutral-900 border-neutral-200/90 shadow-neutral-900/10
            dark:bg-neutral-900/95 dark:text-neutral-100 dark:border-neutral-800/90 dark:shadow-black/50`}
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>

              <p className="text-xs sm:text-sm font-medium truncate leading-tight">
                <span className="text-neutral-500 dark:text-neutral-400 font-normal mr-1">
                  {toastData.action}
                </span>
                <span className="font-semibold text-neutral-900 dark:text-white" title={toastData.target}>
                  "{toastData.target}"
                </span>
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="h-4 w-[1px] bg-neutral-200 dark:bg-neutral-800" />
              <button
                type="button"
                onClick={() => {
                  if (t.dismiss) t.dismiss();
                  else if (toast.dismiss) toast.dismiss(t.id);
                  handleUndoDelete(itemsToRestore);
                }}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 active:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/30 transition-all cursor-pointer whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={() => {
                  if (t.dismiss) t.dismiss();
                  else if (toast.dismiss) toast.dismiss(t.id);
                }}
                className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 transition-colors cursor-pointer"
                title="Dismiss"
                aria-label="Dismiss notification"
              >
                <X className="w-3.5 h-3.5 stroke-[2]"/>
              </button>
            </div>
          </div>
        ),
        {
          duration: 6000,
          position: 'bottom-center',
        }
      );
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete selected items');
      fetchMedia(true);
    }
  };

  useEffect(() => {
    if (previewIndex === null) return;
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'Escape') closePreview();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewIndex, handlePrev, handleNext, closePreview]);

  const handleTouchStart = (e) => {
    touchStartX.current = e.changedTouches[0].screenX;
  };

  const handleTouchEnd = (e) => {
    touchEndX.current = e.changedTouches[0].screenX;
    const diff = touchStartX.current - touchEndX.current;
    if (diff > 50) navigateNext();
    if (diff < -50) navigatePrev();
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto transition-colors duration-200">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 border-b border-zinc-200 dark:border-zinc-800/80 pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Photos & Media
          </h1>
          <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            {mediaList.length} {mediaList.length === 1 ? 'item' : 'items'} in your vault
          </p>
        </div>

        {/* View Controls */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* 1. Reload Button (Left of Tile Resizer) */}
          <button
            type="button"
            onClick={() => {
              // Clear in-memory photos cache if present and force fresh fetch
              if (typeof globalPhotosCache !== 'undefined') globalPhotosCache = null;
              if (typeof fetchMedia === 'function') fetchMedia(true);
              else if (typeof fetchPhotos === 'function') fetchPhotos(true);
            }}
            disabled={loading}
            title="Reload photos"
            aria-label="Reload photos"
            className="p-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700/60 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800/80 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-500' : ''}`} />
          </button>

          {viewMode === 'grid' && (
            <div className="flex items-center bg-zinc-200/80 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => handleGridSizeChange('small')}
                title="Small (Dense)"
                className={`p-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                  gridSize === 'small'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleGridSizeChange('medium')}
                title="Medium (Default)"
                className={`p-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                  gridSize === 'medium'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleGridSizeChange('large')}
                title="Large (Spacious)"
                className={`p-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                  gridSize === 'large'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Grid2X2 className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex items-center bg-zinc-200/80 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => handleViewModeChange('grid')}
              title="Grid View"
              className={`p-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange('list')}
              title="List View"
              className={`p-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading ? (
        <div className="space-y-6">
          {[...Array(2)].map((_, gIdx) => (
            <div key={gIdx} className="space-y-3">
              <div className="h-5 w-28 bg-zinc-200 dark:bg-zinc-800/60 rounded animate-pulse" />
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className="aspect-square bg-zinc-200 dark:bg-zinc-900 rounded-xl animate-pulse border border-zinc-300 dark:border-zinc-800/40"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : mediaList.length === 0 ? (
        <div className="text-center py-24 border border-dashed border-zinc-300 dark:border-zinc-800 rounded-2xl bg-white/50 dark:bg-zinc-900/30">
          <ImageIcon className="w-12 h-12 text-zinc-400 dark:text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-700 dark:text-zinc-300 font-medium text-sm">No photos or media in your account</p>
          <p className="text-zinc-400 dark:text-zinc-500 text-xs mt-1">Uploaded images and videos will appear here</p>
        </div>
      ) : viewMode === 'grid' ? (
        /* GRID VIEW (Date-Grouped) */
        <div className="space-y-8 pb-24">
          {Object.entries(groupedMedia).map(([dateGroup, items]) => (
            <section key={dateGroup} className="space-y-2.5">
              <div className="sticky top-0 z-10 py-1.5 bg-zinc-50/90 dark:bg-[#09090b]/90 backdrop-blur-md flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800/60 transition-colors">
                <h2 className="text-xs sm:text-sm font-semibold text-zinc-700 dark:text-zinc-300 tracking-wide">
                  {dateGroup}
                </h2>
                <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                  {items.length} {items.length === 1 ? 'item' : 'items'}
                </span>
              </div>

              <div className={`grid ${gridColumnClass}`}>
                {items.map((item) => {
                  const globalIndex = mediaList.findIndex((m) => m._id === item._id);
                  const isVideo = item.mimeType?.startsWith('video/') || item.mediaType === 'video' || item.name?.match(/\.(mp4|webm|mov|mkv)$/i);
                  const isSelected = selectedIds.has(item._id);

                  return (
                    <div
                      key={item._id}
                      onClick={() => openPreview(item, globalIndex)}
                      className={`group relative aspect-square bg-white dark:bg-zinc-900 rounded-lg sm:rounded-xl overflow-hidden border transition-all shadow-sm active:scale-95 touch-manipulation cursor-pointer ${
                        isSelected
                          ? 'ring-2 ring-emerald-500 border-emerald-500 dark:border-emerald-500'
                          : 'border-zinc-200 dark:border-zinc-800/70 hover:border-zinc-400 dark:hover:border-zinc-600'
                      }`}
                    >
                      {/* Checkbox Trigger */}
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectItem(item._id);
                        }}
                        className={`absolute top-1.5 left-1.5 sm:top-2 sm:left-2 z-20 w-6 h-6 rounded-md flex items-center justify-center transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-500 text-white shadow-md'
                            : 'bg-black/50 hover:bg-black/70 text-transparent hover:text-white/80 border border-white/60 opacity-80 sm:opacity-0 sm:group-hover:opacity-100'
                        }`}
                        title={isSelected ? 'Deselect item' : 'Select item'}
                      >
                        <Check className={`w-3.5 h-3.5 stroke-[3] ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
                      </div>

                      {/* Card Thumbnail Container */}
                      {(() => {
                        const displayThumbnail = item.thumbnailUrl || item.thumbnail || item.url || item.accessUrl;
                        return (
                          <div className="relative w-full h-full overflow-hidden bg-neutral-100 dark:bg-neutral-900 flex items-center justify-center">
                            {displayThumbnail ? (
                              <img
                                src={displayThumbnail}
                                alt={item.name}
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                onError={(e) => {
                                  // Fallback if image URL fails to load
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-neutral-200 dark:bg-zinc-800">
                                {isVideo ? (
                                  <Play className="w-8 h-8 text-neutral-400 dark:text-zinc-500"/>
                                ) : (
                                  <ImageIcon className="w-8 h-8 text-neutral-400 dark:text-zinc-500"/>
                                )}
                              </div>
                            )}

                            {/* Video Badge Overlay */}
                            {isVideo && (
                              <div className="absolute top-2 left-2 z-10 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-md flex items-center gap-1 text-[11px] font-medium text-white border border-white/10 select-none pointer-events-none">
                                <Play className="w-3 h-3 fill-white"/>
                                <span>Video</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity hidden sm:flex items-end p-2 pointer-events-none">
                        <span className="text-[11px] text-white truncate w-full font-medium">
                          {item.originalName || item.name}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        /* LIST VIEW */
        <div className="space-y-6 pb-24">
          {Object.entries(groupedMedia).map(([dateGroup, items]) => (
            <section key={dateGroup} className="space-y-2">
              <div className="sticky top-0 z-10 py-1.5 bg-zinc-50/90 dark:bg-[#09090b]/90 backdrop-blur-md flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800/60 transition-colors">
                <h2 className="text-xs sm:text-sm font-semibold text-zinc-700 dark:text-zinc-300 tracking-wide">
                  {dateGroup}
                </h2>
                <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                  {items.length} {items.length === 1 ? 'item' : 'items'}
                </span>
              </div>

              <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800/80 rounded-xl divide-y divide-zinc-200 dark:divide-zinc-800/60 overflow-hidden shadow-sm">
                {items.map((item) => {
                  const globalIndex = mediaList.findIndex((m) => m._id === item._id);
                  const isVideo = item.mimeType?.startsWith('video/') || item.mediaType === 'video' || item.name?.match(/\.(mp4|webm|mov|mkv)$/i);
                  const isSelected = selectedIds.has(item._id);

                  return (
                    <div
                      key={item._id}
                      onClick={() => openPreview(item, globalIndex)}
                      className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-emerald-500/10 dark:bg-emerald-500/15'
                          : 'hover:bg-zinc-100/70 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectItem(item._id);
                          }}
                          className={`w-5 h-5 rounded flex items-center justify-center transition-colors cursor-pointer shrink-0 border ${
                            isSelected
                              ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                              : 'border-zinc-300 dark:border-zinc-700 hover:border-emerald-500 bg-white dark:bg-zinc-800'
                          }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>

                        {/* 40x40 Thumbnail */}
                        <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center border border-zinc-200 dark:border-zinc-700/50 relative">
                          {(() => {
                            const displayThumbnail = item.thumbnailUrl || item.thumbnail || item.url || item.accessUrl;
                            return (
                              <>
                                {displayThumbnail ? (
                                  <img
                                    src={displayThumbnail}
                                    alt={item.name || ''}
                                    className="w-full h-full object-cover object-center"
                                    loading="lazy"
                                    decoding="async"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                    }}
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-zinc-200 dark:bg-zinc-800">
                                    {isVideo ? (
                                      <Play className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                                    ) : (
                                      <ImageIcon className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                                    )}
                                  </div>
                                )}
                                {isVideo && (
                                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
                                    <Play className="w-3.5 h-3.5 fill-white text-white" />
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>

                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                            {item.originalName || item.name}
                          </p>
                          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                            {formatBytes(item.size)} • {item.mediaType.toUpperCase()}
                          </p>
                        </div>
                      </div>

                      {item.url && (
                        <button
                          type="button"
                          onClick={(e) => handleSingleDownload(item, e)}
                          className="p-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0 cursor-pointer"
                          title="Download"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Centralized Floating Action Bar */}
      {selectedIds.size > 0 && (
        <CentralizedFloatingBar
          selectedCount={selectedIds.size}
          totalCount={mediaList.length}
          isAllSelected={selectedIds.size === mediaList.length}
          onToggleSelectAll={toggleSelectAll}
          onDownload={handleBatchDownload}
          onDelete={() => setIsDeleteModalOpen(true)}
          onClear={deselectAll}
          isDownloading={isDownloading}
        />
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && (() => {
        const singleItem = selectedIds.size === 1 ? mediaList.find((m) => selectedIds.has(m._id)) : null;
        const modalTitle = singleItem ? `Delete "${singleItem.name}"?` : `Permanently delete ${selectedIds.size} items?`;
        const modalDesc = selectedIds.size > 1
          ? `Are you sure you want to permanently delete these ${selectedIds.size} items? This action cannot be undone and will immediately free up your storage.`
          : 'Are you sure you want to permanently delete this file? This action cannot be undone and will immediately free up your storage.';

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 max-w-md w-full shadow-2xl transition-colors">
              <h3 
                className="text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate max-w-sm"
                title={modalTitle}
              >
                {modalTitle}
              </h3>
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 mt-2">
                {modalDesc}
              </p>

              <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 sm:gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setIsDeleteModalOpen(false)}
                  className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPermanentDelete}
                  className="w-full sm:w-auto px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-xl shadow-lg shadow-red-600/25 transition-all cursor-pointer"
                >
                  Permanently delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Full Lightbox Carousel (Active <video> tag mounts ONLY here) */}
      {currentPreviewItem && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) closePreview();
          }}
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center animate-enter select-none"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className="absolute top-3 inset-x-3 sm:inset-x-6 flex items-center justify-between text-zinc-300 z-20 pointer-events-auto">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs sm:text-sm font-medium truncate max-w-[180px] sm:max-w-md text-zinc-200">
                {currentPreviewItem.originalName || currentPreviewItem.name}
              </span>
              <span className="text-xs text-zinc-500 hidden sm:inline">
                ({previewIndex + 1} of {mediaList.length})
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Download Button (Left of Cross) */}
              <button
                type="button"
                disabled={isDownloadingItem}
                onClick={(e) => handleDownloadMedia(currentPreviewItem, e)}
                title="Download media"
                aria-label="Download media"
                className="p-2 rounded-full bg-neutral-800/80 hover:bg-neutral-700 active:scale-95 disabled:opacity-50 text-neutral-200 hover:text-white backdrop-blur-md border border-neutral-700/50 transition-all cursor-pointer shrink-0"
              >
                <Download className="w-4 h-4 sm:w-4.5 sm:h-4.5"/>
              </button>

              {/* Existing Cross (✕) Close Button */}
              <button
                type="button"
                onClick={closePreview}
                className="p-2 rounded-full bg-neutral-800/80 hover:bg-neutral-700 active:scale-95 text-neutral-200 hover:text-white backdrop-blur-md border border-neutral-700/50 transition-all cursor-pointer shrink-0"
                title="Close preview"
                aria-label="Close preview"
              >
                <X className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
              </button>
            </div>
          </div>

          {previewIndex > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigatePrev();
              }}
              className="absolute left-2 sm:left-6 z-20 p-2 sm:p-3 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-zinc-700/60 shadow-xl transition-all cursor-pointer active:scale-95"
              aria-label="Previous item"
            >
              <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          )}

          {previewIndex < mediaList.length - 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigateNext();
              }}
              className="absolute right-2 sm:right-6 z-20 p-2 sm:p-3 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-zinc-700/60 shadow-xl transition-all cursor-pointer active:scale-95"
              aria-label="Next item"
            >
              <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          )}

          <div className="max-w-5xl max-h-[82vh] w-full flex items-center justify-center p-2">
            {(currentPreviewItem.mediaType === 'video' || currentPreviewItem.mimeType?.startsWith('video/') || currentPreviewItem.name?.match(/\.(mp4|webm|mov|mkv)$/i)) ? (
              (fullMediaUrl || currentPreviewItem.url) ? (
                <video
                  key={fullMediaUrl || currentPreviewItem.url}
                  src={fullMediaUrl || currentPreviewItem.url}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[80vh] w-auto max-w-full rounded-lg shadow-2xl bg-black"
                />
              ) : (
                <div className="relative flex items-center justify-center max-h-[80vh] w-full min-h-[300px]">
                  {(currentPreviewItem.thumbnailUrl || currentPreviewItem.url) && (
                    <img
                      src={currentPreviewItem.thumbnailUrl || currentPreviewItem.url}
                      alt={currentPreviewItem.name}
                      className="max-h-[80vh] max-w-full object-contain rounded-lg filter blur-sm opacity-60"
                    />
                  )}
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-2">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                    <span className="text-xs font-medium">Loading video...</span>
                  </div>
                </div>
              )
            ) : (
              <div className="relative flex items-center justify-center max-h-[80vh] w-full">
                {/* Instant thumbnail / preview display so modal opens with zero delay */}
                {(currentPreviewItem.thumbnailUrl || currentPreviewItem.accessUrl || currentPreviewItem.url) && (
                  <img
                    src={currentPreviewItem.thumbnailUrl || currentPreviewItem.accessUrl || currentPreviewItem.url}
                    alt={currentPreviewItem.name}
                    className={`max-h-[80vh] max-w-full object-contain rounded-lg shadow-2xl transition-opacity duration-300 ${
                      fullMediaUrl ? 'opacity-0 absolute' : 'opacity-100'
                    }`}
                  />
                )}
                {/* High-res original once loaded */}
                {fullMediaUrl && (
                  <img
                    key={fullMediaUrl}
                    src={fullMediaUrl}
                    alt={currentPreviewItem.name}
                    className="max-h-[80vh] max-w-full object-contain rounded-lg shadow-2xl transition-opacity duration-300 opacity-100"
                  />
                )}
                {loadingFullMedia && !fullMediaUrl && (
                  <div className="absolute bottom-4 right-4 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-2 text-white text-xs border border-white/10 shadow-lg">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                    <span>Loading high resolution...</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="absolute bottom-3 text-center text-xs text-zinc-400 z-10 pointer-events-none">
            {formatBytes(currentPreviewItem.size)} • {getDateHeader(currentPreviewItem.createdAt || currentPreviewItem.uploadedAt)} • {previewIndex + 1} of {mediaList.length}
          </div>
        </div>
      )}
    </div>
  );
}
