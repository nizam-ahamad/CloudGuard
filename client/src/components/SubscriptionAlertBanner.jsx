import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { AlertTriangle, Clock, AlertCircle, X, ShieldAlert, ArrowRight } from 'lucide-react';
import { API_BASE_URL } from '../config';

export default function SubscriptionAlertBanner() {
  const [subData, setSubData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dismissedStages, setDismissedStages] = useState({});

  const fetchStatus = useCallback(async () => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    if (!token) {
      setSubData(null);
      setLoading(false);
      return;
    }
    try {
      const res = await axios.get(`${API_BASE_URL}/api/payments/subscription-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data?.success) {
        setSubData(res.data);
      }
    } catch (err) {
      // Fail silently on banner status fetch error
      console.warn('[SubscriptionAlertBanner] Failed to fetch subscription status:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    const handleUpdate = () => {
      fetchStatus();
    };

    window.addEventListener('cloudguard:subscription-updated', handleUpdate);
    window.addEventListener('cloudguard:storage-updated', handleUpdate);
    return () => {
      window.removeEventListener('cloudguard:subscription-updated', handleUpdate);
      window.removeEventListener('cloudguard:storage-updated', handleUpdate);
    };
  }, [fetchStatus]);

  if (loading || !subData) return null;

  const now = Date.now();
  const sub = subData.subscription || {};
  const status = sub.status || 'active';
  const plan = subData.plan || sub.planId || 'free';
  const billingCycle = sub.billingCycle || 'none';
  const storageUsed = subData.storageUsed || 0;
  const storageLimit = subData.storageLimit || 5368709120; // 5 GB
  const userId = subData.userId || subData._id || 'user';

  // Evaluate Trial & Expiration
  const isTrial = plan === 'trial' || sub.planId === 'trial' || !!subData.trialExpiresAt;
  const rawExpiry = isTrial && subData.trialExpiresAt ? subData.trialExpiresAt : sub.expiresAt;
  const expiryDate = rawExpiry ? new Date(rawExpiry) : null;
  const msRemaining = expiryDate ? expiryDate.getTime() - now : 0;
  const daysRemaining = expiryDate ? Math.ceil(msRemaining / (1000 * 60 * 60 * 24)) : 0;

  // Evaluate Grace Period
  const isPastDue = status === 'past_due';
  const rawGraceEnd = sub.gracePeriodExpiresAt ? new Date(sub.gracePeriodExpiresAt) : null;
  const msGraceRemaining = rawGraceEnd ? rawGraceEnd.getTime() - now : 0;
  const graceDaysLeft = rawGraceEnd ? Math.max(1, Math.ceil(msGraceRemaining / (1000 * 60 * 60 * 24))) : 0;

  // Evaluate Scheduled Downgrade
  const scheduled = sub.scheduledDowngrade;
  const hasScheduledDowngrade = !!(scheduled?.targetPlanId && daysRemaining > 0 && daysRemaining <= 7);

  // Suppress for users on free plan without expiration, or active with plenty of time remaining
  if (plan === 'free' && !rawExpiry && !isPastDue && status !== 'expired') {
    return null;
  }

  const isAnnual = billingCycle === 'annual';
  const activeWindowThresholdMs = isAnnual ? 7 * 24 * 60 * 60 * 1000 : 3 * 24 * 60 * 60 * 1000;
  if (status === 'active' && msRemaining > activeWindowThresholdMs && !hasScheduledDowngrade) {
    return null;
  }

  // Determine Active Banner Configuration based on strict priority
  let bannerConfig = null;

  // Priority 1: FINAL_24H_PURGE
  if (isPastDue && rawGraceEnd && msGraceRemaining > 0 && msGraceRemaining <= 24 * 60 * 60 * 1000) {
    const formattedDeadline = `${rawGraceEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on ${rawGraceEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
    bannerConfig = {
      stage: 'FINAL_24H_PURGE',
      targetTimestamp: rawGraceEnd.getTime(),
      barClass: 'bg-gradient-to-r from-red-600 via-rose-600 to-red-700 text-white shadow-lg shadow-red-950/20',
      icon: ShieldAlert,
      text: `Final Warning: Your vault files will be permanently deleted in under 24 hours (${formattedDeadline}). Renew now to prevent data loss.`,
      ctaText: 'Save My Files',
      ctaUrl: '/pricing',
      ctaClass: 'bg-white text-red-700 hover:bg-neutral-100 shadow-sm',
    };
  }
  // Priority 2: GRACE_PERIOD_LOCK
  else if (isPastDue && rawGraceEnd && msGraceRemaining > 24 * 60 * 60 * 1000) {
    const formattedGraceEnd = rawGraceEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    let text = `Vault in Read-Only Grace Period: File uploads are disabled. Renew within ${graceDaysLeft} days (${formattedGraceEnd}) before your stored files are permanently deleted.`;
    if (storageUsed > storageLimit) {
      const excessGB = ((storageUsed - storageLimit) / (1024 ** 3)).toFixed(1);
      text = `Vault Write-Locked (Read-Only): You are ${excessGB} GB over quota. Delete excess files or upgrade within ${graceDaysLeft} days (${formattedGraceEnd}) before automatic deletion.`;
    }
    bannerConfig = {
      stage: 'GRACE_PERIOD_LOCK',
      targetTimestamp: rawGraceEnd.getTime(),
      barClass: 'bg-rose-600 text-white shadow-md shadow-rose-950/15',
      icon: AlertTriangle,
      text,
      ctaText: 'Restore Uploads',
      ctaUrl: '/pricing',
      ctaClass: 'bg-white text-rose-700 hover:bg-neutral-100 shadow-sm',
    };
  }
  // Priority 2b: SUBSCRIPTION_EXPIRED
  else if (status === 'expired') {
    bannerConfig = {
      stage: 'SUBSCRIPTION_EXPIRED',
      targetTimestamp: sub.expiresAt ? new Date(sub.expiresAt).getTime() : 0,
      barClass: 'bg-neutral-900 border border-rose-500/40 text-white shadow-md',
      icon: AlertTriangle,
      text: 'Subscription Expired: Your previous plan ended and inactive vault files were permanently deleted. Select a plan to unlock uploads.',
      ctaText: 'View Plans',
      ctaUrl: '/pricing',
      ctaClass: 'bg-rose-600 text-white hover:bg-rose-500 shadow-sm',
    };
  }
  // Priority 3: EXPIRING_24H
  else if ((status === 'active' || status === 'cancelled') && msRemaining > 0 && msRemaining <= 24 * 60 * 60 * 1000) {
    const planLabel = isTrial ? '14-Day Trial' : (isAnnual ? 'Annual Plan' : 'Subscription');
    const formattedExactTime = `${expiryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on ${expiryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
    bannerConfig = {
      stage: 'EXPIRING_24H',
      targetTimestamp: expiryDate.getTime(),
      barClass: 'bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-md',
      icon: Clock,
      text: `Action Required: Your ${planLabel} expires in under 24 hours (${formattedExactTime}). Renew now to prevent an upload write-lock.`,
      ctaText: 'Renew Now',
      ctaUrl: '/pricing',
      ctaClass: 'bg-white text-red-700 hover:bg-neutral-100 shadow-sm',
    };
  }
  // Priority 4: EXPIRING_T3
  else if ((status === 'active' || status === 'cancelled') && daysRemaining <= 3 && msRemaining > 24 * 60 * 60 * 1000) {
    const formattedExpiry = expiryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    let text = `Plan Expires in ${daysRemaining} Days (${formattedExpiry}): Renew early without losing your remaining days.`;
    if (isTrial) {
      text = `14-Day Trial Ends in ${daysRemaining} Days (${formattedExpiry}): Upgrade now to keep upload access and prevent a read-only lock.`;
    } else if (status === 'cancelled') {
      text = `Subscription Ends in ${daysRemaining} Days (${formattedExpiry}): Renew now to prevent an upload write-lock.`;
    }
    bannerConfig = {
      stage: 'EXPIRING_T3',
      targetTimestamp: expiryDate.getTime(),
      barClass: 'bg-gradient-to-r from-rose-600 to-amber-600 text-white shadow-md',
      icon: Clock,
      text,
      ctaText: 'Renew Now',
      ctaUrl: '/pricing',
      ctaClass: 'bg-white text-rose-700 hover:bg-neutral-100 shadow-sm',
    };
  }
  // Priority 5: ANNUAL_EXPIRING_T7
  else if (isAnnual && (status === 'active' || status === 'cancelled') && daysRemaining > 3 && daysRemaining <= 7) {
    const formattedExpiry = expiryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    bannerConfig = {
      stage: 'ANNUAL_EXPIRING_T7',
      targetTimestamp: expiryDate.getTime(),
      barClass: 'bg-gradient-to-r from-amber-600 to-rose-600 text-white shadow-sm',
      icon: AlertCircle,
      text: `Annual Plan Renews in ${daysRemaining} Days (${formattedExpiry}): Renew early to extend your vault by 365 days without losing remaining time.`,
      ctaText: 'Renew Early',
      ctaUrl: '/pricing',
      ctaClass: 'bg-white text-amber-800 hover:bg-neutral-100 shadow-sm',
    };
  }
  // Priority 6: SCHEDULED_DOWNGRADE
  else if (hasScheduledDowngrade) {
    const formattedExpiry = expiryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    let targetGB = 5;
    if (scheduled.targetPlanId === 'tier_50gb') targetGB = 50;
    else if (scheduled.targetPlanId === 'tier_100gb') targetGB = 100;
    else if (scheduled.targetPlanId === 'tier_200gb') targetGB = 200;

    bannerConfig = {
      stage: 'SCHEDULED_DOWNGRADE',
      targetTimestamp: expiryDate.getTime(),
      barClass: 'bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-200',
      icon: AlertTriangle,
      text: `Downgrade Scheduled (${formattedExpiry}): Vault transitions to ${targetGB} GB. Keep usage under ${targetGB} GB to avoid an upload lock.`,
      ctaText: 'Manage Plan',
      ctaUrl: '/dashboard?view=settings',
      ctaClass: 'bg-amber-600 text-white hover:bg-amber-700 shadow-sm',
    };
  }

  if (!bannerConfig) return null;

  // Check dismissal key
  const storageKey = `cg_alert_dismissed_${userId}_${bannerConfig.stage}_${bannerConfig.targetTimestamp}`;
  if (dismissedStages[storageKey] || localStorage.getItem(storageKey) === 'true') {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem(storageKey, 'true');
    setDismissedStages((prev) => ({ ...prev, [storageKey]: true }));
  };

  const IconComponent = bannerConfig.icon;

  return (
    <div
      role="alert"
      className={`w-full mb-6 rounded-xl px-4 py-3 sm:px-5 sm:py-3.5 flex items-center justify-between gap-3 text-xs sm:text-sm font-medium transition-all ${bannerConfig.barClass}`}
    >
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
        <IconComponent className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
        <span className="truncate sm:whitespace-normal leading-tight">{bannerConfig.text}</span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Link
          to={bannerConfig.ctaUrl}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors inline-flex items-center gap-1 cursor-pointer ${bannerConfig.ctaClass}`}
        >
          <span>{bannerConfig.ctaText}</span>
          <ArrowRight className="w-3 h-3" />
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss banner"
          className="p-1 rounded-md opacity-80 hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

