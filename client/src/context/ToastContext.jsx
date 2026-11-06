import React, { createContext, useContext, useState, useCallback } from 'react';
import { X } from 'lucide-react';

const ToastContext = createContext(null);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((messageOrType, typeOrMessage = 'success', options = {}) => {
    let message = messageOrType;
    let type = typeOrMessage;
    let opts = typeof options === 'object' ? options : {};

    if (typeof typeOrMessage === 'object' && typeOrMessage !== null) {
      opts = typeOrMessage;
      type = 'success';
    } else if (['success', 'error', 'info', 'warning'].includes(messageOrType) && typeof typeOrMessage === 'string') {
      type = messageOrType;
      message = typeOrMessage;
    }

    const id = opts.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const duration = opts.duration !== undefined ? opts.duration : 5000;
    const newToast = { id, message, type };

    setToasts((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      const trimmed = filtered.length >= 5 ? filtered.slice(1) : filtered;
      return [...trimmed, newToast];
    });

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  }, [removeToast]);

  const addCustomToast = useCallback((renderFn, options = {}) => {
    const id = options.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const duration = options.duration !== undefined ? options.duration : 6000;
    const newToast = { id, custom: renderFn, duration };

    setToasts((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      const trimmed = filtered.length >= 5 ? filtered.slice(1) : filtered;
      return [...trimmed, newToast];
    });

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
    return id;
  }, [removeToast]);

  const toastMethods = {
    show: addToast,
    success: (msg, opts) => addToast(msg, 'success', opts),
    error: (msg, opts) => addToast(msg, 'error', opts),
    info: (msg, opts) => addToast(msg, 'info', opts),
    warning: (msg, opts) => addToast(msg, 'warning', opts),
    loading: (msg, opts) => addToast(msg, 'info', opts),
    custom: addCustomToast,
    dismiss: removeToast,
    remove: removeToast,
  };

  return (
    <ToastContext.Provider value={toastMethods}>
      {children}

      {/* Stacked Toast Container: Positioned above floating action bar (bottom-20) */}
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[99999] flex flex-col gap-2 items-center pointer-events-none select-none w-full max-w-[96vw] sm:max-w-xl px-2">
        {toasts.map((t) => {
          if (t.custom) {
            return (
              <div key={t.id} className="pointer-events-auto w-full sm:w-auto flex justify-center">
                {typeof t.custom === 'function' ? t.custom({ id: t.id, dismiss: () => removeToast(t.id), visible: true }) : t.custom}
              </div>
            );
          }
          return (
            <div
              key={t.id}
              className="pointer-events-auto w-full sm:w-auto flex items-center justify-between gap-3 px-4 py-2.5 rounded-full text-xs sm:text-sm font-medium border shadow-2xl backdrop-blur-md transition-all duration-300 ease-out transform translate-y-0 opacity-100 scale-100 animate-in fade-in slide-in-from-bottom-2 bg-[#18181b]/95 text-zinc-200 border-zinc-800/80 shadow-black/40"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Status Dot */}
                {t.type === 'success' && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                )}
                {t.type === 'error' && (
                  <span className="w-2 h-2 rounded-full bg-rose-500 ring-4 ring-rose-500/20 shrink-0" />
                )}
                {t.type === 'warning' && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 ring-4 ring-amber-500/20 shrink-0" />
                )}
                {t.type === 'info' && (
                  <span className="w-2 h-2 rounded-full bg-blue-500 ring-4 ring-blue-500/20 shrink-0" />
                )}

                {/* Message */}
                <span className="text-left whitespace-normal break-words leading-snug">
                  {t.message}
                </span>
              </div>

              {/* Dismiss Button */}
              <button
                onClick={() => removeToast(t.id)}
                className="text-zinc-500 hover:text-zinc-300 text-xs sm:text-sm ml-1 transition-colors leading-none cursor-pointer p-0.5"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
};
