import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  Check, 
  ShieldCheck, 
  Zap, 
  Lock, 
  HardDrive, 
  AlertTriangle,
  ArrowRight
} from 'lucide-react';
import CloudGuardLogo from '../CloudGuardLogo';

export default function Pricing() {
  const [billingCycle, setBillingCycle] = useState('annual'); // 'monthly' | 'annual'
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  const ctaLink = token ? '/dashboard' : '/login';

  const tiers = [
    {
      id: 'trial',
      name: '14-Day Trial',
      tagline: 'Evaluation & security testing',
      storage: '5 GB',
      monthlyPrice: '₹0',
      annualPrice: '₹0',
      periodText: 'for 14 days',
      savings: null,
      badge: 'Evaluation',
      ctaText: token ? 'Active in Vault' : 'Start Free Trial',
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
      name: 'Essential Vault',
      tagline: 'For individuals & personal archives',
      storage: '50 GB',
      monthlyPrice: '₹49',
      annualPrice: '₹499',
      periodText: billingCycle === 'annual' ? '/year (~₹41.58/mo)' : '/month',
      savings: 'Save 15%',
      badge: null,
      ctaText: token ? 'Upgrade to Essential' : 'Get Started',
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
      name: 'Pro Vault',
      tagline: 'For power users & professionals',
      storage: '100 GB',
      monthlyPrice: '₹99',
      annualPrice: '₹999',
      periodText: billingCycle === 'annual' ? '/year (~₹83.25/mo)' : '/month',
      savings: 'Save ~17%',
      badge: 'Most Popular',
      ctaText: token ? 'Upgrade to Pro' : 'Get Started',
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
      name: 'Ultra Vault',
      tagline: 'Maximum headroom for large datasets',
      storage: '200 GB',
      monthlyPrice: '₹189',
      annualPrice: '₹1,899',
      periodText: billingCycle === 'annual' ? '/year (~₹158.25/mo)' : '/month',
      savings: 'Save ~16%',
      badge: 'Maximum Headroom',
      ctaText: token ? 'Upgrade to Ultra' : 'Get Started',
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

  const uniformSecurityFeatures = [
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
              onClick={() => setBillingCycle('monthly')}
              className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                billingCycle === 'monthly'
                  ? 'bg-neutral-800 text-white shadow-sm'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Monthly (UPI AutoPay / Card)
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle('annual')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                billingCycle === 'annual'
                  ? 'bg-cyan-500 text-black font-semibold shadow-sm shadow-cyan-500/30'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              <span>Annual (1-Time UPI / NetBanking)</span>
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
          {tiers.map((tier) => {
            const price = billingCycle === 'annual' ? tier.annualPrice : tier.monthlyPrice;

            return (
              <div
                key={tier.id}
                className={`relative rounded-2xl flex flex-col justify-between p-6 transition-all ${
                  tier.popular
                    ? 'bg-[#141414] border-2 border-cyan-500/80 shadow-xl shadow-cyan-500/10'
                    : 'bg-[#141414] border border-[#262626] hover:border-neutral-700'
                }`}
              >
                {tier.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="px-3 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider font-semibold bg-cyan-400 text-black shadow-md shadow-cyan-500/30">
                      {tier.badge}
                    </span>
                  </div>
                )}

                <div>
                  <div className="mb-4">
                    <h2 className="text-xl font-bold text-white tracking-tight">{tier.name}</h2>
                    <p className="text-xs text-neutral-400 mt-1 min-h-[32px]">{tier.tagline}</p>
                  </div>

                  <div className="py-4 border-y border-[#262626] mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">{price}</span>
                      <span className="text-xs text-neutral-400 font-mono">{tier.periodText}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-cyan-400 font-mono font-medium">{tier.storage} Storage</span>
                      {billingCycle === 'annual' && tier.savings && (
                        <span className="text-emerald-400 font-mono">{tier.savings}</span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 mb-6">
                    <span className="text-[11px] font-mono uppercase text-neutral-500 tracking-wider">Included Capacity</span>
                    <ul className="space-y-2.5">
                      {tier.features.map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2.5 text-xs text-neutral-300">
                          <Check size={14} className="text-cyan-400 mt-0.5 shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <Link
                  to={ctaLink}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-center transition-all inline-flex items-center justify-center gap-2 cursor-pointer ${
                    tier.popular
                      ? 'bg-cyan-400 text-black hover:bg-cyan-300 shadow-md shadow-cyan-500/20'
                      : 'bg-neutral-800 text-white hover:bg-neutral-700'
                  }`}
                >
                  <span>{tier.ctaText}</span>
                  <ArrowRight size={14} />
                </Link>
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
            {uniformSecurityFeatures.map((item, idx) => {
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
      </main>

      {/* Universal Footer */}
      <footer className="w-full py-8 border-t border-neutral-900 bg-black text-center text-xs">
        <div className="flex flex-wrap justify-center gap-6 text-xs text-neutral-400 mb-4">
          <Link className="hover:text-white transition-colors" to="/pricing">Pricing</Link>
          <span>•</span>
          <Link className="hover:text-white transition-colors" to="/terms">Terms of Service</Link>
          <span>•</span>
          <Link className="hover:text-white transition-colors" to="/privacy">Privacy Policy</Link>
          <span>•</span>
          <Link className="hover:text-white transition-colors" to="/refund-policy">Refund Policy</Link>
          <span>•</span>
          <Link className="hover:text-white transition-colors" to="/contact">Contact Us</Link>
        </div>
        <p className="text-xs text-neutral-500">© 2026 CloudGuard. All rights reserved.</p>
      </footer>
    </div>
  );
}

