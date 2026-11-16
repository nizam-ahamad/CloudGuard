import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config';

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function SubscriptionSettingsCard({ user, onUpdate }) {
  const [sub, setSub] = useState(user?.subscription || null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    api.get('/payments/subscription-status')
      .then(res => {
        if (res.data.subscription) setSub(res.data.subscription);
      })
      .catch(console.error);
  }, []);

  const handleCancel = async () => {
    if (!window.confirm("Are you sure you want to cancel? You will keep your current vault storage until your billing period ends.")) {
      return;
    }

    setCancelling(true);
    try {
      const res = await api.post('/payments/cancel-subscription');
      if (res.data.success) {
        setSub(prev => ({ ...prev, status: 'cancelled' }));
        alert(res.data.message);
        if (onUpdate) onUpdate();
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to cancel subscription');
    } finally {
      setCancelling(false);
    }
  };

  if (!sub || sub.planId === 'free' || sub.status === 'expired') {
    return (
      <div className="p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">Free Vault</h4>
          <p className="text-xs text-neutral-500 mt-0.5">5 GB standard secure storage</p>
        </div>
        <a 
          href="/pricing"
          className="text-xs font-semibold px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          Upgrade Storage
        </a>
      </div>
    );
  }

  const isCancelled = sub.status === 'cancelled';
  const expiryDate = sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';

  return (
    <div className="p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold capitalize text-neutral-900 dark:text-white">
            {sub.planId.replace('tier_', '')} Vault
          </h4>
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-800/40">
            {sub.billingCycle}
          </span>
        </div>
        <p className="text-xs text-neutral-500 mt-1">
          {isCancelled 
            ? `Access active until ${expiryDate} (No further billing)`
            : `Renews on ${expiryDate}`}
        </p>
      </div>

      <div>
        {isCancelled ? (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-3 py-1.5 rounded-lg border border-amber-200/50 dark:border-amber-800/30">
            Cancelled (Pending Expiry)
          </span>
        ) : (
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/40 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {cancelling ? 'Cancelling...' : 'Cancel Subscription'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Settings({ user, onUpdate }) {
  return (
    <div className="space-y-6">
      <SubscriptionSettingsCard user={user} onUpdate={onUpdate} />
    </div>
  );
}

