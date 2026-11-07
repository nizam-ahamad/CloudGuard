import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { Download, X } from 'lucide-react';
import { downloadSingleFileWithProgress, downloadBatchZipWithProgress } from '../utils/downloadHelper';
import { useToast } from './ToastContext';

const DownloadContext = createContext(null);

export const DownloadProvider = ({ children }) => {
  const [activeDownload, setActiveDownload] = useState(null);
  const abortFnRef = useRef(null);
  const toast = useToast();

  const cancelActiveDownload = useCallback(() => {
    if (abortFnRef.current) {
      abortFnRef.current();
      abortFnRef.current = null;
    }
    setActiveDownload(null);
  }, []);

  const startDownload = useCallback(async (items) => {
    if (!items || (Array.isArray(items) && items.length === 0)) return;

    const itemsArray = Array.isArray(items) ? items : [items];
    const isBatch = itemsArray.length > 1;

    setActiveDownload({
      name: isBatch ? `Batch Archive (${itemsArray.length} files)` : itemsArray[0].name,
      percent: 0,
      speed: '',
      text: 'Starting download...',
    });

    try {
      if (!isBatch) {
        return await downloadSingleFileWithProgress(
          itemsArray[0],
          (p) => setActiveDownload((prev) => (prev ? { ...prev, ...p } : null)),
          (cancelFn) => { abortFnRef.current = cancelFn; }
        );
      } else {
        return await downloadBatchZipWithProgress(
          itemsArray,
          (p) => setActiveDownload((prev) => (prev ? { ...prev, ...p } : null)),
          (cancelFn) => { abortFnRef.current = cancelFn; },
          (noticeMsg) => toast?.info?.(noticeMsg)
        );
      }
    } catch (err) {
      if (err.message !== 'DOWNLOAD_CANCELLED') {
        console.error('Download error:', err);
      }
      throw err;
    } finally {
      setActiveDownload(null);
      abortFnRef.current = null;
    }
  }, [toast]);

  // Backwards compatibility alias
  const triggerDownload = startDownload;

  return (
    <DownloadContext.Provider value={{ activeDownload, cancelActiveDownload, startDownload, triggerDownload }}>
      {children}
    </DownloadContext.Provider>
  );
};

export const useDownload = () => {
  const context = useContext(DownloadContext);
  return context || {
    activeDownload: null,
    cancelActiveDownload: () => {},
    startDownload: async () => {},
    triggerDownload: async () => {},
  };
};

/**
 * Header Download Button (Placed next to Theme Toggle)
 */
export const HeaderDownloadButton = () => {
  const { activeDownload, cancelActiveDownload } = useDownload();
  const [isOpen, setIsOpen] = useState(false);

  // Auto-close download dropdown if upload tray opens
  React.useEffect(() => {
    const handleUploadOpen = () => setIsOpen(false);
    window.addEventListener('cloudguard:upload-tray-opened', handleUploadOpen);
    return () => window.removeEventListener('cloudguard:upload-tray-opened', handleUploadOpen);
  }, []);

  // Keep dropdown open automatically while download is active if user opened it
  if (!activeDownload) return null;

  return (
    <div className="relative">
      <button
        onClick={() => {
          setIsOpen((prev) => {
            const next = !prev;
            if (next) {
              window.dispatchEvent(new CustomEvent('cloudguard:download-tray-opened'));
            }
            return next;
          });
        }}
        className="relative p-2 rounded-lg bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-blue-600 dark:text-blue-400 transition-colors cursor-pointer"
        title="View active download"
      >
        <Download className="w-5 h-5 animate-bounce" />
        <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white shadow-sm">
          {activeDownload.percent}%
        </span>
      </button>

      {/* Tray Dropdown Popover */}
      {isOpen && (
        <div className="fixed sm:absolute top-16 sm:top-full left-4 sm:left-auto right-4 sm:right-0 mt-2 sm:w-80 p-3.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl z-50 select-none animate-in fade-in zoom-in-95">
          <div className="flex items-start justify-between gap-3 mb-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-neutral-900 dark:text-white truncate">
                {activeDownload.name}
              </p>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                {activeDownload.speed ? `${activeDownload.speed} • ` : ''}
                {activeDownload.text}
              </p>
            </div>
            
            {/* Cancel Button */}
            <button
              onClick={() => {
                cancelActiveDownload();
                setIsOpen(false);
              }}
              className="p-1 rounded-md text-neutral-400 hover:text-rose-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer shrink-0"
              title="Cancel download"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-600 h-full transition-all duration-200 rounded-full"
              style={{ width: `${activeDownload.percent}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
