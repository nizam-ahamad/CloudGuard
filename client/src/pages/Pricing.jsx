import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  ArrowLeft, 
  Check, 
  ShieldCheck, 
  Zap, 
  Lock, 
  HardDrive, 
  AlertTriangle,
  ArrowRight,
  X,
  Info
} from 'lucide-react';
import CloudGuardLogo from '../CloudGuardLogo';
import Footer from '../components/Footer';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import toast, { Toaster } from 'react-hot-toast';

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

const TIERS_CONFIG = [
  {
    id: 'trial',
    tierId: 'free',
    name: '14-Day Trial',
    tagline: 'Evaluation & security testing',
    storage: '5 GB',
    monthlyPrice: 0,
    annualPrice: 0,
    savings: null,
    badge: 'Evaluation',
    highlighted: false,
    popular: false,
    features: [
      '5 GB Secure Cloud Storage',
      '14-Day Full Platform Evaluation',
      'No Credit Card Required',
      '7-Day Grace Period Upon Expiry',
    ],
  },
  {
    id: 'essential',
    tierId: 'tier_50gb',
    name: 'Essential Vault',
    tagline: 'For individuals & personal archives',
    storage: '50 GB',
    monthlyPrice: 49,
    annualPrice: 499,
    savings: 'Save 15%',
    badge: null,
    highlighted: false,
    popular: false,
    features: [
      '50 GB High-Performance Storage',
      'Unlimited File Uploads',
      'In-Browser Streaming & Previews',
      'Multi-Device Synchronized Access',
    ],
  },
  {
    id: 'pro',
    tierId: 'tier_100gb',
    name: 'Pro Vault',
    tagline: 'For power users & professionals',
    storage: '100 GB',
    monthlyPrice: 99,
    annualPrice: 999,
    savings: 'Save ~17%',
    badge: 'Most Popular',
    highlighted: true,
    popular: true,
    features: [
      '100 GB High-Performance Storage',
      'Priority Threat Inspection Queue',
      'High-Res Media Transcoding',
      'Co-Termed Mid-Cycle Upgrades',
    ],
  },
  {
    id: 'ultra',
    tierId: 'tier_200gb',
    name: 'Ultra Vault',
    tagline: 'Maximum headroom for large datasets',
    storage: '200 GB',
    monthlyPrice: 189,
    annualPrice: 1899,
    savings: 'Save ~16%',
    badge: 'Maximum Headroom',
    highlighted: false,
    popular: false,
    features: [
      '200 GB High-Performance Storage',
      'Dedicated VIP Ingestion Pipe',
      'Expanded Daily Download Bandwidth',
      'Direct Technical Support Escalation',
    ],
  },
];

const UNIFORM_SECURITY_FEATURES = [
  {
    title: 'Zero-Knowledge Encrypted Storage',
    desc: 'All assets encrypted at rest using AES-256 with cryptographically signed ephemeral access tokens.',
    icon: Lock,
  },
  {
    title: 'Real-Time Heuristic Threat Inspection',
    desc: 'Every file inspected for suspicious payload headers and execution vectors before quarantine.',
    icon: Zap,
  },
  {
    title: 'Abuse.ch MalwareBazaar Verification',
    desc: 'Instant verification against known malicious SHA-256 signatures and zero-day threat feeds.',
    icon: ShieldCheck,
  },
  {
    title: 'Direct-to-Cloud Upload Pipeline',
    desc: 'Pre-signed S3/B2 ingress streams directly to object storage, bypassing application server memory.',
    icon: HardDrive,
  },
  {
    title: '$0 Egress Bandwidth Fees',
    desc: 'Download your files as often as you need with zero bandwidth surcharges via Cloudflare Bandwidth Alliance.',
    icon: Check,
  },
];

export default function Pricing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const hasAutoResumedCheckoutRef = useRef(false);
  const [isPreviewsLoading, setIsPreviewsLoading] = useState(false);
  const [billingCycle, setBillingCycle] = useState('annual'); // 'monthly' | 'annual'
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [orderSummaryPlan, setOrderSummaryPlan] = useState(null);
  const [checkoutNotice, setCheckoutNotice] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [currentPlanId, setCurrentPlanId] = useState('free');
  const [userSubData, setUserSubData] = useState(null);

  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || 'null');
    } catch (e) {
      return null;
    }
  });

  const [previews, setPreviews] = useState({});
  const [loadingPlanId, setLoadingPlanId] = useState(null);

  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  const ctaLink = token ? '/dashboard' : '/login';

  const loadCashfree = async () => {
    if (typeof window.Cashfree === 'function') {
      return window.Cashfree({ mode: 'sandbox' });
    }
    throw new Error('Cashfree SDK is not loaded. Please refresh and try again.');
  };

  const refreshUser = async () => {
    if (token) {
      try {
        const res = await api.get('/payments/subscription-status');
        if (res.data?.success) {
          setUserSubData(res.data);
          setUser((prev) => ({
            ...(prev || {}),
            ...res.data,
            plan: res.data.plan || res.data.subscription?.planId || prev?.plan || 'free',
            subscription: res.data.subscription || prev?.subscription,
          }));
          const sub = res.data.subscription;
          if (sub && sub.status === 'active' && sub.planId && sub.planId !== 'free') {
            setCurrentPlanId(sub.planId);
          } else if (res.data.plan && res.data.plan !== 'free') {
            setCurrentPlanId(res.data.plan);
          } else {
            setCurrentPlanId('free');
          }
        }
      } catch (err) {
        console.error('Failed to load subscription status in pricing:', err);
      }
    }
  };

  useEffect(() => {
    refreshUser();
  }, [token]);

  // Fetch preview deltas for all plans when billingCycle or user plan changes
  useEffect(() => {
    if (!user || user.plan === 'free') {
      setIsPreviewsLoading(false);
      return;
    }

    const fetchPreviews = async () => {
      setIsPreviewsLoading(true);
      try {
        const planIds = ['tier_50gb', 'tier_100gb', 'tier_200gb'];
        const results = {};
        await Promise.all(
          planIds.map(async (pId) => {
            try {
              const res = await api.post('/payments/preview-transition', {
                targetPlanId: pId,
                targetBillingCycle: billingCycle,
              });
              if (res.data.success) {
                results[pId] = res.data;
                results[`${pId}_${billingCycle}`] = res.data;
              }
            } catch (e) {
              // Silently ignore if preview fails for a tier
            }
          })
        );
        setPreviews((prev) => ({ ...prev, ...results }));
      } catch (err) {
        console.error('Failed to load transition previews', err);
      } finally {
        setIsPreviewsLoading(false);
      }
    };

    fetchPreviews();
  }, [billingCycle, user]);

  const userPlanId = user?.plan || userSubData?.subscription?.planId || userSubData?.plan || currentPlanId || 'free';
  const userBillingCycle = user?.subscription?.billingCycle || userSubData?.subscription?.billingCycle || 'monthly';
  const userSubStatus = user?.subscription?.status || userSubData?.subscription?.status || 'active';

  // Defensive currency & number formatter
  const formatPrice = (val) => {
    if (val === null || val === undefined) return '₹0';
    if (typeof val === 'number') {
      return `₹${val.toLocaleString('en-IN')}`;
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      const numeric = Number(trimmed.replace(/[^0-9.]/g, ''));
      if (!isNaN(numeric) && numeric > 0) {
        return `₹${numeric.toLocaleString('en-IN')}`;
      }
      return trimmed.startsWith('₹') ? trimmed : `₹${trimmed}`;
    }
    return '₹0';
  };

  const getCleanAmount = (val) => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    const num = Number(String(val).replace(/[^0-9.]/g, ''));
    return isNaN(num) ? 0 : num;
  };

  const handleCloseModal = (e) => {
    if (e && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
    setOrderSummaryPlan(null);
    setSelectedPlan(null);
    setCheckoutNotice(false);
    setPaymentError('');
    setIsProcessingPayment(false);
  };

  // Dismiss modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isProcessingPayment && !loadingPlanId) {
        setOrderSummaryPlan(null);
        setSelectedPlan(null);
      }
    };
    if (orderSummaryPlan || selectedPlan) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [orderSummaryPlan, selectedPlan, isProcessingPayment, loadingPlanId]);

  const handleCycleChange = (cycle) => {
    setBillingCycle(cycle);
    if (orderSummaryPlan) {
      const matched = TIERS_CONFIG.find((t) => t.id === orderSummaryPlan.plan.id || t.tierId === orderSummaryPlan.plan.tierId) || orderSummaryPlan.plan;
      if (matched) {
        const preview = previews[`${matched.tierId}_${cycle}`] || (previews[matched.tierId]?.targetBillingCycle === cycle ? previews[matched.tierId] : null);
        const baseCyclePrice = cycle === 'annual' ? Number(matched.annualPrice ?? 499) : Number(matched.monthlyPrice ?? 49);
        const payableAmount = (preview && preview.payableAmount !== undefined) ? getCleanAmount(preview.payableAmount) : baseCyclePrice;
        const transitionType = preview?.transitionType || 'STANDARD';
        setOrderSummaryPlan((prev) => ({
          ...prev,
          plan: matched,
          billingCycle: cycle,
          payableAmount,
          transitionType,
        }));
      }
    }
  };

  const handleSelectPlan = (plan) => {
    if (!plan) return;

    const isFree = plan.tierId === 'free' || plan.id === 'trial' || plan.price === 0 || plan.price === '₹0';
    const targetTierId = plan.tierId || (plan.id === 'essential' ? 'tier_50gb' : plan.id === 'pro' ? 'tier_100gb' : plan.id === 'ultra' ? 'tier_200gb' : plan.id);

    if (isFree) {
      sessionStorage.removeItem('cloudguard_pending_checkout');
      if (token) {
        navigate('/dashboard');
      } else {
        navigate('/login?mode=signup');
      }
      return;
    }

    // Paid tier for unauthenticated users
    if (!user || !token) {
      sessionStorage.setItem('cloudguard_pending_checkout', JSON.stringify({
        planId: targetTierId,
        billingCycle,
        timestamp: Date.now(),
      }));
      navigate(`/login?redirect=/pricing&plan=${encodeURIComponent(targetTierId)}&cycle=${encodeURIComponent(billingCycle)}`);
      return;
    }

    // Check if user is strictly on this current plan
    const isStrictlyCurrentPlan =
      (user?.plan === targetTierId || userPlanId === targetTierId) &&
      (user?.subscription?.billingCycle === billingCycle || userBillingCycle === billingCycle) &&
      (user?.subscription?.status === 'active' || userSubStatus === 'active');

    if (isStrictlyCurrentPlan) return;

    const matchedPlan = TIERS_CONFIG.find((t) => t.tierId === targetTierId || t.id === targetTierId) || plan;
    const activeCycle = billingCycle;
    const baseCyclePrice =
      activeCycle === 'annual'
        ? Number(matchedPlan.annualPrice ?? 499)
        : Number(matchedPlan.monthlyPrice ?? 49);

    const preview = previews[`${targetTierId}_${activeCycle}`] || (previews[targetTierId]?.targetBillingCycle === activeCycle ? previews[targetTierId] : null);
    let payableAmount = baseCyclePrice;
    let transitionType = 'STANDARD';

    if (preview && preview.payableAmount !== undefined) {
      payableAmount = getCleanAmount(preview.payableAmount);
      transitionType = preview.transitionType || 'STANDARD';
    }

    setCheckoutNotice(false);
    setPaymentError('');
    setOrderSummaryPlan({
      plan: matchedPlan,
      payableAmount,
      transitionType,
      billingCycle: activeCycle,
    });
  };

  const handlePlanSelect = handleSelectPlan;

  const executeCheckout = async (plan) => {
    if (!plan) return;

    const targetCycle = orderSummaryPlan?.billingCycle || billingCycle || 'annual';
    const targetTierId = plan.tierId || (plan.id === 'essential' ? 'tier_50gb' : plan.id === 'pro' ? 'tier_100gb' : plan.id === 'ultra' ? 'tier_200gb' : plan.id);

    setLoadingPlanId(targetTierId);
    setIsProcessingPayment(true);
    setPaymentError('');

    try {
      const res = await api.post('/payments/create-order', {
        planId: targetTierId,
        billingCycle: targetCycle,
      });

      // CASE 1: Deferred Downgrade Scheduled (₹0 today)
      if (res.data.isDowngradeScheduled) {
        toast.success(res.data.message || 'Downgrade scheduled successfully.', {
          duration: 6000,
          style: {
            background: '#18181b',
            color: '#fff',
            border: '1px solid #27272a',
            fontSize: '13px',
          },
        });
        window.dispatchEvent(new CustomEvent('cloudguard:subscription-updated'));
        window.dispatchEvent(new Event('cloudguard:storage-updated'));
        if (typeof refreshUser === 'function') refreshUser();
        setLoadingPlanId(null);
        setIsProcessingPayment(false);
        setOrderSummaryPlan(null);
        setSelectedPlan(null);
        return;
      }

      // CASE 2: Paid Transition / Standard Purchase via Cashfree
      const { paymentSessionId, orderId } = res.data;
      if (!paymentSessionId) throw new Error('Payment session initialization failed');

      const cashfree = await loadCashfree();
      const checkoutOptions = {
        paymentSessionId,
        redirectTarget: '_modal',
      };

      cashfree.checkout(checkoutOptions).then(async (result) => {
        if (result.error) {
          toast.error(result.error.message || 'Payment cancelled');
          setLoadingPlanId(null);
          setIsProcessingPayment(false);
          return;
        }
        if (result.paymentDetails) {
          try {
            const verifyRes = await api.get(`/payments/verify/${orderId}`);
            if (verifyRes.data.success) {
              const storageGB = targetTierId === 'tier_200gb' ? 200 : (targetTierId === 'tier_100gb' ? 100 : 50);
              const planName = plan.name || (targetTierId === 'tier_200gb' ? 'Ultra Vault' : targetTierId === 'tier_100gb' ? 'Pro Vault' : 'Essential Vault');
              sessionStorage.setItem('cloudguard_upgrade_welcome', JSON.stringify({
                planName,
                storageGB,
                billingCycle: targetCycle,
                expiresAt: verifyRes.data?.expiresAt || null,
              }));
              toast.success('Plan activated successfully!', {
                style: { background: '#18181b', color: '#fff', border: '1px solid #27272a' },
              });
              window.dispatchEvent(new CustomEvent('cloudguard:subscription-updated'));
              window.dispatchEvent(new Event('cloudguard:storage-updated'));
              if (typeof refreshUser === 'function') refreshUser();
              navigate('/dashboard?upgraded=true');
            }
          } catch (vErr) {
            toast.error('Payment verification failed. Please contact support.');
          }
        }
        setLoadingPlanId(null);
        setIsProcessingPayment(false);
        setOrderSummaryPlan(null);
        setSelectedPlan(null);
      });
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message || 'Failed to process plan change';
      toast.error(errMsg);
      setPaymentError(errMsg);
      setLoadingPlanId(null);
      setIsProcessingPayment(false);
    }
  };

  const handleSubscribe = executeCheckout;

  // Auto-Resume Checkout After Login: opens Order Summary modal
  useEffect(() => {
    if (!token || !user) return;
    if (user.plan !== 'free' && isPreviewsLoading) return;
    if (hasAutoResumedCheckoutRef.current) return;

    const paramPlan = searchParams.get('plan');
    const paramCycle = searchParams.get('cycle');

    let pendingIntent = null;
    if (paramPlan) {
      pendingIntent = { planId: paramPlan, billingCycle: paramCycle || 'annual' };
    } else {
      try {
        const raw = sessionStorage.getItem('cloudguard_pending_checkout');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.planId && parsed.timestamp && (Date.now() - parsed.timestamp < 15 * 60 * 1000)) {
            pendingIntent = parsed;
          }
        }
      } catch (e) {
        // ignore
      }
    }

    if (!pendingIntent) return;

    hasAutoResumedCheckoutRef.current = true;
    sessionStorage.removeItem('cloudguard_pending_checkout');
    navigate('/pricing', { replace: true });

    const effectiveCycle = pendingIntent.billingCycle || 'annual';
    setBillingCycle(effectiveCycle);

    const matchedPlan = TIERS_CONFIG.find(
      (p) => p.tierId === pendingIntent.planId || p.id === pendingIntent.planId
    );

    if (!matchedPlan) return;

    const isStrictlyCurrentPlan =
      (user?.plan === matchedPlan.tierId || userPlanId === matchedPlan.tierId) &&
      (user?.subscription?.billingCycle === effectiveCycle || userBillingCycle === effectiveCycle) &&
      (user?.subscription?.status === 'active' || userSubStatus === 'active');

    const hasScheduledDowngrade = Boolean(
      user?.subscription?.scheduledDowngrade ||
      userSubData?.subscription?.scheduledDowngrade
    );

    if (!isStrictlyCurrentPlan && !hasScheduledDowngrade) {
      const preview = previews[`${matchedPlan.tierId}_${effectiveCycle}`] || (previews[matchedPlan.tierId]?.targetBillingCycle === effectiveCycle ? previews[matchedPlan.tierId] : null);
      const baseCyclePrice =
        effectiveCycle === 'annual'
          ? Number(matchedPlan.annualPrice ?? 499)
          : Number(matchedPlan.monthlyPrice ?? 49);

      let payableAmount = baseCyclePrice;
      let transitionType = 'STANDARD';

      if (preview && preview.payableAmount !== undefined) {
        payableAmount = getCleanAmount(preview.payableAmount);
        transitionType = preview.transitionType || 'STANDARD';
      }

      setCheckoutNotice(false);
      setPaymentError('');
      setOrderSummaryPlan({
        plan: matchedPlan,
        payableAmount,
        transitionType,
        billingCycle: effectiveCycle,
      });
    }
  }, [token, user, isPreviewsLoading, searchParams, userPlanId, userBillingCycle, userSubStatus, userSubData, previews]);

  // Generate tier list with dynamic labels
  const tiers = TIERS_CONFIG.map((tier) => {
    const isAnnual = billingCycle === 'annual';
    const rawPrice = isAnnual ? tier.annualPrice : tier.monthlyPrice;
    const price = formatPrice(rawPrice);

    let periodText = '/month';
    if (tier.id === 'trial') {
      periodText = 'for 14 days';
    } else if (isAnnual) {
      if (tier.id === 'essential') periodText = '/year (~₹41.58/mo)';
      else if (tier.id === 'pro') periodText = '/year (~₹83.25/mo)';
      else if (tier.id === 'ultra') periodText = '/year (~₹158.25/mo)';
      else periodText = '/year';
    }

    let ctaText = 'Get Started';
    if (tier.id === 'trial') {
      ctaText = token ? 'Active in Vault' : 'Start Free Trial';
    } else if (token) {
      ctaText = `Upgrade to ${tier.name.replace(' Vault', '')}`;
    }

    return {
      ...tier,
      price,
      periodText,
      ctaText,
    };
  });

  // Modal computed variables with safe defensive fallbacks
  const activeTierMatch = selectedPlan ? TIERS_CONFIG.find((t) => t.id === selectedPlan.id) : null;
  const modalPlanName = selectedPlan?.name || activeTierMatch?.name || 'Selected Plan';
  const modalQuota = selectedPlan?.quota
    ? selectedPlan.quota.includes('Allocation')
      ? selectedPlan.quota
      : `${selectedPlan.quota} Encrypted Allocation`
    : activeTierMatch?.storage
    ? `${activeTierMatch.storage} Encrypted Allocation`
    : 'Storage Quota';

  const rawModalPrice = activeTierMatch
    ? (billingCycle === 'annual' ? activeTierMatch.annualPrice : activeTierMatch.monthlyPrice)
    : selectedPlan?.price;
  const displayModalPrice = formatPrice(rawModalPrice);
  const modalBillingBadge = billingCycle === 'annual' ? 'ANNUAL (1-TIME)' : 'MONTHLY (1-TIME)';
  const modalPeriodSuffix = billingCycle === 'annual' ? '/yr' : '/mo';

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-300 font-sans selection:bg-cyan-500/30 selection:text-white">
      {/* Top Header */}
      <header className="w-full border-b border-[#262626] bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-3 text-neutral-400 hover:text-white transition-colors group">
            <ArrowLeft size={18} className="transition-transform group-hover:-translate-x-1" />
            <div className="flex items-center gap-2">
              <CloudGuardLogo className="h-7 w-auto flex-shrink-0 text-white fill-current invert dark:invert" />
              <span className="font-semibold text-white tracking-tight">CloudGuard</span>
            </div>
          </Link>
          <div className="flex items-center gap-4">
            <Link 
              to={ctaLink} 
              className="text-xs font-mono uppercase tracking-widest text-slate-300 hover:text-white px-4 py-2 border border-[#262626] hover:border-neutral-500 rounded-lg transition-colors"
            >
              {token ? 'Vault Dashboard' : 'Sign In'}
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        {/* Title Section */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-xs font-mono text-cyan-400 mb-4">
            <ShieldCheck size={14} />
            <span>Transparent, Zero-Surprise Cloud Storage</span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            Predictable Capacity. Uncompromised Security.
          </h1>
          <p className="text-base sm:text-lg text-neutral-400 leading-relaxed">
            Every plan includes our complete suite of zero-trust cryptography and real-time threat scanning. 
            Choose the capacity your vault demands.
          </p>

          {/* Billing Switch */}
          <div className="mt-8 inline-flex items-center p-1.5 rounded-xl bg-[#141414] border border-[#262626]">
            <button
              type="button"
              onClick={() => handleCycleChange('monthly')}
              className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all cursor-pointer ${
                billingCycle === 'monthly'
                  ? 'bg-neutral-800 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Monthly Billing
            </button>
            <button
              type="button"
              onClick={() => handleCycleChange('annual')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all cursor-pointer ${
                billingCycle === 'annual'
                  ? 'bg-cyan-500 text-black font-semibold shadow-sm shadow-cyan-500/30'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <span>Annual Billing</span>
              <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded ${
                billingCycle === 'annual' ? 'bg-black/20 text-black' : 'bg-cyan-500/20 text-cyan-400'
              }`}>
                Save ~20%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {tiers.map((plan) => {
            const expiresAtDate = (user?.subscription?.expiresAt || userSubData?.subscription?.expiresAt)
              ? new Date(user?.subscription?.expiresAt || userSubData?.subscription?.expiresAt)
              : null;
            const daysRemaining = expiresAtDate
              ? Math.ceil((expiresAtDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
              : 0;
            const renewalWindowDays = billingCycle === 'annual' ? 15 : 7;
            const isEligibleForRenewal =
              daysRemaining <= renewalWindowDays ||
              user?.subscription?.status === 'past_due' ||
              userSubStatus === 'past_due';

            const isCurrentPlanTier =
              (user?.plan === plan.tierId || userPlanId === plan.tierId) &&
              (user?.subscription?.billingCycle === billingCycle || userBillingCycle === billingCycle) &&
              (user?.subscription?.status === 'active' || userSubStatus === 'active');

            // Only lock the button if they are not eligible for renewal
            const isLockedCurrentPlan = isCurrentPlanTier && !isEligibleForRenewal;

            const preview = previews[plan.tierId];
            const isScheduledTarget =
              user?.subscription?.scheduledDowngrade?.targetPlanId === plan.tierId ||
              userSubData?.subscription?.scheduledDowngrade?.targetPlanId === plan.tierId;

            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl flex flex-col justify-between p-6 transition-all ${
                  plan.popular
                    ? 'bg-[#141414] border-2 border-cyan-500/80 shadow-xl shadow-cyan-500/10'
                    : 'bg-[#141414] border border-[#262626] hover:border-neutral-700'
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="px-3 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider font-semibold bg-cyan-400 text-black shadow-md shadow-cyan-500/30">
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div>
                  <div className="mb-4">
                    <h2 className="text-xl font-bold text-white tracking-tight">{plan.name}</h2>
                    <p className="text-xs text-neutral-400 mt-1 min-h-[32px]">{plan.tagline}</p>
                  </div>

                  <div className="py-4 border-y border-[#262626] mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">{plan.price}</span>
                      <span className="text-xs text-neutral-400 font-mono">{plan.periodText}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-cyan-400 font-mono font-medium">{plan.storage} Storage</span>
                      {billingCycle === 'annual' && plan.savings && (
                        <span className="text-emerald-400 font-mono">{plan.savings}</span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 mb-6">
                    <span className="text-[11px] font-mono uppercase text-neutral-500 tracking-wider">Included Capacity</span>
                    <ul className="space-y-2.5">
                      {plan.features.map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2.5 text-xs text-neutral-300">
                          <Check size={14} className="text-cyan-400 mt-0.5 shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Plan Action Button */}
                {plan.id === 'trial' ? (
                  ['tier_50gb', 'tier_100gb', 'tier_200gb'].includes(user?.plan || userPlanId) ? (
                    <button
                      disabled
                      type="button"
                      className="w-full py-2.5 rounded-xl text-xs font-semibold bg-neutral-900/60 text-neutral-500 border border-neutral-800 cursor-not-allowed flex items-center justify-center gap-1.5"
                    >
                      <span>Evaluation Completed</span>
                    </button>
                  ) : token ? (
                    <button
                      disabled={true}
                      type="button"
                      onClick={(e) => e.preventDefault()}
                      className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-center transition-all inline-flex items-center justify-center gap-2 bg-neutral-800 text-white border border-neutral-700 cursor-not-allowed opacity-75 select-none pointer-events-none"
                    >
                      <span>Active in Vault</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        sessionStorage.removeItem('cloudguard_pending_checkout');
                        navigate('/login?mode=signup');
                      }}
                      className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-center transition-all inline-flex items-center justify-center gap-2 cursor-pointer bg-neutral-800 text-white hover:bg-neutral-700"
                    >
                      <span>Start Free Trial</span>
                      <ArrowRight size={14} />
                    </button>
                  )
                ) : (() => {
                  if (isLockedCurrentPlan) {
                    return (
                      <button
                        disabled={true}
                        type="button"
                        onClick={(e) => e.preventDefault()}
                        className="w-full py-2.5 rounded-xl text-xs font-semibold bg-neutral-800/80 text-emerald-400 border border-emerald-500/30 cursor-not-allowed opacity-75 select-none pointer-events-none flex items-center justify-center gap-1.5"
                      >
                        <span>✓ Current Plan</span>
                      </button>
                    );
                  }

                  if (isScheduledTarget) {
                    return (
                      <button
                        disabled
                        type="button"
                        className="w-full py-2.5 rounded-xl text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30 cursor-default flex items-center justify-center gap-1.5"
                      >
                        <span>Scheduled on Expiry</span>
                      </button>
                    );
                  }

                  let ctaText = billingCycle === 'annual' ? `Get ${plan.name}` : `Upgrade to ${plan.name}`;
                  if (isCurrentPlanTier && isEligibleForRenewal) {
                    const priceDisplay = preview?.payableAmount ? `₹${preview.payableAmount}` : (billingCycle === 'annual' ? plan.annualPrice : plan.monthlyPrice);
                    const cycleDisplay = billingCycle === 'annual' ? '(+1 Year)' : '(+30 Days)';
                    ctaText = `Renew for ${priceDisplay} ${cycleDisplay}`;
                  } else if (preview) {
                    if (preview.transitionType === 'SCHEDULED_DOWNGRADE') {
                      ctaText = `Downgrade (₹0 Today)`;
                    } else if (preview.transitionType === 'RENEWAL_UPGRADE') {
                      ctaText = `Upgrade & Extend (₹${preview.payableAmount})`;
                    } else if (preview.transitionType === 'CYCLE_SWITCH_PREPAID') {
                      ctaText = `Switch to Monthly (₹${preview.payableAmount})`;
                    } else if (preview.transitionType === 'MONTHLY_UPGRADE') {
                      ctaText = `Upgrade for ₹${preview.payableAmount}`;
                    } else if (preview.transitionType === 'ANNUAL_UPGRADE') {
                      ctaText = `Upgrade for ₹${preview.payableAmount} (Prorated)`;
                    } else if (preview.transitionType === 'CYCLE_UPGRADE') {
                      ctaText = `Switch to Annual (₹${preview.payableAmount})`;
                    } else if (preview.transitionType === 'STACKED_RENEWAL') {
                      const cycleDisplay = billingCycle === 'annual' ? '(+1 Year)' : '(+30 Days)';
                      ctaText = `Renew for ₹${preview.payableAmount} ${cycleDisplay}`;
                    }
                  }

                  return (
                    <button
                      type="button"
                      disabled={loadingPlanId === plan.tierId}
                      onClick={() => handleSelectPlan(plan)}
                      className={`w-full py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                        plan.popular
                          ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-md'
                          : 'bg-neutral-800 hover:bg-neutral-700 text-white'
                      } disabled:opacity-50`}
                    >
                      {loadingPlanId === plan.tierId ? 'Processing...' : ctaText}
                    </button>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {/* Uniform Security Standard Section */}
        <section className="mb-16 bg-[#141414] border border-[#262626] rounded-2xl p-6 sm:p-8 lg:p-10">
          <div className="max-w-2xl mb-8">
            <span className="text-xs font-mono uppercase text-cyan-400 tracking-wider">Uniform Platform Standard</span>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mt-1">
              Enterprise Security Built Into Every Single Byte
            </h2>
            <p className="text-xs sm:text-sm text-neutral-400 mt-2 leading-relaxed">
              We never gate encryption protocols, bandwidth speeds, or malware scanning behind higher tiers. 
              The identical security architecture shields every account from Day 1.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {UNIFORM_SECURITY_FEATURES.map((item, idx) => {
              const Icon = item.icon;
              return (
                <div key={idx} className="p-5 rounded-xl bg-[#0a0a0a] border border-[#262626] flex flex-col justify-start">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-3">
                    <Icon size={16} />
                  </div>
                  <h3 className="text-sm font-semibold text-white mb-1.5">{item.title}</h3>
                  <p className="text-xs text-neutral-400 leading-relaxed">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Zero-Parking Policy Notice Box */}
        <section className="mb-16">
          <div className="p-6 sm:p-8 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex flex-col md:flex-row items-start gap-5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <AlertTriangle size={20} />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-semibold text-amber-300 tracking-tight">
                Zero Forever-Free Policy
              </h3>
              <p className="text-xs sm:text-sm text-amber-200/90 leading-relaxed">
                Unpaid vaults are never held indefinitely. Accounts that do not upgrade within the 14-day trial receive a 7-day read-only grace period to download assets before an automated, irreversible cryptographic purge to ₹0.00 storage cost.
              </p>
              <div className="pt-2 flex flex-wrap gap-4 text-xs font-mono text-amber-400/90">
                <Link to="/terms#section-2" className="hover:underline">Read Terms &amp; Conditions &rarr;</Link>
                <Link to="/refund-policy" className="hover:underline">Review Refund Policy &rarr;</Link>
              </div>
            </div>
          </div>
        </section>

        {/* Order Summary & Checkout Modal */}
        {orderSummaryPlan && (() => {
          const activeCycle = orderSummaryPlan.billingCycle || billingCycle;
          const matchedPlan = TIERS_CONFIG.find(
            (t) => t.tierId === orderSummaryPlan.plan.tierId || t.id === orderSummaryPlan.plan.id
          ) || orderSummaryPlan.plan;
          const baseCyclePrice =
            activeCycle === 'annual'
              ? Number(matchedPlan.annualPrice ?? 499)
              : Number(matchedPlan.monthlyPrice ?? 49);

          const preview = previews[`${matchedPlan.tierId}_${activeCycle}`] || (previews[matchedPlan.tierId]?.targetBillingCycle === activeCycle ? previews[matchedPlan.tierId] : null);
          const payableAmount = (preview && preview.payableAmount !== undefined)
            ? getCleanAmount(preview.payableAmount)
            : (orderSummaryPlan.payableAmount !== undefined && orderSummaryPlan.billingCycle === activeCycle)
              ? getCleanAmount(orderSummaryPlan.payableAmount)
              : baseCyclePrice;

          const formattedAmount = payableAmount.toLocaleString('en-IN');
          const isTransitionUpgrade = orderSummaryPlan.transitionType === 'ANNUAL_UPGRADE' || orderSummaryPlan.transitionType === 'MONTHLY_UPGRADE';

          return (
            <div 
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
              onClick={(e) => {
                if (e.target === e.currentTarget && !loadingPlanId && !isProcessingPayment) {
                  setOrderSummaryPlan(null);
                }
              }}
            >
              <div 
                className="w-full max-w-[520px] rounded-2xl bg-white dark:bg-[#141414] border border-neutral-200 dark:border-[#262626] p-5 shadow-2xl space-y-3.5 animate-in zoom-in-95 duration-150 text-left relative overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Modal Top Header */}
                <div className="flex items-center justify-between gap-4 pb-0.5 border-b border-neutral-200 dark:border-[#262626]">
                  <h2 className="text-base sm:text-lg font-bold text-neutral-900 dark:text-white tracking-tight">
                    Order Summary
                  </h2>
                  <button
                    type="button"
                    disabled={Boolean(loadingPlanId || isProcessingPayment)}
                    onClick={() => setOrderSummaryPlan(null)}
                    className="text-neutral-400 hover:text-neutral-700 dark:hover:text-white p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition-colors cursor-pointer disabled:opacity-50"
                    aria-label="Close modal"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Plan Summary Row */}
                <div className="rounded-xl bg-neutral-50 dark:bg-[#1a1a1a] border border-neutral-200 dark:border-[#2a2a2a] p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold text-neutral-900 dark:text-white tracking-tight truncate">
                          {orderSummaryPlan.plan.name}
                        </h3>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider font-semibold bg-neutral-200 dark:bg-[#242424] text-neutral-800 dark:text-[#F5F5F4] border border-neutral-300 dark:border-neutral-700 shrink-0">
                          {orderSummaryPlan.transitionType === 'SCHEDULED_DOWNGRADE' 
                            ? 'SCHEDULED ON EXPIRY' 
                            : activeCycle === 'annual' 
                              ? 'ANNUAL (1-TIME)' 
                              : 'MONTHLY (1-TIME)'}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 truncate">
                        <span className="text-neutral-800 dark:text-[#F5F5F4] font-medium">
                          {(orderSummaryPlan.plan.quota || orderSummaryPlan.plan.storage || 'Storage Quota').replace(/ Encrypted Allocation/g, '')}
                        </span>{' '}
                        Encrypted Allocation
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xl font-bold text-neutral-900 dark:text-[#F5F5F4] font-mono">
                        ₹{formattedAmount}
                      </span>
                      <span className="text-xs text-neutral-500 dark:text-neutral-400 block font-mono">
                        {orderSummaryPlan.transitionType === 'SCHEDULED_DOWNGRADE' 
                          ? 'due today' 
                          : activeCycle === 'annual' 
                            ? '/yr' 
                            : '/mo'}
                      </span>
                    </div>
                  </div>

                  {/* Line Items Breakdown */}
                  <div className="space-y-1.5 text-xs pt-2 border-t border-neutral-200 dark:border-[#2a2a2a]">
                    <div className="flex items-center justify-between py-0.5 text-neutral-700 dark:text-neutral-300">
                      <span className="text-neutral-500 dark:text-neutral-400">
                        {isTransitionUpgrade 
                          ? 'Prorated Plan Upgrade' 
                          : 'Base Storage Subscription'}
                      </span>
                      <span className="font-mono text-neutral-900 dark:text-[#F5F5F4] font-medium">
                        ₹{formattedAmount}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-0.5 text-neutral-700 dark:text-neutral-300">
                      <span className="text-neutral-500 dark:text-neutral-400">Egress Bandwidth &amp; Threats Engine</span>
                      <span className="font-mono text-neutral-900 dark:text-[#F5F5F4] font-medium">Included (₹0)</span>
                    </div>
                    <div className="flex items-center justify-between py-0.5 text-neutral-700 dark:text-neutral-300">
                      <span className="text-neutral-500 dark:text-neutral-400">Taxes (GST / Gateway)</span>
                      <span className="font-mono text-neutral-500 dark:text-neutral-400">Inclusive</span>
                    </div>

                    <div className="pt-2.5 border-t border-neutral-200 dark:border-[#2a2a2a] flex items-baseline justify-between">
                      <div>
                        <span className="text-sm font-bold text-neutral-900 dark:text-white tracking-tight">Total Due Today</span>
                        <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block">Currency in INR (₹)</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xl font-extrabold text-neutral-900 dark:text-[#F5F5F4] tracking-tight font-mono">
                          ₹{formattedAmount}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Policy Disclosures Box */}
                <ul className="rounded-xl bg-neutral-100/80 dark:bg-[#181818] border border-neutral-200 dark:border-[#262626] p-3 text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400 space-y-1 list-disc pl-5 marker:text-neutral-400 dark:marker:text-neutral-500">
                  <li>
                    <strong className="text-neutral-900 dark:text-[#F5F5F4] font-semibold">Digital Provisioning:</strong> Storage quota is electronically allocated immediately upon payment confirmation.
                  </li>
                  <li>
                    <strong className="text-neutral-900 dark:text-[#F5F5F4] font-semibold">Refund Policy:</strong>{' '}
                    Annual plans are eligible for a full refund within <strong className="text-neutral-900 dark:text-[#F5F5F4] font-semibold">7 calendar days</strong> of purchase as long as your total storage never crosses <strong className="text-neutral-900 dark:text-[#F5F5F4] font-semibold">2 GB</strong> at any point (exceeding <strong className="text-neutral-900 dark:text-[#F5F5F4] font-semibold">2 GB</strong> permanently disables refund eligibility, even if you delete files later). Monthly plans are non-refundable.
                  </li>
                </ul>

                {/* Inline Error Banner */}
                {paymentError && (
                  <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs leading-relaxed flex items-start gap-2.5 animate-in fade-in duration-200">
                    <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
                    <span>{paymentError}</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-col-reverse sm:flex-row items-center gap-2.5 pt-0.5">
                  <button
                    type="button"
                    disabled={Boolean(loadingPlanId)}
                    onClick={() => executeCheckout(orderSummaryPlan.plan)}
                    className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-[#F5F5F4] hover:bg-[#E7E5E4] active:scale-[0.99] text-neutral-950 border border-neutral-300 dark:border-transparent font-semibold text-xs shadow-sm transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {loadingPlanId ? 'Initializing...' : orderSummaryPlan.transitionType === 'SCHEDULED_DOWNGRADE' ? 'Confirm Scheduled Downgrade' : 'Proceed to Secure Checkout'}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(loadingPlanId)}
                    onClick={() => setOrderSummaryPlan(null)}
                    className="w-full sm:w-auto py-2.5 px-5 rounded-xl bg-neutral-200 hover:bg-neutral-300 dark:bg-[#242424] dark:hover:bg-[#2e2e2e] text-neutral-800 dark:text-neutral-200 font-medium text-xs transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </main>

      {/* Universal Footer */}
      <Footer />
      <Toaster position="bottom-right" reverseOrder={false} />
    </div>
  );
}
