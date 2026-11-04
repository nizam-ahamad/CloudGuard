import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { 
  Check, 
  Trash2, 
  Download, 
  X, 
  Play, 
  Image as ImageIcon, 
  ChevronLeft, 
  ChevronRight, 
  AlertCircle, 
  Loader2,
  LayoutGrid,
  List,
  Minus,
  Plus,
  Film
} from 'lucide-react';
import MediaCarouselModal from '../components/MediaCarouselModal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { API_BASE_URL } from '../config';
import { 
  downloadSingleFileWithProgress, 
  downloadBatchZipWithProgress 
} from '../utils/downloadHelper';
import { useToast } from '../context/ToastContext';

const INITIAL_BATCH = 40;
const BATCH_SIZE = 40;

// --- Module-Level Session Cache (Lives across component unmounts) ---
let photosSessionCache = null;

// Exported cache helper
export const updatePhotosCacheWithNewFile = (file) => {
  if (!file) return;
  const isMedia =
    file.mimeType?.startsWith('image/') ||
    file.mimeType?.startsWith('video/') ||
    file.mimetype?.startsWith('image/') ||
    file.mimetype?.startsWith('video/') ||
    /\.(jpg|jpeg|png|webp|gif|svg|mp4|webm|mov|mkv)$/i.test(file.name || file.originalName || '');

  if (isMedia && photosSessionCache) {
    const ext = (file.name || file.originalName || '').split('.').pop().toLowerCase();
    const isVideo = (file.mimeType || file.mimetype || '').startsWith('video') || ['mp4', 'webm', 'mov', 'mkv'].includes(ext);
    const mimeType = file.mimeType || file.mimetype || (isVideo ? `video/${ext === 'mov' ? 'quicktime' : ext}` : `image/${ext === 'jpg' ? 'jpeg' : ext}`);
    const normalizedFile = {
      ...file,
      _id: String(file._id || file.id),
      name: file.name || file.originalName,
      mimeType: mimeType,
      s3Url: file.s3Url || file.url || '',
      url: file.url || file.s3Url || '',
      createdAt: file.createdAt || file.uploadedAt || new Date().toISOString()
    };
    // Prepend to module cache so it's ready when the tab opens
    photosSessionCache = [normalizedFile, ...photosSessionCache.filter((item) => String(item._id) !== String(normalizedFile._id))];
  }
};

export const removePhotosFromCache = (fileIds) => {
  if (!fileIds) return;
  const idsToRemove = Array.isArray(fileIds) ? fileIds.map(String) : [String(fileIds)];
  if (photosSessionCache) {
    photosSessionCache = photosSessionCache.filter((item) => !idsToRemove.includes(String(item._id)));
  }
};

export const invalidatePhotosCache = () => {
  photosSessionCache = null;
};

// Global event listeners to keep session cache up to date even when PhotosView is unmounted
if (typeof window !== 'undefined') {
  const handleGlobalUpload = (event) => {
    updatePhotosCacheWithNewFile(event.detail);
  };
  window.addEventListener('cloudguard:file-uploaded', handleGlobalUpload);
  window.addEventListener('cloudguard:media-uploaded', handleGlobalUpload);
  window.addEventListener('cloudguard:file-deleted', (event) => {
    removePhotosFromCache(event.detail);
  });
}

const gridClassMap = {
  sm: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5',
  md: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5', // Default
  lg: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5',
};

const aspectMap = {
  sm: 'aspect-square',
  md: 'aspect-[4/3]',
  lg: 'aspect-[16/10]',
};

const formatBytes = (bytes, decimals = 1) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

export default function PhotosView({ token: propToken }) {
  // Initialize state synchronously from session cache (No flash, no spinner if cached)
  const [photos, setPhotos] = useState(() => photosSessionCache || []);
  const [loading, setLoading] = useState(() => !photosSessionCache);
  const [error, setError] = useState(null);
  const [selectedCarouselIndex, setSelectedCarouselIndex] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ percent: 0, text: '' });
  const [isDeleting, setIsDeleting] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH);
  const observerTarget = useRef(null);
  const toast = useToast();

  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('cg_photos_view_mode') || 'grid'; // 'grid' | 'list'
  });

  const [gridSize, setGridSize] = useState(() => {
    return localStorage.getItem('cg_photos_grid_size') || 'md'; // 'sm' | 'md' | 'lg'
  });

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem('cg_photos_view_mode', mode);
  };

  const handleGridSizeChange = (size) => {
    setGridSize(size);
    localStorage.setItem('cg_photos_grid_size', size);
  };

  // Cycle through sizes: sm -> md -> lg
  const cycleGridSize = (direction) => {
    const sizes = ['sm', 'md', 'lg'];
    const currentIndex = sizes.indexOf(gridSize);
    if (direction === 'increase' && currentIndex < sizes.length - 1) {
      handleGridSizeChange(sizes[currentIndex + 1]);
    } else if (direction === 'decrease' && currentIndex > 0) {
      handleGridSizeChange(sizes[currentIndex - 1]);
    }
  };

  const token = propToken || localStorage.getItem('token') || sessionStorage.getItem('token');
  const isSelectionActive = Array.isArray(selectedIds) && selectedIds.length > 0;
  const isAllSelected = photos.length > 0 && selectedIds.length === photos.length;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(photos.map(p => p._id));
    }
  };

  // SWR: Stale-While-Revalidate
  const loadPhotos = useCallback(async (isInitial = false) => {
    // 1. If memory cache exists, render it immediately without waiting
    if (photosSessionCache) {
      setPhotos(photosSessionCache);
      setLoading(false);
    } else if (isInitial) {
      setLoading(true);
    }

    if (!token) {
      setLoading(false);
      return;
    }

    // 2. Silently revalidate with backend in background
    try {
      const res = await axios.get(`${API_BASE_URL}/api/files/photos`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const freshData = res.data?.files || (Array.isArray(res.data) ? res.data : []);

      // Compare length or IDs to prevent unnecessary re-renders
      const hasChanged =
        !photosSessionCache ||
        photosSessionCache.length !== freshData.length ||
        freshData.some((f, i) => f._id !== photosSessionCache[i]?._id);

      if (hasChanged) {
        photosSessionCache = freshData;
        setPhotos(freshData);
      }
    } catch (err) {
      console.error('Background sync failed:', err);
      if (!photosSessionCache || photosSessionCache.length === 0) {
        setError(err.response?.data?.message || 'Failed to load media assets');
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadPhotos(true);
  }, [loadPhotos]);

  // 2. Listen for Live Uploads from Anywhere in the App
  useEffect(() => {
    const handleMediaUploaded = (event) => {
      const newFile = event.detail;
      if (!newFile) return;

      const isMedia =
        newFile.mimeType?.startsWith('image/') ||
        newFile.mimeType?.startsWith('video/') ||
        newFile.mimetype?.startsWith('image/') ||
        newFile.mimetype?.startsWith('video/') ||
        /\.(jpg|jpeg|png|webp|gif|svg|mp4|webm|mov|mkv)$/i.test(newFile.name || newFile.originalName || '');

      if (isMedia) {
        const ext = (newFile.name || newFile.originalName || '').split('.').pop().toLowerCase();
        const isVideo = (newFile.mimeType || newFile.mimetype || '').startsWith('video') || ['mp4', 'webm', 'mov', 'mkv'].includes(ext);
        const mimeType = newFile.mimeType || newFile.mimetype || (isVideo ? `video/${ext === 'mov' ? 'quicktime' : ext}` : `image/${ext === 'jpg' ? 'jpeg' : ext}`);
        const normalizedFile = {
          ...newFile,
          _id: String(newFile._id || newFile.id),
          name: newFile.name || newFile.originalName,
          mimeType: mimeType,
          s3Url: newFile.s3Url || newFile.url || '',
          url: newFile.url || newFile.s3Url || '',
          createdAt: newFile.createdAt || newFile.uploadedAt || new Date().toISOString()
        };

        setPhotos((prev) => {
          // Prevent duplicate entries if already present
          if (prev.some((item) => item._id === normalizedFile._id || String(item._id) === String(normalizedFile._id))) return prev;
          const updated = [normalizedFile, ...prev];
          photosSessionCache = updated; // Keep session cache in sync
          return updated;
        });
      }
    };

    window.addEventListener('cloudguard:media-uploaded', handleMediaUploaded);
    window.addEventListener('cloudguard:file-uploaded', handleMediaUploaded);
    return () => {
      window.removeEventListener('cloudguard:media-uploaded', handleMediaUploaded);
      window.removeEventListener('cloudguard:file-uploaded', handleMediaUploaded);
    };
  }, []);

  // 3. Listen for File Deletions from Anywhere in the App
  useEffect(() => {
    const handleFileDeleted = (event) => {
      const fileIds = event.detail;
      if (!fileIds) return;
      const idsToRemove = Array.isArray(fileIds) ? fileIds.map(String) : [String(fileIds)];
      setPhotos((prev) => {
        const remaining = prev.filter((p) => !idsToRemove.includes(String(p._id)));
        photosSessionCache = remaining;
        return remaining;
      });
      setSelectedIds((prev) => prev.filter((id) => !idsToRemove.includes(String(id))));
    };

    window.addEventListener('cloudguard:file-deleted', handleFileDeleted);
    return () => window.removeEventListener('cloudguard:file-deleted', handleFileDeleted);
  }, []);

  // Windowing: reset visible count when photos change
  useEffect(() => {
    setVisibleCount(INITIAL_BATCH);
  }, [photos]);

  // Infinite Scroll / Lazy Windowing Intersection Observer
  useEffect(() => {
    const target = observerTarget.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0] && entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + BATCH_SIZE, photos.length));
        }
      },
      { rootMargin: '300px' }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [photos.length]);

  const visiblePhotos = photos.slice(0, visibleCount);

  const toggleSelect = (id, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    const idStr = String(id);
    setSelectedIds(prev => 
      prev.includes(idStr) ? prev.filter(item => item !== idStr) : [...prev, idStr]
    );
  };

  const clearSelection = () => setSelectedIds([]);

  const handlePromptDelete = () => {
    if (selectedIds.length === 0) return;
    setIsDeleteModalOpen(true);
  };

  const handleConfirmBatchDelete = async () => {
    const count = selectedIds.length;
    try {
      setIsDeleting(true);
      await axios.post(`${API_BASE_URL}/api/files/bulk-delete`, {
        fileIds: selectedIds
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const remaining = photos.filter(p => !selectedIds.includes(String(p._id)));
      photosSessionCache = remaining; // Keep memory cache in sync
      setPhotos(remaining);
      clearSelection();
      setIsDeleteModalOpen(false);

      window.dispatchEvent(
        new CustomEvent('cloudguard:file-deleted', {
          detail: selectedIds
        })
      );

      // Trigger success pop-up toast
      toast.success(`${count} ${count === 1 ? 'item' : 'items'} deleted`);
    } catch (err) {
      console.error('Failed to delete media items:', err);
      toast.error('Failed to delete items. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (isDeleteModalOpen) {
        if (e.key === 'Escape' && !isDeleting) {
          setIsDeleteModalOpen(false);
        } else if (e.key === 'Enter' && !isDeleting) {
          e.preventDefault();
          handleConfirmBatchDelete();
        }
        return;
      }
      if (e.key === 'Escape' && isSelectionActive && selectedCarouselIndex === null) {
        clearSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDeleteModalOpen, isDeleting, isSelectionActive, selectedCarouselIndex, selectedIds]);

  const handleOpenCarousel = (index) => {
    setSelectedCarouselIndex(index);
  };

  const handleCloseCarousel = () => {
    setSelectedCarouselIndex(null);
  };

  const handleBatchDownload = async () => {
    if (selectedIds.length === 0) return;
    const itemsToDownload = photos.filter((p) => selectedIds.includes(p._id));
    if (!itemsToDownload || itemsToDownload.length === 0) return;

    try {
      setIsDownloading(true);
      setDownloadProgress({ percent: 0, text: 'Starting download...' });

      if (itemsToDownload.length === 1) {
        await downloadSingleFileWithProgress(itemsToDownload[0], (progress) => {
          setDownloadProgress(progress);
        });
        toast.success(`Downloaded: ${itemsToDownload[0].name}`);
      } else {
        await downloadBatchZipWithProgress(itemsToDownload, (progress) => {
          setDownloadProgress(progress);
        });
        toast.success(`Downloaded ${itemsToDownload.length} files as ZIP`);
      }

      setSelectedIds([]);
    } catch (err) {
      console.error('Download failed:', err);
      toast.error('Download failed. Check your network connection.');
    } finally {
      setIsDownloading(false);
      setDownloadProgress({ percent: 0, text: '' });
    }
  };

  return (
    <div className="w-full pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 select-none">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white tracking-tight">
            Photos & Media
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {loading ? 'Loading media...' : `${photos.length} ${photos.length === 1 ? 'item' : 'items'}`}
          </p>
        </div>

        {/* View & Density Controls */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* Grid Size Resizer (Only visible in Grid mode) */}
          {viewMode === 'grid' && (
            <div className="flex items-center bg-neutral-100 dark:bg-neutral-800/80 p-0.5 rounded-lg border border-neutral-200 dark:border-neutral-700/60">
              <button
                onClick={() => cycleGridSize('decrease')}
                disabled={gridSize === 'sm'}
                className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white dark:hover:bg-neutral-700 transition-colors cursor-pointer"
                title="Smaller tiles"
              >
                <Minus className="w-3.5 h-3.5"/>
              </button>

              <span className="text-[11px] font-semibold tracking-wider text-neutral-600 dark:text-neutral-300 px-2 uppercase">
                {gridSize === 'sm' ? 'Small' : gridSize === 'md' ? 'Medium' : 'Large'}
              </span>

              <button
                onClick={() => cycleGridSize('increase')}
                disabled={gridSize === 'lg'}
                className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white dark:hover:bg-neutral-700 transition-colors cursor-pointer"
                title="Larger tiles"
              >
                <Plus className="w-3.5 h-3.5"/>
              </button>
            </div>
          )}

          {/* Grid / List Mode Segmented Toggle */}
          <div className="flex items-center bg-neutral-100 dark:bg-neutral-800/80 p-0.5 rounded-lg border border-neutral-200 dark:border-neutral-700/60">
            <button
              onClick={() => handleViewModeChange('grid')}
              className={`p-1.5 rounded-md transition-all cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm font-medium'
                  : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
              }`}
              title="Grid view"
            >
              <LayoutGrid className="w-4 h-4"/>
            </button>

            <button
              onClick={() => handleViewModeChange('list')}
              className={`p-1.5 rounded-md transition-all cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm font-medium'
                  : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
              }`}
              title="List view"
            >
              <List className="w-4 h-4"/>
            </button>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
          <Loader2 className="w-8 h-8 animate-spin mb-3 text-blue-500" />
          <p className="text-sm">Loading your photos & videos...</p>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && photos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/20">
          <div className="w-16 h-16 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400 dark:text-neutral-500 mb-4 shadow-sm">
            <ImageIcon className="w-8 h-8" />
          </div>
          <h3 className="text-base font-semibold text-neutral-800 dark:text-neutral-200 mb-1">
            No photos or videos in your vault yet
          </h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-sm">
            Uploaded pictures and video files across all your folders will automatically be organized and showcased here.
          </p>
        </div>
      )}

      {/* Responsive Media Grid / List */}
      {!loading && photos.length > 0 && (
        <>
          {viewMode === 'list' ? (
            <div className="bg-white dark:bg-neutral-900/60 rounded-xl border border-neutral-200 dark:border-neutral-800/80 overflow-hidden divide-y divide-neutral-100 dark:divide-neutral-800/60">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-4 px-4 py-2.5 text-xs font-semibold text-neutral-400 dark:text-neutral-500 bg-neutral-50 dark:bg-neutral-800/40 select-none">
                <div className="col-span-6 sm:col-span-5 flex items-center gap-3">
                  <span className="w-5 text-center">#</span>
                  <span>Name</span>
                </div>
                <div className="col-span-3 sm:col-span-3 hidden sm:block">Date Added</div>
                <div className="col-span-3 sm:col-span-2 text-right sm:text-left">Size</div>
                <div className="col-span-3 sm:col-span-2 text-right">Type</div>
              </div>

              {/* Table Rows */}
              {visiblePhotos.map((file, index) => {
                const isSelected = selectedIds.includes(String(file._id));
                const isVideo = file.mimeType?.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(file.name || '');

                return (
                  <div
                    key={file._id}
                    onClick={(e) => {
                      if (!e.target.closest('button[data-select-trigger]')) {
                        if (isSelectionActive) {
                          toggleSelect(file._id, e);
                        } else {
                          handleOpenCarousel(index);
                        }
                      }
                    }}
                    className={`grid grid-cols-12 gap-4 px-4 py-2.5 items-center cursor-pointer transition-colors text-sm ${
                      isSelected
                        ? 'bg-blue-50/70 dark:bg-blue-950/20'
                        : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                    }`}
                  >
                    {/* Checkbox + Mini Thumbnail + Name */}
                    <div className="col-span-6 sm:col-span-5 flex items-center gap-3 min-w-0">
                      <button
                        data-select-trigger
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelect(file._id, e);
                        }}
                        className={`w-5 h-5 rounded flex items-center justify-center border transition-colors shrink-0 cursor-pointer ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'border-neutral-300 dark:border-neutral-700 hover:border-neutral-400'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]"/>}
                      </button>

                      {/* Mini Thumbnail Preview */}
                      <div className="w-10 h-10 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800 shrink-0 relative flex items-center justify-center border border-neutral-200/60 dark:border-neutral-700/50">
                        {isVideo ? (
                          <>
                            <video
                              src={file.s3Url || file.url}
                              preload="metadata"
                              muted
                              playsInline
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-black/25 flex items-center justify-center pointer-events-none">
                              <Film className="w-3.5 h-3.5 text-white drop-shadow"/>
                            </div>
                          </>
                        ) : (
                          <img
                            src={file.s3Url || file.url}
                            alt={file.name}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>

                      <span className="font-medium text-neutral-800 dark:text-neutral-200 truncate">
                        {file.name}
                      </span>
                    </div>

                    {/* Date Added */}
                    <div className="col-span-3 sm:col-span-3 hidden sm:block text-xs text-neutral-500 dark:text-neutral-400 truncate">
                      {file.createdAt ? new Date(file.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                    </div>

                    {/* File Size */}
                    <div className="col-span-3 sm:col-span-2 text-right sm:text-left text-xs text-neutral-500 dark:text-neutral-400">
                      {formatBytes(file.size)}
                    </div>

                    {/* Media Type */}
                    <div className="col-span-3 sm:col-span-2 text-right text-xs uppercase font-semibold text-neutral-400 tracking-wider">
                      {isVideo ? 'Video' : 'Image'}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={`grid ${gridClassMap[gridSize] || gridClassMap.md}`}>
              {visiblePhotos.map((item, index) => (
                <div
                  key={item._id}
                  onClick={() => isSelectionActive ? toggleSelect(item._id) : handleOpenCarousel(index)}
                  className={`group relative ${aspectMap[gridSize] || 'aspect-square'} rounded-xl overflow-hidden border cursor-pointer select-none transition-all duration-200 ${
                    selectedIds.includes(String(item._id))
                      ? 'ring-2 ring-blue-500 border-blue-500 shadow-md'
                      : 'border-neutral-200 dark:border-neutral-800/80 hover:border-neutral-300 dark:hover:border-neutral-700'
                  }`}
                >
                  {/* Checkmark Button (Top-Left) */}
                  <div
                    onClick={(e) => toggleSelect(item._id, e)}
                    className={`absolute top-2.5 left-2.5 z-20 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                      selectedIds.includes(String(item._id))
                        ? 'bg-blue-600 text-white shadow-sm'
                        : isSelectionActive
                          ? 'bg-black/40 border border-white/60 text-transparent hover:border-white'
                          : 'opacity-0 group-hover:opacity-100 bg-black/40 border border-white/60 text-transparent hover:border-white'
                    }`}
                  >
                    <Check className={`w-3.5 h-3.5 stroke-[3] ${selectedIds.includes(String(item._id)) ? 'text-white' : 'text-transparent'}`} />
                  </div>

                  {/* Video or Image Preview */}
                  {item.mimeType?.startsWith('video') ? (
                    <div className="relative w-full h-full bg-neutral-950 flex items-center justify-center">
                      <video
                        src={item.s3Url || item.url}
                        className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity pointer-events-none"
                        preload="metadata"
                        muted
                        playsInline
                      />
                      {/* Video Play Badge */}
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md flex items-center gap-1.5 text-[11px] font-medium text-white">
                        <Play className="w-3 h-3 fill-white" />
                        <span>Video</span>
                      </div>
                    </div>
                  ) : (
                    <img
                      src={item.s3Url || item.url}
                      alt={item.name}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  )}

                  {/* Hover Information Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2.5 flex flex-col justify-end pointer-events-none">
                    <p className="text-xs font-medium text-white truncate">{item.name}</p>
                    <p className="text-[10px] text-neutral-300">
                      {new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Infinite Scroll / Batch Windowing Sentinel */}
          {visibleCount < photos.length && (
            <div ref={observerTarget} className="w-full py-8 flex items-center justify-center text-xs text-neutral-400">
              <Loader2 className="w-4 h-4 animate-spin mr-2 text-blue-500" />
              <span>Loading more media ({visiblePhotos.length} of {photos.length})...</span>
            </div>
          )}
        </>
      )}

      {/* Floating Action Pill */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-full bg-neutral-900/90 dark:bg-neutral-800/90 backdrop-blur-md border border-neutral-700/60 shadow-2xl text-white select-none">
          
          {/* 1. Selection Count (Status indicator on the left) */}
          <span className="text-xs text-neutral-300 font-medium pl-1">
            {selectedIds.length} selected
          </span>

          {/* Vertical Divider */}
          <div className="h-4 w-[1px] bg-neutral-700" />

          {/* 2. Select All / Deselect All Action Button */}
          <button
            onClick={handleToggleSelectAll}
            className="text-xs font-medium px-2.5 py-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer text-white whitespace-nowrap"
          >
            {isAllSelected ? 'Deselect All' : `Select All (${photos.length})`}
          </button>

          {/* 3. Download Action Button */}
          <button
            onClick={handleBatchDownload}
            disabled={isDownloading}
            className="relative overflow-hidden flex items-center gap-2 text-xs font-medium px-3.5 py-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer text-white disabled:cursor-wait"
          >
            {/* Progress Bar Fill Background */}
            {isDownloading && (
              <div
                className="absolute inset-0 bg-blue-600/40 transition-all duration-150 ease-out"
                style={{ width: `${downloadProgress.percent}%` }}
              />
            )}

            <Download className={`w-3.5 h-3.5 relative z-10 ${isDownloading ? 'animate-bounce' : ''}`} />
            
            <span className="relative z-10 whitespace-nowrap font-mono">
              {isDownloading ? downloadProgress.text || 'Downloading...' : 'Download'}
            </span>
          </button>

          {/* 4. Delete Action Button */}
          <button
            onClick={() => setIsDeleteModalOpen(true)}
            disabled={isDeleting}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-red-600/90 hover:bg-red-600 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>

          {/* 5. Clear / Close Button */}
          <button
            onClick={() => setSelectedIds([])}
            className="p-1 rounded-full hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer ml-0.5"
            title="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Lightbox Carousel Modal */}
      {selectedCarouselIndex !== null && (
        <MediaCarouselModal
          items={photos}
          currentIndex={selectedCarouselIndex}
          onClose={handleCloseCarousel}
        />
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && (
        <DeleteConfirmModal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          onConfirm={handleConfirmBatchDelete}
          count={selectedIds.length}
          isDeleting={isDeleting}
        />
      )}
    </div>
  );
}
  