import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Download, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { API_BASE_URL } from '../config';

const api = {
  get: (endpoint, config = {}) => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    return axios.get(`${API_BASE_URL}/api${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`, {
      ...config,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...config.headers
      }
    });
  }
};

export default function MediaCarouselModal({ items = [], currentIndex = 0, onClose }) {
  const [index, setIndex] = useState(currentIndex || 0);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    setIndex(currentIndex || 0);
  }, [currentIndex]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') {
        setIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        setIndex((prev) => Math.min(items.length - 1, prev + 1));
      } else if (e.key === 'Escape') {
        onClose?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [items.length, onClose]);

  if (!items || items.length === 0) return null;

  const currentItem = items[index];
  if (!currentItem) return null;

  const handleDownload = async () => {
    if (!currentItem?._id) return;
    try {
      setIsDownloading(true);
      // Fetch the attachment-presigned URL from backend
      const res = await api.get(`/files/${currentItem._id}/download`);
      if (res.data?.downloadUrl) {
        const link = document.createElement('a');
        link.href = res.data.downloadUrl;
        link.setAttribute('download', currentItem.name);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err) {
      console.error('Download error:', err);
      // Fallback: direct window location
      if (currentItem.s3Url || currentItem.url) {
        window.location.href = currentItem.s3Url || currentItem.url;
      }
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm select-none">
      {/* Top Header Bar */}
      <div className="absolute top-0 inset-x-0 h-16 px-6 flex items-center justify-between z-10 bg-gradient-to-b from-black/80 to-transparent text-white">
        <div>
          <p className="text-sm font-medium truncate max-w-sm sm:max-w-md">{currentItem.name}</p>
          <p className="text-xs text-neutral-400">{index + 1} of {items.length}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-50 cursor-pointer"
            title="Download"
          >
            <Download className={`w-4 h-4 ${isDownloading ? 'animate-bounce' : ''}`} />
          </button>
          <button 
            onClick={onClose} 
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5"/>
          </button>
        </div>
      </div>

      {/* Previous Arrow Button */}
      {index > 0 && (
        <button
          onClick={() => setIndex(prev => prev - 1)}
          className="absolute left-4 z-10 p-3 rounded-full bg-white/10 hover:bg-white/25 text-white backdrop-blur-md transition-all -translate-y-1/2 top-1/2 cursor-pointer"
          title="Previous"
        >
          <ChevronLeft className="w-6 h-6"/>
        </button>
      )}

      {/* Central Media Container */}
      <div className="max-w-[90vw] max-h-[85vh] flex items-center justify-center p-4">
        {currentItem.mimeType?.startsWith('video') ? (
          <video
            key={currentItem._id}
            src={currentItem.s3Url || currentItem.url}
            controls
            autoPlay
            className="max-w-full max-h-[80vh] rounded-lg shadow-2xl object-contain"
          />
        ) : (
          <img
            key={currentItem._id}
            src={currentItem.s3Url || currentItem.url}
            alt={currentItem.name}
            className="max-w-full max-h-[80vh] rounded-lg shadow-2xl object-contain animate-fade-in"
          />
        )}
      </div>

      {/* Next Arrow Button */}
      {index < items.length - 1 && (
        <button
          onClick={() => setIndex(prev => prev + 1)}
          className="absolute right-4 z-10 p-3 rounded-full bg-white/10 hover:bg-white/25 text-white backdrop-blur-md transition-all -translate-y-1/2 top-1/2 cursor-pointer"
          title="Next"
        >
          <ChevronRight className="w-6 h-6"/>
        </button>
      )}
    </div>
  );
}
