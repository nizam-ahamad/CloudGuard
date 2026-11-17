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
 * Read-only paid plan detection
 * Returns true if the user has an active paid subscription tier
 */
export const isPaidAccount = (user) => {
  if (!user) return false;

  const plan = String(
    user.plan || user.subscription?.planId || user.subscription?.plan || ''
  )
    .toLowerCase()
    .trim();

  const subStatus = String(
    user.subscription?.status || user.subscriptionStatus || ''
  )
    .toLowerCase()
    .trim();

  // Explicitly free or evaluation/trial accounts
  if (!plan || plan === 'free' || plan === 'trial' || plan === 'none' || plan === 'evaluation') {
    return false;
  }

  // Explicitly trialing status
  if (subStatus === 'trialing') {
    return false;
  }

  // Known paid tiers in CloudGuard
  const paidTierKeywords = [
    'essential',
    'pro',
    'business',
    'ultra',
    'tier_50gb',
    'tier_200gb',
    'tier_1tb',
    'tier_2tb',
    'enterprise',
    'paid',
  ];

  if (paidTierKeywords.some((keyword) => plan.includes(keyword))) {
    return true;
  }

  // Active status with a non-free plan name
  if (subStatus === 'active' && plan !== 'free' && plan !== 'trial') {
    return true;
  }

  return false;
};

/**
 * Top Free-Trial Banner
 * Renders a responsive, Light/Dark theme banner with dynamic remaining trial days
 * and session-based dismissibility.
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

  // Suppress completely for any paid subscribers
  if (isPaidAccount(activeUser)) {
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
      className="relative mb-4 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 px-3.5 py-2.5 sm:px-5 sm:py-3 bg-indigo-50/90 border border-indigo-200/80 text-slate-800 dark:bg-indigo-950/50 dark:border-indigo-500/30 dark:text-slate-100 shadow-sm transition-all"
    >
      {/* Left: Badge + Message */}
      <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-wider bg-indigo-600 text-white dark:bg-indigo-500 shrink-0">
          <Sparkles className="w-3 h-3" />
          <span>Free Trial</span>
        </span>
        <div className="text-xs sm:text-sm min-w-0">
          <span className="font-semibold text-slate-900 dark:text-white">
            You&apos;re on the Free Trial{daysText}
          </span>
          <span className="hidden md:inline text-slate-600 dark:text-slate-300">
            {' '}— Upgrade anytime for higher encrypted storage capacity &amp; priority speeds.
          </span>
          <span className="md:hidden block text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
            Upgrade anytime for higher storage &amp; priority speeds.
          </span>
        </div>
      </div>

      {/* Right: Action Buttons (Upgrade Plan + Dismiss) */}
      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
        <Link
          to="/pricing"
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 shadow-sm active:scale-95 transition-all whitespace-nowrap cursor-pointer"
        >
          <span>Upgrade Plan</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1 rounded-md text-slate-500 hover:text-slate-800 hover:bg-indigo-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-indigo-900/50 transition-colors cursor-pointer shrink-0"
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
 * Sits directly in the sidebar/drawer navigation above the footer/storage area.
 */
export function SidebarUpgradeCard({ user, isCollapsed = false }) {
  const activeUser = user || getStoredUser();

  // Suppress completely for any paid subscribers
  if (isPaidAccount(activeUser)) {
    return null;
  }

  // When desktop sidebar is collapsed to 80px (w-20)
  if (isCollapsed) {
    return (
      <div className="relative group px-2 py-2 flex justify-center my-1">
        <Link
          to="/pricing"
          title="Upgrade Plan — Unlock up to 1 TB"
          className="w-10 h-10 rounded-xl flex items-center justify-center bg-indigo-600/10 hover:bg-indigo-600 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 hover:text-white dark:hover:bg-indigo-500 dark:hover:text-white transition-all cursor-pointer shadow-sm"
        >
          <Sparkles className="w-5 h-5" />
        </Link>
        <div className="absolute left-full ml-4 px-3 py-1.5 bg-neutral-900 dark:bg-[#1e1f20] text-white text-xs rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
          Upgrade Plan
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 my-2 p-3.5 rounded-xl bg-slate-100/80 border border-slate-200 dark:bg-white/[0.04] dark:border-white/10 text-slate-800 dark:text-slate-100 select-none">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="p-1 rounded-lg bg-indigo-100 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 shrink-0">
          <Sparkles className="w-3.5 h-3.5" />
        </div>
        <p className="text-xs font-semibold text-slate-900 dark:text-white leading-tight truncate">
          Need more vault space?
        </p>
      </div>
      <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-400 mb-3">
        Unlock up to 1 TB encrypted storage &amp; priority upload speeds.
      </p>
      <Link
        to="/pricing"
        className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 shadow-sm transition-all text-center cursor-pointer active:scale-[0.98]"
      >
        <span>Upgrade</span>
        <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  );
}

export default TrialBanner;
