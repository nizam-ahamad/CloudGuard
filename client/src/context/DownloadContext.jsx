import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { Download, X } from 'lucide-react';
import { downloadSingleFileWithProgress, downloadBatchZipWithProgress, formatDownloadBytes } from '../utils/downloadHelper';
import { useToast } from './ToastContext';

const DownloadContext = createContext(null);

export const DownloadProvider = ({ children }) => {
  const [activeDownloads, setActiveDownloads] = useState([]); // Array of { id, fileId, name, size, percent, loaded, total, speed, text, startedAt }
  const [downloadHistory, setDownloadHistory] = useState([]); // Array of { id, name, size, completedAt, status }
  const abortControllersRef = useRef(new Map()); // Map<downloadId, cancelFn>
  const toast = useToast();

  const cancelDownload = useCallback((downloadId) => {
    const cancelFn = abortControllersRef.current.get(downloadId);
    if (cancelFn) {
      try {
        cancelFn();
      } catch (e) {
        console.warn('Error invoking download abort function:', e);
      }
      abortControllersRef.current.delete(downloadId);
    }
    setActiveDownloads((prev) => prev.filter((item) => item.id !== downloadId));
  }, []);

  const cancelActiveDownload = useCallback((targetId) => {
    if (targetId) {
      cancelDownload(targetId);
      return;
    }
    // If no ID passed, cancel all active downloads
    abortControllersRef.current.forEach((cancelFn) => {
      try {
        cancelFn();
      } catch (e) {}
    });
    abortControllersRef.current.clear();
    setActiveDownloads([]);
  }, [cancelDownload]);

  const startDownload = useCallback(async (items) => {
    if (!items || (Array.isArray(items) && items.length === 0)) return;

    const itemsArray = Array.isArray(items) ? items : [items];
    const isBatch = itemsArray.length > 1;
    const primaryItem = itemsArray[0] || {};

    // 1. Generate unique instance ID for this download execution
    const downloadId = `${primaryItem._id || primaryItem.id || 'file'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const displayName = isBatch ? `Batch Archive (${itemsArray.length} files)` : (primaryItem.name || 'File Download');

    // 2. Trigger notification via useToast
    toast?.info?.(`Downloading started: ${displayName}`);

    // 3. Prepend new download task to activeDownloads
    const newTask = {
      id: downloadId,
      fileId: primaryItem._id || primaryItem.id,
      name: displayName,
      size: primaryItem.size || 0,
      percent: 0,
      loaded: 0,
      total: primaryItem.size || 0,
      speed: '',
      text: 'Starting download...',
      startedAt: Date.now(),
    };
    setActiveDownloads((prev) => [newTask, ...prev]);

    // 4. Isolated Progress Updates callback
    const onProgress = (metrics) => {
      setActiveDownloads((prev) =>
        prev.map((item) =>
          item.id === downloadId
            ? {
                ...item,
                percent: metrics.percent !== undefined ? metrics.percent : item.percent,
                loaded: metrics.loaded !== undefined ? metrics.loaded : item.loaded,
                total: metrics.total !== undefined ? metrics.total : item.total,
                speed: metrics.speed !== undefined ? metrics.speed : item.speed,
                text: metrics.text !== undefined ? metrics.text : item.text,
              }
            : item
        )
      );
    };

    try {
      let result;
      if (!isBatch) {
        result = await downloadSingleFileWithProgress(
          primaryItem,
          onProgress,
          (cancelFn) => {
            abortControllersRef.current.set(downloadId, cancelFn);
          }
        );
      } else {
        result = await downloadBatchZipWithProgress(
          itemsArray,
          onProgress,
          (cancelFn) => {
            abortControllersRef.current.set(downloadId, cancelFn);
          },
          (noticeMsg) => toast?.info?.(noticeMsg)
        );
      }

      // 5. Push to download history on completion
      setDownloadHistory((prev) => [
        {
          id: downloadId,
          name: displayName,
          size: primaryItem.size || 0,
          completedAt: Date.now(),
          status: 'completed',
        },
        ...prev.slice(0, 9),
      ]);

      return result;
    } catch (err) {
      if (err.message !== 'DOWNLOAD_CANCELLED') {
        console.error('Download error:', err);
      }
      throw err;
    } finally {
      // 6. Remove completed/cancelled item from activeDownloads; other concurrent downloads remain intact
      abortControllersRef.current.delete(downloadId);
      setActiveDownloads((prev) => prev.filter((item) => item.id !== downloadId));
    }
  }, [toast]);

  // Backwards compatibility alias
  const triggerDownload = startDownload;

  return (
    <DownloadContext.Provider
      value={{
        activeDownload: activeDownloads[0] || null,
        activeDownloads,
        downloadHistory,
        cancelActiveDownload,
        cancelDownload,
        startDownload,
        triggerDownload,
        clearHistory: () => setDownloadHistory([]),
      }}
    >
      {children}
    </DownloadContext.Provider>
  );
};

export const useDownload = () => {
  const context = useContext(DownloadContext);
  return context || {
    activeDownload: null,
    activeDownloads: [],
    downloadHistory: [],
    cancelActiveDownload: () => {},
    cancelDownload: () => {},
    startDownload: async () => {},
    triggerDownload: async () => {},
    clearHistory: () => {},
  };
};

/**
 * Header Download Button (Placed next to Theme Toggle)
 * Displays concurrent active downloads and recent history popover tray
 */
export const HeaderDownloadButton = () => {
  const { activeDownloads, downloadHistory, cancelDownload, clearHistory } = useDownload();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const hasActive = activeDownloads.length > 0;
  const hasHistory = downloadHistory.length > 0;

  // Close when upload tray opens or global close is dispatched
  useEffect(() => {
    const handleClose = () => setIsOpen(false);
    window.addEventListener('cloudguard:upload-tray-opened', handleClose);
    window.addEventListener('cloudguard:close-all-trays', handleClose);
    return () => {
      window.removeEventListener('cloudguard:upload-tray-opened', handleClose);
      window.removeEventListener('cloudguard:close-all-trays', handleClose);
    };
  }, []);

  // Click outside listener
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const toggleOpen = (e) => {
    e.stopPropagation();
    setIsOpen((prev) => {
      const nextState = !prev;
      if (nextState) {
        // Explicitly close upload tray when this opens
        window.dispatchEvent(new CustomEvent('cloudguard:download-tray-opened'));
      }
      return nextState;
    });
  };

  // Only render if there is an active download or completed history
  if (!hasActive && !hasHistory) return null;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={toggleOpen}
        title="View downloads"
        className="relative p-2 rounded-lg bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-blue-600 dark:text-blue-400 transition-colors cursor-pointer"
      >
        <Download className={`w-5 h-5 ${hasActive ? 'animate-bounce' : ''}`} />
        {hasActive && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white shadow-sm">
            {activeDownloads.length > 1 ? activeDownloads.length : `${activeDownloads[0].percent}%`}
          </span>
        )}
        {!hasActive && hasHistory && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white shadow-sm">
            ✓
          </span>
        )}
      </button>

      {/* Download Dropdown Tray */}
      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed left-3 right-3 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2.5 sm:w-88 md:w-96 p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl z-50 select-none max-h-[85vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800 shrink-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-800 dark:text-neutral-200">
                Downloads
              </h3>
              {hasActive && (
                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-full border border-blue-200 dark:border-blue-800/60">
                  {activeDownloads.length} active
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-y-auto overflow-x-hidden flex-1 py-2 divide-y divide-neutral-100 dark:divide-neutral-800/60">
            {/* Active Downloads List */}
            {hasActive && (
              <div className="space-y-3 pb-2">
                {activeDownloads.map((item) => {
                  const loadedStr = formatDownloadBytes(item.loaded || 0);
                  const totalStr = formatDownloadBytes(item.total || item.size || 0);
                  return (
                    <div
                      key={item.id}
                      className="p-2.5 rounded-xl bg-neutral-50/80 dark:bg-neutral-800/50 border border-neutral-100 dark:border-neutral-800 transition-all"
                    >
                      <div className="flex items-start justify-between gap-2.5 mb-1.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-neutral-900 dark:text-white truncate" title={item.name}>
                            {item.name}
                          </p>
                          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 flex items-center gap-1.5">
                            {item.speed && (
                              <span className="font-mono text-blue-600 dark:text-blue-400 font-medium">
                                {item.speed}
                              </span>
                            )}
                            {item.speed && <span className="opacity-40">•</span>}
                            <span>
                              {item.total > 0 ? `${loadedStr} / ${totalStr} (${item.percent}%)` : (item.text || 'Downloading...')}
                            </span>
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => cancelDownload(item.id)}
                          className="p-1 rounded-md text-neutral-400 hover:text-rose-500 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60 transition-colors cursor-pointer shrink-0"
                          title="Cancel download"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Individual progress bar */}
                      <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-blue-600 dark:bg-blue-500 h-full transition-all duration-150 rounded-full"
                          style={{ width: `${Math.min(100, Math.max(0, item.percent))}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Completed Downloads History */}
            {hasHistory && (
              <div className="pt-2">
                <div className="flex items-center justify-between py-1 mb-1.5">
                  <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                    Recent
                  </span>
                  <button
                    type="button"
                    onClick={clearHistory}
                    className="text-[11px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
                <div className="space-y-1.5">
                  {downloadHistory.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 text-[10px] shrink-0 font-bold">
                          ✓
                        </span>
                        <span className="truncate text-neutral-700 dark:text-neutral-300 text-[11px]" title={item.name}>
                          {item.name}
                        </span>
                      </div>
                      <span className="text-[10px] text-neutral-400 dark:text-neutral-500 shrink-0">
                        {item.size ? formatDownloadBytes(item.size) : 'Completed'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
