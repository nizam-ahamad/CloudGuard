import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  RotateCcw, 
  Clock, 
  CreditCard, 
  AlertCircle, 
  Mail, 
  CheckCircle2 
} from 'lucide-react';
import CloudGuardLogo from '../CloudGuardLogo';
import Footer from '../components/Footer';

export default function RefundPolicy() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

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
          <div className="flex items-center gap-3">
            <Link 
              to="/terms" 
              className="text-xs font-mono text-neutral-400 hover:text-white transition-colors border border-neutral-800 px-3 py-1.5 rounded hover:border-neutral-700"
            >
              Terms of Service &rarr;
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        {/* Document Header */}
        <div className="mb-10 pb-8 border-b border-[#262626]">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-xs font-mono text-cyan-400 mb-4">
            <RotateCcw size={14} />
            <span>Billing &amp; Consumer Protection</span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mb-3">
            Cancellation &amp; Refund Policy
          </h1>
          <p className="text-sm font-mono text-neutral-500">
            Last Updated: November 2026
          </p>
        </div>

        {/* Content Cards */}
        <div className="space-y-8">
          {/* Section 1: Digital Delivery Notice */}
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-6 lg:p-8 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <CheckCircle2 size={16} />
              </div>
              <h2 className="text-lg lg:text-xl font-bold text-white tracking-tight">
                1. Immediate Digital Provisioning
              </h2>
            </div>
            <p className="text-sm sm:text-base text-neutral-300 leading-relaxed">
              CloudGuard is a cloud-based software-as-a-service (SaaS) platform providing digital storage, cryptographic security, and automated malware analysis. Because digital quota allocations and server infrastructure are provisioned electronically and instantly upon payment confirmation, standard physical return policies do not apply.
            </p>
          </div>

          {/* Section 2: Subscription Cancellation */}
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-6 lg:p-8 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Clock size={16} />
              </div>
              <h2 className="text-lg lg:text-xl font-bold text-white tracking-tight">
                2. Subscription Cancellation
              </h2>
            </div>
            <p className="text-sm sm:text-base text-neutral-300 leading-relaxed">
              You may cancel your recurring subscription at any time directly through your account dashboard or by contacting customer support:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm sm:text-base text-neutral-400 pl-2">
              <li>
                <strong className="text-neutral-200">Active Access:</strong> Upon cancellation, your account remains active at your current tier with full quota access until the end of the prepaid billing cycle.
              </li>
              <li>
                <strong className="text-neutral-200">Auto-Renewal Prevention:</strong> Cancelling stops all future automated renewals (UPI AutoPay, Credit/Debit card recurring charges) with zero cancellation fees.
              </li>
              <li>
                <strong className="text-neutral-200">7-Day Post-Expiry Grace:</strong> Following the end of the billing term, you receive a 7-day read-only grace period to download all stored assets before automated cryptographic deletion.
              </li>
            </ul>
          </div>

          {/* Section 3: Refund Eligibility */}
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-6 lg:p-8 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <CreditCard size={16} />
              </div>
              <h2 className="text-lg lg:text-xl font-bold text-white tracking-tight">
                3. Refund Eligibility &amp; Exceptions
              </h2>
            </div>
            <p className="text-sm sm:text-base text-neutral-300 leading-relaxed">
              To balance fair consumer protection with server resource commitment:
            </p>
            <div className="space-y-3 text-sm sm:text-base text-neutral-400">
              <div className="p-4 rounded-xl bg-[#0a0a0a] border border-[#262626]">
                <strong className="text-white block mb-1">Annual Subscriptions (7-Day Review Window &amp; Hard 2 GB Peak Storage Cap):</strong>
                First-time annual subscription purchases are eligible for a full refund review within seven (7) calendar days of initial purchase only if peak storage utilization has never exceeded 2 GB at any point during those 7 days. Exceeding 2 GB permanently disables refund eligibility for that subscription, even if files are subsequently deleted to bring current usage below 2 GB.
              </div>
              <div className="p-4 rounded-xl bg-[#0a0a0a] border border-[#262626]">
                <strong className="text-white block mb-1">Monthly Billing &amp; Recurring Renewals:</strong>
                Monthly recurring subscription cycles, consumed storage bandwidth, and renewal charges are non-refundable once activated.
              </div>
              <div className="p-4 rounded-xl bg-[#0a0a0a] border border-[#262626]">
                <strong className="text-white block mb-1">Exceptional Technical Failures:</strong>
                If platform service unavailability or documented system outages prevent file access for more than 48 continuous hours, users may request a prorated credit by contacting support.
              </div>
            </div>
          </div>

          {/* Section 4: Settlement Window (Mandatory Gateway Requirement) */}
          <div className="p-6 lg:p-8 bg-cyan-500/10 border border-cyan-500/30 rounded-2xl space-y-3">
            <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs uppercase tracking-wider font-semibold">
              <AlertCircle size={16} />
              <span>Mandatory Gateway Processing &amp; Settlement Window</span>
            </div>
            <p className="text-sm sm:text-base text-cyan-200/90 leading-relaxed font-medium">
              Approved refunds are processed and credited back to the customer's original payment method within 5 to 7 business days, subject to the issuing bank's clearing cycle.
            </p>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Refunds are issued through our PCI-DSS Level 1 certified processors (Cashfree Payments) directly to the source bank account, credit card, or UPI VPA used during purchase. CloudGuard does not issue cash or third-party transfer refunds.
            </p>
          </div>

          {/* Section 5: Initiating a Refund Request */}
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-6 lg:p-8 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Mail size={16} />
              </div>
              <h2 className="text-lg lg:text-xl font-bold text-white tracking-tight">
                4. How to Request a Refund
              </h2>
            </div>
            <p className="text-sm sm:text-base text-neutral-300 leading-relaxed">
              To submit a cancellation or refund inquiry:
            </p>
            <ol className="list-decimal list-inside space-y-2 text-sm sm:text-base text-neutral-400 pl-2">
              <li>Send an email to <a href="mailto:support@cloudguard.site" className="text-cyan-400 hover:underline font-mono">support@cloudguard.site</a> from your registered account email.</li>
              <li>Include your <strong>Account Email</strong>, <strong>Transaction Reference ID</strong>, and date of purchase.</li>
              <li>Provide a brief description of the technical issue or reason for the request.</li>
            </ol>
            <p className="text-xs text-neutral-500 pt-2 font-mono">
              Inquiries are acknowledged within 24 to 48 business hours with an official case reference number.
            </p>
          </div>
        </div>
      </main>

      {/* Universal Footer */}
      <Footer />
    </div>
  );
}

