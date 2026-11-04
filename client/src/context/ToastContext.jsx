import React, { createContext, useContext, useState, useCallback } from 'react';
import { X } from 'lucide-react';

const ToastContext = createContext(null);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((messageOrType, typeOrMessage = 'success') => {
    let message = messageOrType;
    let type = typeOrMessage;

    // Handle both addToast(msg, type) and addToast(type, msg)
    if (['success', 'error', 'info', 'warning'].includes(messageOrType) && typeof typeOrMessage === 'string') {
      type = messageOrType;
      message = typeOrMessage;
    }

    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newToast = { id, message, type };

    setToasts((prev) => {
      // Keep maximum 5 toasts visible at once to avoid covering the whole screen
      const trimmed = prev.length >= 5 ? prev.slice(1) : prev;
      return [...trimmed, newToast];
    });

    // Each toast lives for exactly 5 seconds
    setTimeout(() => {
      removeToast(id);
    }, 5000);
  }, [removeToast]);

  const toastMethods = {
    show: addToast,
    success: (msg) => addToast(msg, 'success'),
    error: (msg) => addToast(msg, 'error'),
    info: (msg) => addToast(msg, 'info'),
    warning: (msg) => addToast(msg, 'warning'),
    remove: removeToast,
  };

  return (
    <ToastContext.Provider value={toastMethods}>
      {children}

      {/* Stacked Toast Container: Positioned above floating action bar (bottom-20) */}
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none select-none w-full max-w-[calc(100vw-2rem)] sm:max-w-md px-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto w-full sm:w-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-xs font-medium border shadow-2xl backdrop-blur-md transition-all duration-300 ease-out transform translate-y-0 opacity-100 scale-100 animate-in fade-in slide-in-from-bottom-2 bg-white/95 text-neutral-900 border-neutral-200/80 shadow-neutral-900/10 dark:bg-neutral-900/95 dark:text-white dark:border-neutral-700/60 dark:shadow-black/40"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Status Dot */}
              {t.type === 'success' && (
                <div className="w-2 h-2 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20 shrink-0" />
              )}
              {t.type === 'error' && (
                <div className="w-2 h-2 rounded-full bg-rose-500 ring-4 ring-rose-500/20 shrink-0" />
              )}
              {t.type === 'warning' && (
                <div className="w-2 h-2 rounded-full bg-amber-500 ring-4 ring-amber-500/20 shrink-0" />
              )}
              {t.type === 'info' && (
                <div className="w-2 h-2 rounded-full bg-blue-500 ring-4 ring-blue-500/20 shrink-0" />
              )}

              {/* Message: Full natural wrapping for mobile & desktop */}
              <span className="text-left whitespace-normal break-words leading-snug">
                {t.message}
              </span>
            </div>

            {/* Dismiss Button */}
            <button
              onClick={() => removeToast(t.id)}
              className="text-neutral-400 hover:text-neutral-700 dark:hover:text-white transition-colors cursor-pointer shrink-0 ml-1 p-0.5"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5"/>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
};
