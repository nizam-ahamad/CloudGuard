import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
    monthlyPrice: '₹0',
    annualPrice: '₹0',
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
    monthlyPrice: '₹49',
    annualPrice: '₹499',
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
    monthlyPrice: '₹99',
    annualPrice: '₹999',
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
    monthlyPrice: '₹189',
    annualPrice: '₹1,899',
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
  const [billingCycle, setBillingCycle] = useState('annual'); // 'monthly' | 'annual'
  const [selectedPlan, setSelectedPlan] = useState(null);
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
    if (!user || user.plan === 'free') return;

    const fetchPreviews = async () => {
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
              }
            } catch (e) {
              // Silently ignore if preview fails for a tier
            }
          })
        );
        setPreviews(results);
      } catch (err) {
        console.error('Failed to load transition previews', err);
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

  const handleCloseModal = (e) => {
    if (e && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
    setSelectedPlan(null);
    setCheckoutNotice(false);
    setPaymentError('');
    setIsProcessingPayment(false);
  };

  // Dismiss modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleCloseModal(e);
      }
    };
    if (selectedPlan) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [selectedPlan]);

  const handleCycleChange = (cycle) => {
    setBillingCycle(cycle);
    if (selectedPlan) {
      const matched = TIERS_CONFIG.find((t) => t.id === selectedPlan.id);
      if (matched) {
        setSelectedPlan((prev) => ({
          ...prev,
          billingCycle: cycle,
          price: cycle === 'annual' ? matched.annualPrice : matched.monthlyPrice,
        }));
      }
    }
  };

  const handlePlanSelect = (tier) => {
    if (!tier) return;

    if (tier.id === 'trial') {
      if (token) {
        navigate('/dashboard');
      } else {
        navigate('/login');
      }
      return;
    }

    // Paid tier for unauthenticated users
    if (!token) {
      navigate('/login');
      return;
    }

    // Paid tier for authenticated users: Open Order Summary Modal
    try {
      setCheckoutNotice(false);
      setPaymentError('');
      const planPrice = billingCycle === 'annual' ? tier.annualPrice : tier.monthlyPrice;
      const storageGB = tier.id === 'ultra' ? 200 : (tier.id === 'pro' ? 100 : 50);
      setSelectedPlan({
        id: tier.id,
        tierId: tier.tierId,
        name: tier.name || 'Selected Plan',
        quota: tier.storage || tier.quota || 'Storage Quota',
        price: planPrice,
        storageGB: storageGB,
        annualPrice: tier.annualPrice,
        monthlyPrice: tier.monthlyPrice,
        billingCycle: billingCycle, // 'monthly' or 'annual'
      });
    } catch (err) {
      console.error('Failed to open order summary modal:', err);
    }
  };

  const handleSubscribe = async (plan) => {
    if (!plan) return;
    if (!user && !token) {
      navigate('/login');
      return;
    }

    const targetTierId = plan.tierId || (plan.id === 'essential' ? 'tier_50gb' : plan.id === 'pro' ? 'tier_100gb' : plan.id === 'ultra' ? 'tier_200gb' : plan.id);

    setLoadingPlanId(targetTierId);
    setIsProcessingPayment(true);
    setPaymentError('');

    try {
      const res = await api.post('/payments/create-order', {
        planId: targetTierId,
        billingCycle,
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
        // Refresh user profile data in context/state if available
        if (typeof refreshUser === 'function') refreshUser();
        setLoadingPlanId(null);
        setIsProcessingPayment(false);
        if (selectedPlan) setSelectedPlan(null);
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
              toast.success('Plan activated successfully!', {
                style: { background: '#18181b', color: '#fff', border: '1px solid #27272a' },
              });
              if (typeof refreshUser === 'function') refreshUser();
              navigate('/dashboard?view=settings');
            }
          } catch (vErr) {
            toast.error('Payment verification failed. Please contact support.');
          }
        }
        setLoadingPlanId(null);
        setIsProcessingPayment(false);
        if (selectedPlan) setSelectedPlan(null);
      });
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message || 'Failed to process plan change';
      toast.error(errMsg);
      setPaymentError(errMsg);
      setLoadingPlanId(null);
      setIsProcessingPayment(false);
    }
  };

  // Generate tier list with dynamic labels
  const tiers = TIERS_CONFIG.map((tier) => {
    const isAnnual = billingCycle === 'annual';
    const price = isAnnual ? tier.annualPrice : tier.monthlyPrice;

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
  const modalBillingBadge = billingCycle === 'annual' ? 'Annual (1-Time UPI)' : 'Monthly AutoPay';
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
            const isEligibleForRenewal = daysRemaining <= 5 || user?.subscription?.status === 'past_due' || userSubStatus === 'past_due';

            const isCurrentPlanTier =
              (user?.plan === plan.tierId || userPlanId === plan.tierId) &&
              (user?.subscription?.billingCycle === billingCycle || userBillingCycle === billingCycle) &&
              (user?.subscription?.status === 'active' || userSubStatus === 'active');

            // Only lock the button if they still have MORE than 5 days remaining
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
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigate(token ? '/dashboard' : '/login')}
                      className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-center transition-all inline-flex items-center justify-center gap-2 cursor-pointer bg-neutral-800 text-white hover:bg-neutral-700"
                    >
                      <span>{token ? 'Active in Vault' : 'Start Free Trial'}</span>
                      <ArrowRight size={14} />
                    </button>
                  )
                ) : (() => {
                  if (isLockedCurrentPlan) {
                    return (
                      <button
                        disabled
                        type="button"
                        className="w-full py-2.5 rounded-xl text-xs font-semibold bg-neutral-800/80 text-emerald-400 border border-emerald-500/30 cursor-default flex items-center justify-center gap-1.5"
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
                      onClick={() => handleSubscribe(plan)}
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
        {selectedPlan && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                handleCloseModal(e);
              }
            }}
          >
            <div 
              className="bg-[#141414] border border-[#262626] rounded-2xl w-full max-w-lg p-6 sm:p-7 shadow-2xl shadow-black/90 text-left relative overflow-hidden space-y-6 animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Top Header */}
              <div className="flex items-center justify-between gap-4 pb-4 border-b border-[#262626]">
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">Order Summary</h2>
                </div>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="text-neutral-400 hover:text-white p-1.5 rounded-lg hover:bg-neutral-800/60 transition-colors cursor-pointer"
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Plan Summary Row */}
              <div className="p-4 rounded-xl bg-[#0a0a0a] border border-[#262626] flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white tracking-tight">{modalPlanName}</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider font-semibold bg-cyan-400/10 text-cyan-400 border border-cyan-400/30">
                      {modalBillingBadge}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400 mt-1">
                    {modalQuota}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold text-white font-mono">{displayModalPrice}</span>
                  <span className="text-xs text-neutral-500 block font-mono">{modalPeriodSuffix}</span>
                </div>
              </div>

              {/* Line Items Breakdown */}
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between py-1 text-neutral-300">
                  <span className="text-neutral-400">Base Storage Subscription</span>
                  <span className="font-mono text-neutral-200">{displayModalPrice}</span>
                </div>
                <div className="flex items-center justify-between py-1 text-neutral-300">
                  <span className="text-neutral-400">Egress Bandwidth &amp; Threats Engine</span>
                  <span className="font-mono text-emerald-400">Included (₹0)</span>
                </div>
                <div className="flex items-center justify-between py-1 text-neutral-300">
                  <span className="text-neutral-400">Taxes (GST / Gateway)</span>
                  <span className="font-mono text-neutral-400">Inclusive</span>
                </div>

                <div className="pt-3 border-t border-[#262626] flex items-baseline justify-between">
                  <div>
                    <span className="text-sm font-bold text-white tracking-tight">Total Due Today</span>
                    <span className="text-[11px] text-neutral-500 block">Currency in INR (₹)</span>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-extrabold text-cyan-400 tracking-tight font-mono">{displayModalPrice}</span>
                  </div>
                </div>
              </div>

              {/* Compliance Disclosures */}
              <div className="p-3.5 rounded-xl bg-[#0a0a0a] border border-[#262626] space-y-1.5 text-[11px] text-neutral-400 leading-relaxed">
                <p className="flex items-start gap-1.5">
                  <span className="text-cyan-400 font-semibold">•</span>
                  <span><strong className="text-neutral-300">Digital Provisioning:</strong> Storage quota is electronically allocated immediately upon payment confirmation.</span>
                </p>
                <p className="flex items-start gap-1.5">
                  <span className="text-cyan-400 font-semibold">•</span>
                  <span><strong className="text-neutral-300">Refund Policy:</strong> Annual subscriptions are eligible for refund review within 7 calendar days per our terms.</span>
                </p>
              </div>

              {/* Inline Notification & Error Banners */}
              {checkoutNotice && (
                <div className="p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs leading-relaxed flex items-start gap-2.5 animate-in fade-in duration-200">
                  <Info size={16} className="text-cyan-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Merchant Gateway Verification:</strong> Production checkout is being enabled. Please check back shortly.
                  </span>
                </div>
              )}

              {paymentError && (
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs leading-relaxed flex items-start gap-2.5 animate-in fade-in duration-200">
                  <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                  <span>{paymentError}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <button
                  type="button"
                  disabled={isProcessingPayment}
                  onClick={() => handleSubscribe(selectedPlan)}
                  className="w-full sm:flex-1 py-3 px-4 rounded-xl text-xs font-semibold text-black bg-cyan-400 hover:bg-cyan-300 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer text-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isProcessingPayment ? 'Initializing Checkout...' : 'Proceed to Secure Checkout'}
                </button>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="w-full sm:w-auto py-3 px-5 rounded-xl text-xs font-medium text-neutral-300 hover:text-white bg-[#1f1f1f] hover:bg-[#2a2a2a] border border-[#2a2a2a] transition-colors cursor-pointer text-center"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Universal Footer */}
      <Footer />
      <Toaster position="bottom-right" reverseOrder={false} />
    </div>
  );
}
