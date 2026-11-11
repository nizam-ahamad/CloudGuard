import React, { useState, useEffect } from 'react';
import { loadCashfree } from '../utils/cashfree';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { AlertCircle, HardDrive, ArrowUpRight, X } from 'lucide-react';

export default function QuotaUpgradeModal({ quotaData, onResume, onCancel, user, refreshUser }) {
  if (!quotaData) return null;

  const { fileItem, quotaInfo } = quotaData;
  const targetPlanId = quotaInfo.suggestedUpgrade || 'tier_100gb';
  const targetCycle = user?.subscription?.billingCycle === 'annual' ? 'annual' : 'monthly';

  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isFetchingPreview, setIsFetchingPreview] = useState(true);

  const planNames = {
    tier_50gb: 'Essential Vault (50 GB)',
    tier_100gb: 'Pro Vault (100 GB)',
    tier_200gb: 'Ultra Vault (200 GB)'
  };

  useEffect(() => {
    let isMounted = true;
    api.post('/payments/preview-transition', {
      targetPlanId,
      targetBillingCycle: targetCycle
    })
      .then((res) => {
        if (isMounted && res.data.success) {
          setPreview(res.data);
        }
      })
      .catch((err) => console.error('Failed to preview upgrade:', err))
      .finally(() => {
        if (isMounted) setIsFetchingPreview(false);
      });

    return () => { isMounted = false; };
  }, [targetPlanId, targetCycle]);

  const handleUpgradeAndResume = async () => {
    setLoading(true);
    try {
      const res = await api.post('/payments/create-order', {
        planId: targetPlanId,
        billingCycle: targetCycle
      });

      const { paymentSessionId, orderId } = res.data;
      if (!paymentSessionId) throw new Error('Could not initiate checkout');

      const cashfree = await loadCashfree();
      cashfree.checkout({
        paymentSessionId,
        redirectTarget: '_modal'
      }).then(async (result) => {
        if (result.error) {
          toast.error(result.error.message || 'Payment cancelled');
          setLoading(false);
          return;
        }

        if (result.paymentDetails) {
          try {
            const verifyRes = await api.get(`/payments/verify/${orderId}`);
            if (verifyRes.data.success) {
              toast.success('Storage unlocked! Resuming upload...', {
                style: { background: '#18181b', color: '#fff', border: '1px solid #27272a' }
              });
              if (typeof refreshUser === 'function') refreshUser();
              onResume(fileItem.id);
            }
          } catch (vErr) {
            toast.error('Payment verification failed. Please contact support.');
          }
        }
        setLoading(false);
      });
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Upgrade failed');
      setLoading(false);
    }
  };

  const fileSizeMB = (quotaInfo.requiredBytes / (1024 * 1024)).toFixed(1);
  const payableAmount = preview ? preview.payableAmount : (targetCycle === 'annual' ? 999 : 99);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div 
        className="relative w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#141414] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onCancel(fileItem.id)}
          className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
        >
          <X className="w-4 h-4"/>
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
            <AlertCircle className="w-5 h-5"/>
          </div>
          <div>
            <h3 className="text-base font-semibold text-neutral-900 dark:text-white">
              Storage Quota Exceeded
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Upgrade your vault to complete this upload
            </p>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200/60 dark:border-neutral-800 mb-4 text-xs space-y-2">
          <div className="flex justify-between text-neutral-600 dark:text-neutral-300">
            <span>File in queue:</span>
            <span className="font-medium text-neutral-900 dark:text-white truncate max-w-[180px]">
              {fileItem?.file?.name || 'In-flight upload'}
            </span>
          </div>
          <div className="flex justify-between text-neutral-600 dark:text-neutral-300">
            <span>File size:</span>
            <span className="font-semibold text-amber-500">{fileSizeMB} MB</span>
          </div>
          <div className="flex justify-between text-neutral-600 dark:text-neutral-300 border-t border-neutral-200/40 dark:border-neutral-800 pt-2">
            <span>Recommended Plan:</span>
            <span className="font-semibold text-blue-500">
              {planNames[targetPlanId] || 'Higher Tier'}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 mb-5">
          <div className="flex items-center gap-2.5">
            <HardDrive className="w-4 h-4 text-blue-500"/>
            <div className="text-left">
              <div className="text-xs font-semibold text-neutral-900 dark:text-white">
                Payable Today
              </div>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                {preview?.transitionType === 'ANNUAL_UPGRADE' ? 'Prorated for remaining days' : 'Immediate quota unlock'}
              </div>
            </div>
          </div>
          <div className="text-right">
            {isFetchingPreview ? (
              <span className="text-xs text-neutral-400">Calculating...</span>
            ) : (
              <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                ₹{payableAmount}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={loading}
            onClick={() => onCancel(fileItem.id)}
            className="px-4 py-2 rounded-xl text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            Cancel Upload
          </button>
          <button
            type="button"
            disabled={loading || isFetchingPreview}
            onClick={handleUpgradeAndResume}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 transition-all cursor-pointer disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Upgrade & Resume Upload'}
            <ArrowUpRight className="w-3.5 h-3.5"/>
          </button>
        </div>
      </div>
    </div>
  );
}

