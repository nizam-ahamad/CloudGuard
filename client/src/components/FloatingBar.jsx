import React from 'react';
import { Download, Trash2, X, FolderInput } from 'lucide-react';

export default function CentralizedFloatingBar({
  selectedCount = 0,
  totalCount = 0,
  isAllSelected = false,
  onToggleSelectAll,
  onDownload,
  onDelete,
  onMove,
  onClear,
  isDownloading = false,
}) {
  if (selectedCount <= 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 sm:gap-3 px-3.5 sm:px-4 py-2 rounded-full bg-neutral-900/95 dark:bg-neutral-800/95 backdrop-blur-md border border-neutral-700/60 shadow-2xl text-white select-none max-w-[95vw] whitespace-nowrap animate-enter">
      {/* 1. Counter */}
      <span className="text-xs text-neutral-300 font-medium pl-1 whitespace-nowrap">
        {selectedCount} <span className="hidden sm:inline">selected</span>
      </span>

      {/* Vertical Divider */}
      <div className="h-4 w-[1px] bg-neutral-700 shrink-0" />

      {/* 2. Unified Select All - Pure text button with no background */}
      {onToggleSelectAll && (
        <button
          type="button"
          onClick={onToggleSelectAll}
          className="bg-transparent text-zinc-300 hover:text-white hover:bg-zinc-800/50 text-xs font-medium px-2 py-1 rounded-md transition-colors cursor-pointer whitespace-nowrap"
        >
          {isAllSelected ? (
            <>
              <span className="sm:hidden">Deselect</span>
              <span className="hidden sm:inline">Deselect All</span>
            </>
          ) : (
            <>
              <span className="sm:hidden">All</span>
              <span className="hidden sm:inline">Select All {totalCount ? `(${totalCount})` : ''}</span>
            </>
          )}
        </button>
      )}

      {/* 3. Move Action (if provided) */}
      {onMove && (
        <button
          type="button"
          onClick={onMove}
          className="bg-transparent text-zinc-300 hover:text-white hover:bg-zinc-800/50 flex items-center gap-1.5 text-xs font-medium px-2.5 sm:px-3 py-1.5 rounded-md transition-colors cursor-pointer text-white shrink-0"
          title="Move"
        >
          <FolderInput className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Move</span>
        </button>
      )}

      {/* 4. Download Action - Icon + text button with no background */}
      {onDownload && (
        <button
          type="button"
          onClick={onDownload}
          disabled={isDownloading}
          className="bg-transparent text-zinc-300 hover:text-white hover:bg-zinc-800/50 flex items-center gap-1.5 text-xs font-medium px-2.5 sm:px-3 py-1.5 rounded-md transition-colors cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
          title={isDownloading ? 'Downloading...' : 'Download'}
        >
          <Download className={`w-3.5 h-3.5 ${isDownloading ? 'animate-bounce text-blue-400' : ''}`} />
          <span className="hidden sm:inline">{isDownloading ? 'Downloading...' : 'Download'}</span>
        </button>
      )}

      {/* 5. Delete Action - Solid red button */}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="bg-red-600 hover:bg-red-500 text-white font-medium px-3.5 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 text-xs transition-all cursor-pointer whitespace-nowrap"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete</span>
        </button>
      )}

      {/* 6. Dismiss Icon Button */}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="p-1 rounded-full hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer ml-0.5 shrink-0"
          title="Clear selection"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export { CentralizedFloatingBar };

