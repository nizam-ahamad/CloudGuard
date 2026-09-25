import React, { useState, useEffect } from 'react';

export default function Toast({ id, type, message, onRemove }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const enterTimer = requestAnimationFrame(() => {
      setIsVisible(true);
    });

    const exitTimer = setTimeout(() => {
      handleClose();
    }, 4700);

    return () => {
      cancelAnimationFrame(enterTimer);
      clearTimeout(exitTimer);
    };
  }, []);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      onRemove(id);
    }, 300);
  };

  return (
    <div 
      className={`bg-white dark:bg-[#1e1f20] border border-gray-200 dark:border-[#282a2c] rounded-xl shadow-xl p-4 flex items-center gap-3 min-w-[300px] transition-all duration-300 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      {type === 'success' ? (
        <div className="w-8 h-8 rounded-full bg-[#dcfce7] dark:bg-[#282a2c] flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[#166534] dark:text-[#c4c7c5] text-sm">check</span>
        </div>
      ) : (
        <div className="w-8 h-8 rounded-full bg-[#fef2f2] dark:bg-[#282a2c] flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-red-600 dark:text-red-400 text-sm">warning</span>
        </div>
      )}
      <p className="font-body-md text-slate-900 dark:text-[#e3e3e3] flex-1">{message}</p>
      <button 
        onClick={handleClose}
        className="text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors p-1"
      >
        <span className="material-symbols-outlined text-sm">close</span>
      </button>
    </div>
  );
}
