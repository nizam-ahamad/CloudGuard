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
 * Warm light-orange / amber styling compliant with Light & Dark themes.
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
      className="relative mb-4 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 px-3.5 py-2.5 sm:px-5 sm:py-3 bg-orange-50/95 border border-orange-200 text-slate-800 dark:bg-orange-500/10 dark:border-orange-400/30 dark:text-orange-50 shadow-sm transition-all"
    >
      {/* Left: Badge + Message */}
      <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-wider bg-orange-500/15 text-orange-700 border border-orange-300/80 dark:bg-orange-400/20 dark:text-orange-300 dark:border-orange-400/30 shrink-0">
          <Sparkles className="w-3 h-3" />
          <span>Free Trial</span>
        </span>
        <div className="text-xs sm:text-sm min-w-0">
          <span className="font-semibold text-slate-900 dark:text-orange-50">
            You&apos;re on the Free Trial{daysText}
          </span>
          <span className="hidden md:inline text-slate-600 dark:text-orange-200/80">
            {' '}— Upgrade anytime for higher encrypted storage capacity &amp; priority speeds.
          </span>
          <span className="md:hidden block text-[11px] text-slate-600 dark:text-orange-200/80 mt-0.5">
            Upgrade anytime for higher storage &amp; priority speeds.
          </span>
        </div>
      </div>

      {/* Right: Action Buttons (Upgrade Plan + Dismiss) */}
      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
        <Link
          to="/pricing"
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white shadow-sm shadow-orange-500/20 active:scale-95 transition-all whitespace-nowrap cursor-pointer"
        >
          <span>Upgrade Plan</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1 rounded-md text-slate-500 hover:text-orange-700 hover:bg-orange-100/70 dark:text-orange-200/70 dark:hover:text-orange-100 dark:hover:bg-orange-400/15 transition-colors cursor-pointer shrink-0"
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
 * Persistent Sidebar Upgrade Card
 * Visible across accounts (free trial, 50 GB, 100 GB).
 * Adapts to "Vault Plan" / "Manage Plan" if already at maximum 200 GB tier.
 * Warm light-orange / amber styling, 200 GB copy, and collapse-aware layout.
 */
export function SidebarUpgradeCard({ user, isCollapsed = false, hideIfMaxTier = false }) {
  const activeUser = user || getStoredUser();
  const isMaxTier = isMaxTierAccount(activeUser);

  // If already at maximum tier and configured to hide
  if (isMaxTier && hideIfMaxTier) {
    return null;
  }

  // When desktop sidebar is collapsed to 80px (w-20)
  if (isCollapsed) {
    return (
      <div className="relative group px-2 py-2 flex justify-center my-1">
        <Link
          to="/pricing"
          title={isMaxTier ? 'Vault Plan — Manage Plan' : 'Upgrade Plan — Unlock up to 200 GB'}
          className="w-10 h-10 rounded-xl flex items-center justify-center bg-orange-500/15 hover:bg-orange-500 text-orange-600 hover:text-white dark:bg-orange-500/20 dark:text-orange-400 dark:hover:bg-orange-500 dark:hover:text-white transition-all cursor-pointer shadow-sm"
        >
          <Sparkles className="w-5 h-5" />
        </Link>
        <div className="absolute left-full ml-4 px-3 py-1.5 bg-neutral-900 dark:bg-[#1e1f20] text-white text-xs rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
          {isMaxTier ? 'Manage Plan' : 'Upgrade Plan'}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 my-2 p-3.5 rounded-xl bg-orange-50/80 border border-orange-200/80 dark:bg-orange-500/[0.08] dark:border-orange-400/25 text-slate-800 dark:text-orange-50 select-none">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="p-1 rounded-lg bg-orange-100 dark:bg-orange-400/15 text-orange-600 dark:text-orange-400 shrink-0">
          <Sparkles className="w-3.5 h-3.5" />
        </div>
        <p className="text-xs font-semibold text-slate-900 dark:text-orange-50 leading-tight truncate">
          {isMaxTier ? 'Vault Plan' : 'Need more vault space?'}
        </p>
      </div>
      <p className="text-[11px] leading-snug text-slate-600 dark:text-orange-200/80 mb-3">
        {isMaxTier
          ? "You're on the top 200 GB Pro Vault tier with maximum priority speeds."
          : 'Unlock up to 200 GB encrypted storage & priority upload speeds.'}
      </p>
      <Link
        to="/pricing"
        className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white shadow-sm transition-all text-center cursor-pointer active:scale-[0.98]"
      >
        <span>{isMaxTier ? 'Manage Plan' : 'Upgrade'}</span>
        <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  );
}

export default TrialBanner;
