import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Play, Image as ImageIcon, Download, X, Loader2 } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { API_BASE_URL } from '../config';

// Compatibility exports so caching invocations across other components remain fully intact
export const invalidatePhotosCache = () => {};
export const fetchPhotos = async () => [];
export const updatePhotosCacheWithNewFile = () => {};
export const removePhotosFromCache = () => {};

export default function PhotosView() {
  const [mediaItems, setMediaItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewItem, setPreviewItem] = useState(null);
  const [fullImageUrl, setFullImageUrl] = useState(null);
  const [loadingFullImage, setLoadingFullImage] = useState(false);

  const toastCtx = useToast();
  const toast = {
    error: (msg) => (toastCtx?.error ? toastCtx.error(msg) : console.error(msg)),
    success: (msg) => (toastCtx?.success ? toastCtx.success(msg) : console.log(msg)),
  };

  useEffect(() => {
    fetchMedia();
    const handleUpdate = () => fetchMedia();
    window.addEventListener('cloudguard:files-updated', handleUpdate);
    return () => window.removeEventListener('cloudguard:files-updated', handleUpdate);
  }, []);

  const fetchMedia = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_BASE_URL || ''}/api/photos`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const list = Array.isArray(res.data) ? res.data : res.data?.photos || [];
      setMediaItems(list);

      // Backfill missing thumbnails for legacy photos in the background
      backfillMissingThumbnails(list);
    } catch (err) {
      console.error('Failed to load photos:', err);
    } finally {
      setLoading(false);
    }
  };

  // One-time client background generator for older images missing a thumbnail
  const backfillMissingThumbnails = async (items) => {
    const missing = items.filter((i) => !i.thumbnail && i.mimeType?.startsWith('image/'));
    if (missing.length === 0) return;

    const token = localStorage.getItem('token');
    for (const item of missing.slice(0, 10)) {
      try {
        const accessRes = await axios.get(`${API_BASE_URL || ''}/api/files/${item._id}/access`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const url = accessRes.data?.accessUrl || accessRes.data?.url;
        if (!url) continue;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = async () => {
          const canvas = document.createElement('canvas');
          const maxDim = 320;
          let w = img.width;
          let h = img.height;
          if (w > h) {
            if (w > maxDim) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            }
          } else {
            if (h > maxDim) {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const thumbData = canvas.toDataURL('image/webp', 0.65);

          await axios.post(
            `${API_BASE_URL || ''}/api/files/${item._id}/thumbnail`,
            { thumbnail: thumbData },
            { headers: { Authorization: `Bearer ${token}` } }
          );

          setMediaItems((prev) =>
            prev.map((m) => (m._id === item._id ? { ...m, thumbnail: thumbData } : m))
          );
        };
        img.src = url;
      } catch (e) {
        console.warn('Backfill skipped for:', item.name);
      }
    }
  };

  // Open Lightbox and load full high-res asset ONLY on user click
  const openPreview = async (item) => {
    setPreviewItem(item);
    setFullImageUrl(null);
    setLoadingFullImage(true);

    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_BASE_URL || ''}/api/files/${item._id}/access`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const url = res.data?.accessUrl || res.data?.url;
      setFullImageUrl(url);
    } catch (err) {
      toast.error('Failed to load high-resolution image');
    } finally {
      setLoadingFullImage(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-zinc-100">Photos & Media</h1>
          <p className="text-sm text-neutral-500 dark:text-zinc-400 mt-1">
            {mediaItems.length} {mediaItems.length === 1 ? 'Item' : 'Items'} across your vault
          </p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {[...Array(10)].map((_, i) => (
            <div
              key={i}
              className="aspect-square bg-neutral-100 dark:bg-zinc-900 rounded-xl animate-pulse border border-neutral-200 dark:border-zinc-800/60"
            />
          ))}
        </div>
      ) : mediaItems.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-neutral-300 dark:border-zinc-800 rounded-2xl">
          <ImageIcon className="w-12 h-12 text-neutral-400 dark:text-zinc-600 mx-auto mb-3" />
          <p className="text-neutral-500 dark:text-zinc-400 text-sm">No photos or videos found in your vault</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {mediaItems.map((item) => {
            const isVideo = item.mimeType?.startsWith('video/') || item.mediaType === 'video';

            return (
              <div
                key={item._id}
                onClick={() => openPreview(item)}
                className="group relative aspect-square bg-neutral-100 dark:bg-zinc-900 rounded-xl overflow-hidden border border-neutral-200 dark:border-zinc-800/80 hover:border-neutral-300 dark:hover:border-zinc-700 cursor-pointer transition-all shadow-sm hover:shadow-md"
              >
                {/* 10KB - 15KB Thumbnail First */}
                {item.thumbnail ? (
                  <img
                    src={item.thumbnail}
                    alt={item.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-neutral-200 dark:bg-zinc-800">
                    <ImageIcon className="w-8 h-8 text-neutral-400 dark:text-zinc-600" />
                  </div>
                )}

                {isVideo && (
                  <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-md px-2 py-0.5 rounded-md flex items-center gap-1 text-[11px] font-medium text-white border border-white/10">
                    <Play className="w-3 h-3 fill-white" /> Video
                  </div>
                )}

                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2.5">
                  <span className="text-xs text-white truncate w-full font-medium">
                    {item.originalName || item.name}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox Preview Modal: Fetches Full Original Only on Click */}
      {previewItem && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setPreviewItem(null)}
        >
          <button
            onClick={() => setPreviewItem(null)}
            type="button"
            className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-white rounded-full bg-zinc-800/80 transition-colors cursor-pointer z-10"
          >
            <X className="w-6 h-6" />
          </button>

          <div
            className="max-w-4xl max-h-[85vh] w-full flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {loadingFullImage ? (
              <div className="relative flex items-center justify-center max-h-[75vh] w-full min-h-[300px]">
                {previewItem.thumbnail && (
                  <img
                    src={previewItem.thumbnail}
                    alt={previewItem.name}
                    className="max-h-[75vh] max-w-full object-contain rounded-lg filter blur-sm opacity-60"
                  />
                )}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                  <span className="text-xs font-medium">Loading high resolution...</span>
                </div>
              </div>
            ) : previewItem.mimeType?.startsWith('video/') ? (
              <video
                src={fullImageUrl}
                controls
                autoPlay
                className="max-h-[75vh] w-auto rounded-lg shadow-2xl"
              />
            ) : (
              <img
                src={fullImageUrl || previewItem.thumbnail}
                alt={previewItem.name}
                className="max-h-[75vh] max-w-full object-contain rounded-lg shadow-2xl"
              />
            )}

            <div className="mt-4 flex items-center justify-between w-full text-zinc-300 px-2">
              <span className="text-sm font-medium truncate max-w-md">
                {previewItem.originalName || previewItem.name}
              </span>
              {fullImageUrl && (
                <a
                  href={fullImageUrl}
                  download={previewItem.name}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" /> Download Original
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
