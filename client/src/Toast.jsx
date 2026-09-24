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
      className={`bg-surface-container-highest border border-outline-variant rounded-xl shadow-xl p-4 flex items-center gap-3 min-w-[300px] transition-all duration-300 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      {type === 'success' ? (
        <div className="w-8 h-8 rounded-full bg-[#dcfce7] flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[#166534] text-sm">check</span>
        </div>
      ) : (
        <div className="w-8 h-8 rounded-full bg-[#fef2f2] flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-error text-sm">warning</span>
        </div>
      )}
      <p className="font-body-md text-on-surface flex-1">{message}</p>
      <button 
        onClick={handleClose}
        className="text-on-surface-variant hover:text-on-surface transition-colors p-1"
      >
        <span className="material-symbols-outlined text-sm">close</span>
      </button>
    </div>
  );
}
