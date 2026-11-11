import React from 'react';
import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="w-full border-t border-neutral-200 dark:border-neutral-900 bg-white/60 dark:bg-black/60 py-8 px-4 mt-auto">
      <div className="max-w-5xl mx-auto flex flex-col items-center justify-center text-center">
        {/* Navigation Links with Mobile-Safe Separators */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 sm:gap-x-5 gap-y-2 text-xs text-neutral-600 dark:text-neutral-400 mb-4 max-w-sm sm:max-w-none">
          <Link className="hover:text-neutral-900 dark:hover:text-white transition-colors" to="/pricing">Pricing</Link>
          <span className="hidden sm:inline text-neutral-300 dark:text-neutral-700">•</span>

          <Link className="hover:text-neutral-900 dark:hover:text-white transition-colors" to="/terms">Terms of Service</Link>
          <span className="hidden sm:inline text-neutral-300 dark:text-neutral-700">•</span>

          <Link className="hover:text-neutral-900 dark:hover:text-white transition-colors" to="/privacy">Privacy Policy</Link>
          <span className="hidden sm:inline text-neutral-300 dark:text-neutral-700">•</span>

          <Link className="hover:text-neutral-900 dark:hover:text-white transition-colors" to="/refund-policy">Refund Policy</Link>
          <span className="hidden sm:inline text-neutral-300 dark:text-neutral-700">•</span>

          <Link className="hover:text-neutral-900 dark:hover:text-white transition-colors" to="/contact">Contact Us</Link>
        </div>

        {/* Copyright */}
        <p className="text-[11px] sm:text-xs text-neutral-400 dark:text-neutral-500">
          © 2026 CloudGuard. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
