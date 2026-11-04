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
  Loader2
} from 'lucide-react';
import MediaCarouselModal from '../components/MediaCarouselModal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { API_BASE_URL } from '../config';

const INITIAL_BATCH = 40;
const BATCH_SIZE = 40;

// Module-level cache (persists in memory across component unmounts during the session)
let photosMemoryCache = null;
let lastFetchTime = 0;

export const invalidatePhotosCache = () => {
  photosMemoryCache = null;
  lastFetchTime = 0;
};

export default function PhotosView({ token: propToken }) {
  // 1. Stale-While-Revalidate: Immediate render from cache with 0ms delay
  const [photos, setPhotos] = useState(() => photosMemoryCache || []);
  const [loading, setLoading] = useState(!photosMemoryCache);
  const [error, setError] = useState(null);
  const [selectedCarouselIndex, setSelectedCarouselIndex] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH);
  const observerTarget = useRef(null);

  const token = propToken || localStorage.getItem('token') || sessionStorage.getItem('token');
  const isSelectionActive = Array.isArray(selectedIds) && selectedIds.length > 0;

  const fetchPhotos = useCallback(async (forceRefresh = false) => {
    if (!token) {
      setLoading(false);
      return;
    }

    // If cache is null (initial load, post-upload, or post-logout), show loader
    if (!photosMemoryCache || forceRefresh) {
      setLoading(true);
    }
    setError(null);

    try {
      // Background revalidation
      const response = await axios.get(`${API_BASE_URL}/api/files/photos`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const media = response.data?.files || (Array.isArray(response.data) ? response.data : []);

      // Check if data has changed compared to cached snapshot
      const hasChanged = !photosMemoryCache ||
        media.length !== photosMemoryCache.length ||
        media.some((item, i) => {
          const prev = photosMemoryCache[i];
          return !prev || prev._id !== item._id || prev.s3Url !== item.s3Url || prev.name !== item.name;
        });

      if (hasChanged) {
        setPhotos(media);
      }

      // Update in-memory session cache & timestamp
      photosMemoryCache = media;
      lastFetchTime = Date.now();
    } catch (err) {
      console.error('Error fetching photos:', err);
      // Only display error if no cached data is already visible
      if (!photosMemoryCache || photosMemoryCache.length === 0) {
        setError(err.response?.data?.message || 'Failed to load media assets');
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

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
    try {
      setIsDeleting(true);
      await axios.post(`${API_BASE_URL}/api/files/bulk-delete`, {
        fileIds: selectedIds
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const updated = photos.filter(p => !selectedIds.includes(p._id));
      photosMemoryCache = updated; // Keep memory cache in sync
      setPhotos(updated);
      clearSelection();
      setIsDeleteModalOpen(false);
    } catch (err) {
      console.error('Failed to delete media items:', err);
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
    const selectedPhotos = photos.filter(p => selectedIds.includes(p._id));
    if (selectedPhotos.length === 0) return;
    setIsBatchDownloading(true);
    try {
      for (const item of selectedPhotos) {
        try {
          const res = await axios.get(`${API_BASE_URL}/api/files/${item._id}/download`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          });
          if (res.data?.downloadUrl) {
            const link = document.createElement('a');
            link.href = res.data.downloadUrl;
            link.setAttribute('download', item.name);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            await new Promise(r => setTimeout(r, 250));
            continue;
          }
        } catch (err) {
          // fallback to direct/blob download below
        }

        const fileUrl = item.s3Url || item.url;
        if (!fileUrl) continue;
        try {
          const response = await fetch(fileUrl);
          const blob = await response.blob();
          const blobUrl = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = item.name || 'download';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(blobUrl);
          await new Promise(r => setTimeout(r, 250));
        } catch (downloadErr) {
          console.error('Download error for item:', item.name, downloadErr);
          window.open(fileUrl, '_blank');
        }
      }
    } finally {
      setIsBatchDownloading(false);
    }
  };

  return (
    <div className="w-full pb-20">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-1">
        <h2 className="text-xl sm:text-2xl font-bold text-neutral-900 dark:text-[#e3e3e3]">
          Photos & Media
        </h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {loading ? 'Loading media...' : `${photos.length} item${photos.length === 1 ? '' : 's'}`}
        </p>
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

      {/* Responsive Media Grid */}
      {!loading && photos.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
            {visiblePhotos.map((item, index) => (
              <div
                key={item._id}
                onClick={() => isSelectionActive ? toggleSelect(item._id) : handleOpenCarousel(index)}
                className={`group relative aspect-square rounded-xl overflow-hidden border cursor-pointer select-none transition-all duration-200 ${
                  selectedIds.includes(item._id)
                    ? 'ring-2 ring-blue-500 border-blue-500 shadow-md'
                    : 'border-neutral-200 dark:border-neutral-800/80 hover:border-neutral-300 dark:hover:border-neutral-700'
                }`}
              >
                {/* Checkmark Button (Top-Left) */}
                <div
                  onClick={(e) => toggleSelect(item._id, e)}
                  className={`absolute top-2.5 left-2.5 z-20 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                    selectedIds.includes(item._id)
                      ? 'bg-blue-600 text-white shadow-sm'
                      : isSelectionActive
                        ? 'bg-black/40 border border-white/60 text-transparent hover:border-white'
                        : 'opacity-0 group-hover:opacity-100 bg-black/40 border border-white/60 text-transparent hover:border-white'
                  }`}
                >
                  <Check className={`w-3.5 h-3.5 stroke-[3] ${selectedIds.includes(item._id) ? 'text-white' : 'text-transparent'}`} />
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

          {/* Infinite Scroll / Batch Windowing Sentinel */}
          {visibleCount < photos.length && (
            <div ref={observerTarget} className="w-full py-8 flex items-center justify-center text-xs text-neutral-400">
              <Loader2 className="w-4 h-4 animate-spin mr-2 text-blue-500" />
              <span>Loading more media ({visiblePhotos.length} of {photos.length})...</span>
            </div>
          )}
        </>
      )}

      {/* Floating Minimalist Action Bar */}
      {isSelectionActive && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-neutral-900/95 text-white border border-neutral-800 shadow-2xl backdrop-blur-md">
          <span className="text-xs font-semibold text-neutral-300 pl-1">
            {selectedIds.length} selected
          </span>
          <div className="w-px h-4 bg-neutral-700" />

          <button
            onClick={handleBatchDownload}
            disabled={isBatchDownloading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-neutral-800 hover:bg-neutral-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Download className={`w-3.5 h-3.5 ${isBatchDownloading ? 'animate-bounce' : ''}`} />
            <span>{isBatchDownloading ? 'Downloading...' : 'Download'}</span>
          </button>

          <button
            onClick={handlePromptDelete}
            disabled={isDeleting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{isDeleting ? 'Deleting...' : 'Delete'}</span>
          </button>

          <button
            onClick={clearSelection}
            className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors cursor-pointer"
            title="Cancel"
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
  