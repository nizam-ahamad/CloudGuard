import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('cloudguard_cookie_consent');
    if (!consent) {
      // Delay display slightly for smooth UI entrance
      const timer = setTimeout(() => setVisible(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleConsent = (choice) => {
    localStorage.setItem('cloudguard_cookie_consent', choice);
    setVisible(false);

    if (choice === 'accepted') {
      // Dispatch custom event for optional analytics listeners
      window.dispatchEvent(new Event('cookie_consent_accepted'));
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:max-w-md z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-white dark:bg-[#141414] border border-neutral-200 dark:border-[#262626] rounded-xl p-5 shadow-2xl shadow-neutral-900/10 dark:shadow-black/80 text-left">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white tracking-tight flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-500 dark:bg-cyan-400"></span>
            Cookie & Privacy Preferences
          </h3>
        </div>
        <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed mb-4">
          We use strictly necessary cookies to authenticate your vault session and maintain zero-knowledge encryption. Non-essential telemetry is used only to improve platform stability. Read our{' '}
          <Link className="text-cyan-600 dark:text-cyan-400 hover:underline" to="/privacy">
            Privacy Policy
          </Link>.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleConsent('accepted')}
            className="flex-1 px-3 py-2 text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 dark:text-black dark:bg-white dark:hover:bg-neutral-200 rounded-lg transition-colors cursor-pointer"
          >
            Accept All
          </button>
          <button
            onClick={() => handleConsent('rejected')}
            className="flex-1 px-3 py-2 text-xs font-medium text-neutral-700 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 dark:text-neutral-300 dark:hover:text-white dark:bg-[#1f1f1f] dark:hover:bg-[#2a2a2a] dark:border-[#2a2a2a] rounded-lg transition-colors cursor-pointer"
          >
            Essential Only
          </button>
        </div>
      </div>
    </div>
  );
}

