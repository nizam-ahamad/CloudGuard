import React, { useEffect } from 'react';
import { Trash2, X } from 'lucide-react';

export default function DeleteConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Permanently delete',
  isDeleting = false,
  count = 1
}) {
  // Close on Escape, confirm on Enter
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isDeleting) onClose();
      if (e.key === 'Enter' && !isDeleting) onConfirm();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDeleting, onClose, onConfirm]);

  if (!isOpen) return null;

  const resolvedTitle = title || `Permanently delete ${count === 1 ? 'item' : `${count} items`}?`;
  const resolvedDescription =
    description ||
    `Are you sure you want to permanently delete ${
      count > 1 ? `these ${count} items` : 'this item'
    }? This action will immediately remove the data from your storage.`;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none animate-in fade-in duration-150"
      onClick={() => !isDeleting && onClose()}
    >
      <div 
        className="relative w-full max-w-md rounded-2xl border p-6 shadow-2xl transform transition-all duration-200 ease-out scale-100 opacity-100 animate-in fade-in zoom-in-95
                   bg-white border-neutral-200 text-neutral-900
                   dark:bg-neutral-900 dark:border-neutral-800 dark:text-neutral-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: Danger Badge + Title + Close Button */}
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0
                          bg-red-50 text-red-600 border border-red-200/60
                          dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/40">
            <Trash2 className="w-5 h-5"/>
          </div>

          <div className="flex-1 min-w-0 pr-2">
            <h3 className="text-base font-semibold leading-6 text-neutral-900 dark:text-white">
              {resolvedTitle}
            </h3>
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
              {resolvedDescription}
            </p>
          </div>

          <button
            onClick={() => !isDeleting && onClose()}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4"/>
          </button>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 sm:gap-3 mt-6 w-full">
          <button
            type="button"
            disabled={isDeleting}
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium text-zinc-400 hover:text-zinc-200 rounded-xl hover:bg-zinc-800/60 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={onConfirm}
            className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-xl shadow-lg shadow-red-600/25 transition-all flex items-center justify-center gap-2"
          >
            {isDeleting ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Deleting...</span>
              </>
            ) : (
              <span>{confirmText}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

