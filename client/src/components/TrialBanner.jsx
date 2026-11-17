import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight, X } from 'lucide-react';

/**
 * Safely parses the stored user object from localStorage / sessionStorage
 */
const getStoredUser = () => {
  try {
    const userStr = localStorage.getItem('user') || sessionStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  } catch {
    return null;
  }
};

/**
 * Strict evaluation of Free Trial vs. Paid/Active accounts
 * Used to ensure <TrialBanner /> renders ONLY for genuine Free Trial users:
 * - tier/plan is 'free', 'trial', 'starter' (or default empty)
 * - subscriptionStatus !== 'active' and status !== 'active'
 * - storage quota < 50 GB (50 GB+ is a paid vault tier)
 */
export const isFreeTrialAccount = (user) => {
  if (!user) {
    return true;
  }

  // 1. Quota check: 50 GB or higher is an active paid tier
  const FIFTY_GB = 50 * 1024 * 1024 * 1024;
  const storageLimit = Number(
    user.storageLimit ||
    user.subscription?.storageLimit ||
    user.totalLimitBytes ||
    0
  );
  if (storageLimit >= FIFTY_GB) {
    return false;
  }

  // 2. Status check: Any active subscription means paid
  const subStatus = String(
    user.subscriptionStatus ||
    user.status ||
    user.subscription?.status ||
    ''
  ).toLowerCase().trim();

  if (subStatus === 'active') {
    return false;
  }

  // 3. Tier/Plan check: Any non-free/non-trial keyword means paid
  const rawTier = String(
    user.subscriptionTier ||
    user.tier ||
    user.plan ||
    user.subscription?.planId ||
    user.subscription?.plan ||
    user.subscription?.tier ||
    ''
  ).toLowerCase().trim();

  const paidKeywords = [
    '50gb',
    '100gb',
    '200gb',
    'essential',
    'pro',
    'ultra',
    'basic',
    'premium',
    'tier_50gb',
    'tier_100gb',
    'tier_200gb',
    'tier_1tb',
    'tier_2tb',
    'business',
    'enterprise',
    'paid',
  ];

  if (paidKeywords.some((keyword) => rawTier.includes(keyword))) {
    return false;
  }

  // 4. Explicit boolean check
  if (user.isPaid === true || user.subscription?.isPaid === true) {
    return false;
  }

  // Must match allowed free/trial tiers
  const allowedFreeTiers = ['', 'free', 'trial', 'starter', 'evaluation', 'none'];
  return allowedFreeTiers.includes(rawTier);
};

export const isPaidAccount = (user) => !isFreeTrialAccount(user);

/**
 * Checks whether the user is already on the maximum 200 GB vault tier
 */
export const isMaxTierAccount = (user) => {
  if (!user) return false;

  const TWO_HUNDRED_GB = 200 * 1024 * 1024 * 1024;
  const storageLimit = Number(
    user.storageLimit ||
    user.subscription?.storageLimit ||
    user.totalLimitBytes ||
    0
  );

  if (storageLimit >= TWO_HUNDRED_GB) {
    return true;
  }

  const rawTier = String(
    user.subscriptionTier ||
    user.tier ||
    user.plan ||
    user.subscription?.planId ||
    user.subscription?.plan ||
    user.subscription?.tier ||
    ''
  ).toLowerCase().trim();

  return (
    rawTier.includes('200gb') ||
    rawTier.includes('ultra') ||
    rawTier.includes('1tb') ||
    rawTier.includes('2tb')
  );
};

/**
 * Top Free-Trial Banner
 * Renders STRICTLY for genuine Free-Trial users only.
 * Sleek, matte warm-stone & muted-amber styling matching CloudGuard's button UI.
 */
export function TrialBanner({ user }) {
  const [isDismissed, setIsDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('cg_trial_banner_dismissed') === 'true';
    } catch {
      return false;
    }
  });

  if (isDismissed) {
    return null;
  }

  const activeUser = user || getStoredUser();

  // Immediately return null for any paid, active, or non-free account
  if (!isFreeTrialAccount(activeUser)) {
    return null;
  }

  const rawTrialEnd =
    activeUser?.trialEndsAt ||
    activeUser?.trialExpiresAt ||
    activeUser?.subscription?.trialExpiresAt ||
    activeUser?.trialExpiry;

  let daysRemaining = null;
  if (rawTrialEnd) {
    const diff = new Date(rawTrialEnd).getTime() - Date.now();
    if (diff > 0) {
      daysRemaining = Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    }
  }

  const daysText =
    daysRemaining !== null
      ? ` (${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} remaining)`
      : '';

  const handleDismiss = () => {
    try {
      sessionStorage.setItem('cg_trial_banner_dismissed', 'true');
    } catch {}
    setIsDismissed(true);
  };

  return (
    <div
      role="region"
      aria-label="Free Trial Information"
      className="relative mb-4 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 px-3.5 py-2.5 sm:px-5 sm:py-3 bg-stone-100/90 border border-stone-300/80 text-stone-800 dark:bg-[#1e1d1b] dark:border-amber-200/15 dark:text-stone-200 shadow-none transition-all"
    >
      {/* Left: Badge + Message */}
      <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-wider bg-amber-900/10 text-amber-800 border border-amber-700/20 dark:bg-amber-400/10 dark:text-amber-300/85 dark:border-amber-300/20 shrink-0">
          <Sparkles className="w-3 h-3" />
          <span>Free Trial</span>
        </span>
        <div className="text-xs sm:text-sm min-w-0">
          <span className="font-semibold text-stone-900 dark:text-stone-100">
            You&apos;re on the Free Trial{daysText}
          </span>
          <span className="hidden md:inline text-stone-600 dark:text-stone-300">
            {' '}— Upgrade anytime for higher encrypted storage capacity &amp; priority speeds.
          </span>
          <span className="md:hidden block text-[11px] text-stone-600 dark:text-stone-400 mt-0.5">
            Upgrade anytime for higher storage &amp; priority speeds.
          </span>
        </div>
      </div>

      {/* Right: Action Buttons (Upgrade Plan + Dismiss) */}
      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
        <Link
          to="/pricing"
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs bg-stone-800 hover:bg-stone-700 text-amber-100 border border-amber-300/20 dark:bg-[#2a2825] dark:hover:bg-[#34312d] dark:text-amber-200/90 dark:border-amber-300/20 font-medium shadow-none active:scale-95 transition-colors whitespace-nowrap cursor-pointer"
        >
          <span>Upgrade Plan</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 dark:text-stone-500 dark:hover:text-stone-200 dark:hover:bg-white/5 transition-colors cursor-pointer shrink-0"
          aria-label="Dismiss banner"
          title="Dismiss for this session"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Ultra-Compact Single-Row Sidebar Upgrade Bar (~36px height)
 * Smoothly transitions between expanded row and centered icon-only rail.
 * Visible across accounts (free trial, 50 GB, 100 GB).
 * Adapts to "Vault Plan" if already at maximum 200 GB tier.
 * Sleek matte warm-stone & muted-amber styling matching CloudGuard's sidebar UI.
 */
export function SidebarUpgradeCard({ user, isCollapsed = false, hideIfMaxTier = false }) {
  const activeUser = user || getStoredUser();
  const isMaxTier = isMaxTierAccount(activeUser);

  // If already at maximum tier and configured to hide
  if (isMaxTier && hideIfMaxTier) {
    return null;
  }

  const label = isMaxTier ? 'Vault Plan' : 'Upgrade';

  return (
    <Link
      to="/pricing"
      title={label}
      className={`group relative my-1 rounded-lg flex items-center bg-stone-100/80 hover:bg-stone-200/70 border border-stone-200/90 dark:bg-[#1c1b19] dark:hover:bg-[#24221f] dark:border-white/[0.08] transition-all duration-200 cursor-pointer select-none ${
        isCollapsed
          ? 'w-10 h-10 mx-auto justify-center px-0'
          : 'mx-4 px-3 py-2 justify-between'
      }`}
    >
      {/* Left: Icon + Label */}
      <div className={`flex items-center min-w-0 ${isCollapsed ? 'justify-center' : 'gap-2'}`}>
        <Sparkles className="w-4 h-4 shrink-0 text-amber-700/80 dark:text-amber-300/80" />
        <span
          className={`font-medium text-xs text-stone-800 dark:text-stone-200 whitespace-nowrap overflow-hidden transition-all duration-200 ${
            isCollapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'
          }`}
        >
          {label}
        </span>
      </div>

      {/* Right: Clean Arrow Icon */}
      <div
        className={`shrink-0 flex items-center transition-all duration-200 ${
          isCollapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'
        }`}
      >
        <ArrowRight className="w-3.5 h-3.5 shrink-0 text-stone-400 group-hover:text-stone-700 dark:text-stone-500 dark:group-hover:text-stone-300 transition-transform duration-200 group-hover:translate-x-0.5" />
      </div>

      {/* Tooltip in collapsed icon-only rail (matching surrounding nav items) */}
      {isCollapsed && (
        <div className="absolute left-full ml-4 px-3 py-1 bg-white dark:bg-[#1e1f20] border border-neutral-200 dark:border-zinc-800 text-neutral-800 dark:text-[#e3e3e3] text-xs rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
          {label}
        </div>
      )}
    </Link>
  );
}

export default TrialBanner;
