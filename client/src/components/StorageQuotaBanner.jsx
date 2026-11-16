import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { AlertTriangle, AlertCircle, ShieldAlert, X, ArrowUpRight } from 'lucide-react';
import { API_BASE_URL } from '../config';

function formatBytes(bytes, decimals = 1) {
  const n = Number(bytes);
  if (!n || isNaN(n) || n <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  const safeI = Math.min(i, sizes.length - 1);
  return `${parseFloat((n / Math.pow(k, safeI)).toFixed(decimals))} ${sizes[safeI]}`;
}

export default function StorageQuotaBanner({
  storageUsed: propStorageUsed,
  storageLimit: propStorageLimit,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const [liveUsed, setLiveUsed] = useState(propStorageUsed);
  const [liveLimit, setLiveLimit] = useState(propStorageLimit);
  const [dismissedKey, setDismissedKey] = useState(null);

  // Sync with incoming props if provided
  useEffect(() => {
    if (propStorageUsed !== undefined) setLiveUsed(propStorageUsed);
    if (propStorageLimit !== undefined) setLiveLimit(propStorageLimit);
  }, [propStorageUsed, propStorageLimit]);

  // Fetch or refresh storage stats on mount and on custom events
  const refreshStats = useCallback(async () => {
    try {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      if (!token) return;
      const res = await axios.get(`${API_BASE_URL}/api/storage-stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data) {
        const used = res.data.storageUsed || res.data.usedBytes || res.data.used || 0;
        const limit = res.data.storageLimit || res.data.totalLimitBytes || res.data.limit || 5368709120;
        setLiveUsed(used);
        setLiveLimit(limit);
      }
    } catch {
      // Ignore background fetch error
    }
  }, []);

  useEffect(() => {
    if (propStorageUsed === undefined || propStorageLimit === undefined) {
      refreshStats();
    }

    const handleStorageUpdate = () => {
      refreshStats();
    };

    window.addEventListener('cloudguard:storage-updated', handleStorageUpdate);
    window.addEventListener('cloudguard:files-updated', handleStorageUpdate);
    return () => {
      window.removeEventListener('cloudguard:storage-updated', handleStorageUpdate);
      window.removeEventListener('cloudguard:files-updated', handleStorageUpdate);
    };
  }, [refreshStats, propStorageUsed, propStorageLimit]);

  // Hide on pricing, monitor, or admin routes
  if (
    location.pathname.startsWith('/pricing') ||
    location.pathname.startsWith('/monitor') ||
    location.pathname.startsWith('/admin')
  ) {
    return null;
  }

  const used = Number(liveUsed) || 0;
  const limit = Number(liveLimit) || 0;

  if (limit <= 0) return null;

  const pct = Math.min(100, (used / limit) * 100);
  if (pct < 80) return null;

  const formattedUsed = formatBytes(used);
  const formattedLimit = formatBytes(limit, 0);
  const pctFloor = Math.floor(pct);

  // Determine Tier
  let tier = null;
  if (pct >= 100) {
    tier = {
      level: 100,
      dismissible: false,
      storageKey: null,
      containerClasses:
        'bg-red-50 border-red-200 text-red-950 dark:bg-red-950/40 dark:border-red-800/60 dark:text-red-100',
      iconClasses: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 border-red-200 dark:border-red-800/50',
      barColor: 'bg-red-500',
      ctaColor: 'bg-red-600 hover:bg-red-500 text-white shadow-red-600/20',
      Icon: ShieldAlert,
      message: `Storage full (${formattedUsed} of ${formattedLimit}). New uploads are paused — upgrade your plan or empty your Bin.`,
    };
  } else if (pct >= 95) {
    tier = {
      level: 95,
      dismissible: true,
      storageKey: 'cg_quota_banner_dismissed_95',
      containerClasses:
        'bg-orange-50 border-orange-200 text-orange-950 dark:bg-orange-950/40 dark:border-orange-800/60 dark:text-orange-100',
      iconClasses: 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/40 border-orange-200 dark:border-orange-800/50',
      barColor: 'bg-orange-500',
      ctaColor: 'bg-orange-600 hover:bg-orange-500 text-white shadow-orange-600/20',
      Icon: AlertCircle,
      message: `Running low on space — ${pctFloor}% (${formattedUsed} of ${formattedLimit}) used. Uploads will pause when full.`,
    };
  } else {
    // 80% <= pct < 95%
    tier = {
      level: 80,
      dismissible: true,
      storageKey: 'cg_quota_banner_dismissed_80',
      containerClasses:
        'bg-amber-50 border-amber-200 text-amber-950 dark:bg-amber-950/35 dark:border-amber-800/60 dark:text-amber-100',
      iconClasses: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 border-amber-200 dark:border-amber-800/50',
      barColor: 'bg-amber-500',
      ctaColor: 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/20',
      Icon: AlertTriangle,
      message: `You've used ${pctFloor}% (${formattedUsed} of ${formattedLimit}) of your CloudGuard storage. Upgrade your vault before space runs low.`,
    };
  }

  // Check if dismissed in sessionStorage for current tier
  if (tier.dismissible && tier.storageKey) {
    if (sessionStorage.getItem(tier.storageKey) === 'true' || dismissedKey === tier.storageKey) {
      return null;
    }
  }

  const handleDismiss = () => {
    if (tier.storageKey) {
      try {
        sessionStorage.setItem(tier.storageKey, 'true');
      } catch {}
      setDismissedKey(tier.storageKey);
    }
  };

  const IconComponent = tier.Icon;

  return (
    <div
      role="alert"
      className={`w-full rounded-2xl p-3.5 sm:p-4 mb-6 border transition-all duration-200 select-none shadow-sm ${tier.containerClasses}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        {/* Left Side: Icon + Message + Inline Progress Bar */}
        <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${tier.iconClasses}`}
          >
            <IconComponent className="w-5 h-5 stroke-[2]" />
          </div>

          <div className="flex-1 min-w-0 space-y-1.5 sm:space-y-0 sm:flex sm:items-center sm:gap-3">
            <p className="text-xs sm:text-sm font-medium leading-relaxed">
              {tier.message}
            </p>

            {/* Inline Mini Progress Bar */}
            <div className="flex items-center gap-2 shrink-0 pt-1 sm:pt-0">
              <div className="w-20 sm:w-28 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden shrink-0">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${tier.barColor}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <span className="text-[11px] font-bold font-mono opacity-80 shrink-0">
                {pctFloor}%
              </span>
            </div>
          </div>
        </div>

        {/* Right Side: CTA Button + Dismiss Button */}
        <div className="flex items-center justify-end gap-2 shrink-0 self-end sm:self-center w-full sm:w-auto pt-1 sm:pt-0 border-t border-black/5 dark:border-white/5 sm:border-t-0">
          <button
            type="button"
            onClick={() => navigate('/pricing')}
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold rounded-xl shadow-md transition-all active:scale-95 cursor-pointer ${tier.ctaColor}`}
          >
            <span>Upgrade Storage</span>
            <ArrowUpRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.2]" />
          </button>

          {tier.dismissible && (
            <button
              type="button"
              onClick={handleDismiss}
              title="Dismiss warning"
              aria-label="Dismiss warning"
              className="p-1.5 sm:p-2 rounded-lg opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
