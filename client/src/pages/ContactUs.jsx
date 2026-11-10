import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  Mail, 
  MapPin, 
  Clock, 
  Phone, 
  ShieldCheck, 
  Building2, 
  FileText 
} from 'lucide-react';
import CloudGuardLogo from '../CloudGuardLogo';

export default function ContactUs() {
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
              to="/pricing" 
              className="text-xs font-mono text-neutral-400 hover:text-white transition-colors border border-neutral-800 px-3 py-1.5 rounded hover:border-neutral-700"
            >
              Pricing &rarr;
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        {/* Document Header */}
        <div className="mb-12 pb-8 border-b border-[#262626] text-center max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-xs font-mono text-cyan-400 mb-4">
            <Building2 size={14} />
            <span>Official Entity Verification</span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mb-3">
            Contact &amp; Corporate Details
          </h1>
          <p className="text-sm sm:text-base text-neutral-400 leading-relaxed">
            Reach our customer operations desk, grievance redressal officer, or verify our legal merchant registration.
          </p>
        </div>

        {/* Contact Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {/* Support Channel */}
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-6 lg:p-8 space-y-4">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <Mail size={20} />
            </div>
            <div>
              <span className="text-xs font-mono uppercase text-neutral-500 tracking-wider">General Inquiries &amp; Billing</span>
              <h2 className="text-xl font-bold text-white tracking-tight mt-1">Customer Support</h2>
            </div>
            <p className="text-sm text-neutral-400 leading-relaxed">
              For subscription assistance, enterprise quota increases, invoice requests, or technical bug reports:
            </p>
            <div className="pt-2">
              <a 
                href="mailto:support@cloudguard.site" 
                className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-400 hover:text-cyan-300 transition-colors font-mono"
              >
                <span>support@cloudguard.site</span>
                <span>&rarr;</span>
              </a>
              <p className="text-xs text-neutral-500 mt-2 font-mono">
                Response SLA: 24 to 48 business hours
              </p>
            </div>
          </div>

          {/* Privacy & Grievances */}
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-6 lg:p-8 space-y-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <ShieldCheck size={20} />
            </div>
            <div>
              <span className="text-xs font-mono uppercase text-neutral-500 tracking-wider">Statutory Grievance Mechanism</span>
              <h2 className="text-xl font-bold text-white tracking-tight mt-1">Privacy &amp; DPDP Desk</h2>
            </div>
            <p className="text-sm text-neutral-400 leading-relaxed">
              Designated Grievance Redressal Officer under the Digital Personal Data Protection (DPDP) Act and SPDI Rules:
            </p>
            <div className="pt-2">
              <a 
                href="mailto:privacy@cloudguard.site" 
                className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition-colors font-mono"
              >
                <span>privacy@cloudguard.site</span>
                <span>&rarr;</span>
              </a>
              <p className="text-xs text-neutral-500 mt-2 font-mono">
                Statutory SLA: Resolved within 15 business days
              </p>
            </div>
          </div>

          {/* Business Hours & Helpline */}
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-6 lg:p-8 space-y-4">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Clock size={20} />
            </div>
            <div>
              <span className="text-xs font-mono uppercase text-neutral-500 tracking-wider">Availability</span>
              <h2 className="text-xl font-bold text-white tracking-tight mt-1">Operating Hours</h2>
            </div>
            <div className="space-y-3 text-sm text-neutral-300">
              <div className="flex items-center justify-between py-1 border-b border-[#262626]">
                <span className="text-neutral-400">Support Desk</span>
                <span className="font-mono text-white">Monday – Friday</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-[#262626]">
                <span className="text-neutral-400">Standard Timings</span>
                <span className="font-mono text-white">9:00 AM – 6:00 PM IST</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-neutral-400">Helpline</span>
                <span className="font-mono text-neutral-400">+91-XXXXXXXXXX</span>
              </div>
            </div>
          </div>

          {/* Registered Office */}
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-6 lg:p-8 space-y-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <MapPin size={20} />
            </div>
            <div>
              <span className="text-xs font-mono uppercase text-neutral-500 tracking-wider">Principal Business Place</span>
              <h2 className="text-xl font-bold text-white tracking-tight mt-1">Registered Office</h2>
            </div>
            <div className="text-sm text-neutral-300 space-y-1 leading-relaxed">
              <p className="font-semibold text-white">Operating Entity: CloudGuard</p>
              <p>House No. 120, Main Market, Ward No. 3,</p>
              <p>Shaktifarm, Udham Singh Nagar,</p>
              <p>Uttarakhand - 263151, India</p>
            </div>
            <p className="text-xs text-neutral-500 pt-2 font-mono">
              Official merchant registration address for Razorpay &amp; Stripe compliance.
            </p>
          </div>
        </div>

        {/* Quick Links Banner */}
        <div className="p-6 rounded-2xl bg-[#141414] border border-[#262626] flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FileText size={20} className="text-cyan-400 shrink-0" />
            <span className="text-sm text-neutral-300">
              Need comprehensive policy frameworks? View our governing legal contracts.
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link to="/terms" className="text-xs font-mono text-cyan-400 hover:underline">Terms &rarr;</Link>
            <span className="text-neutral-700">•</span>
            <Link to="/privacy" className="text-xs font-mono text-cyan-400 hover:underline">Privacy &rarr;</Link>
            <span className="text-neutral-700">•</span>
            <Link to="/refund-policy" className="text-xs font-mono text-cyan-400 hover:underline">Refunds &rarr;</Link>
          </div>
        </div>
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

