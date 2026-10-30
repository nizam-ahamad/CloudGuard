import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Scale, AlignLeft, ChevronRight } from 'lucide-react';
import CloudGuardLogo from '../CloudGuardLogo';

export default function TermsOfService() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const scrollToSection = (e, id) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
      window.history.pushState(null, '', `#${id}`);
    }
  };

  const navItems = [
    { id: 'section-1', num: '01', title: 'Acceptance of Terms' },
    { id: 'section-2', num: '02', title: 'Acceptable Use Policy' },
    { id: 'section-3', num: '03', title: 'Disclaimer of Warranties' },
    { id: 'section-4', num: '04', title: 'Limitation of Liability' },
    { id: 'section-5', num: '05', title: 'Account Termination' },
    { id: 'section-6', num: '06', title: 'Modifications to Terms' },
  ];

  return (
    <div className="min-h-screen bg-black text-neutral-300 font-sans selection:bg-neutral-800 selection:text-white">
      {/* Top Header / Breadcrumb */}
      <header className="w-full border-b border-neutral-900 bg-black/60 backdrop-blur-md sticky top-0 z-50">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-3 text-neutral-400 hover:text-white transition-colors group">
            <ArrowLeft size={18} className="transition-transform group-hover:-translate-x-1" />
            <div className="flex items-center gap-2">
              <CloudGuardLogo className="h-7 w-auto flex-shrink-0 text-white fill-current invert dark:invert" />
              <span className="font-semibold text-white tracking-tight">CloudGuard</span>
            </div>
          </Link>
          <Link 
            to="/privacy" 
            className="text-xs font-mono text-neutral-400 hover:text-white transition-colors border border-neutral-800 px-3 py-1.5 rounded hover:border-neutral-700 flex items-center gap-1.5"
          >
            <span>Privacy Policy</span>
            <span>&rarr;</span>
          </Link>
        </div>
      </header>

      {/* Main Container */}
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        {/* Document Header */}
        <div className="mb-10 lg:mb-12 border-b border-neutral-900 pb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-800 bg-neutral-900/60 text-xs md:text-sm font-mono text-neutral-400 mb-4">
            <Scale size={14} className="text-purple-400" />
            <span>Legal Documentation</span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold md:font-extrabold tracking-tight text-white mb-3">
            Terms of Service
          </h1>
          <p className="text-sm md:text-base font-mono text-neutral-500">
            Last Updated: October 2026
          </p>
        </div>

        {/* Two-Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Left Column: Sticky Sidebar (Desktop Only) */}
          <aside className="hidden lg:block lg:col-span-4 sticky top-24 space-y-6">
            {/* Quick Navigation (Table of Contents) */}
            <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-6 backdrop-blur-sm">
              <div className="flex items-center gap-2.5 text-white font-semibold text-sm mb-4 pb-3 border-b border-neutral-800/80">
                <AlignLeft size={16} className="text-purple-400" />
                <span>On This Page</span>
              </div>
              <nav className="space-y-1">
                {navItems.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    onClick={(e) => scrollToSection(e, item.id)}
                    className="text-sm text-neutral-400 hover:text-white hover:translate-x-1 transition-all py-1.5 flex items-center justify-between group rounded-lg px-2 hover:bg-neutral-800/40"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-neutral-500 group-hover:text-neutral-400">{item.num}</span>
                      <span>{item.title}</span>
                    </span>
                    <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity text-neutral-500" />
                  </a>
                ))}
              </nav>
            </div>

            {/* Companion Legal Page Link */}
            <Link
              to="/privacy"
              className="flex items-center justify-between px-5 py-3 rounded-xl bg-neutral-900/40 hover:bg-neutral-800/60 border border-neutral-800/80 hover:border-neutral-700 text-sm text-neutral-400 hover:text-white transition-all group backdrop-blur-sm"
            >
              <span>View Privacy Policy</span>
              <span className="text-neutral-500 group-hover:text-neutral-300 transition-transform group-hover:translate-x-1">&rarr;</span>
            </Link>

            {/* Action Button */}
            <Link
              to="/"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-neutral-900/80 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-neutral-800 hover:border-neutral-700 font-medium text-sm transition-all group"
            >
              <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-1" />
              <span>Return to CloudGuard Vault</span>
            </Link>
          </aside>

          {/* Right Column: Content Cards (Fills Remaining Width) */}
          <main className="lg:col-span-8 space-y-6">
            {/* Section 1 */}
            <section id="section-1" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  01
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Acceptance of Terms</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                By accessing or using CloudGuard Vault (&ldquo;the Service&rdquo;), you acknowledge that you have read, understood, and agree to be bound by these Terms of Service. CloudGuard Vault is engineered and provided primarily as an advanced demonstration and portfolio architecture showcasing real-time AI malware scanning and zero-trust cloud file storage. If you do not agree to these terms, do not access or use the application.
              </p>
            </section>

            {/* Section 2 */}
            <section id="section-2" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  02
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Acceptable Use Policy</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                You agree to use CloudGuard strictly for legitimate file management, streaming, and testing purposes. You expressly agree not to:
              </p>
              <ul className="list-disc list-inside space-y-2.5 pl-2 text-neutral-400 text-sm sm:text-base">
                <li>Intentionally upload, store, or distribute illegal content, unlawful material, or zero-day weaponized exploits.</li>
                <li>Deploy automated bots, denial-of-service vectors, or brute-force scripts intended to degrade or impair the host servers or S3 infrastructure.</li>
                <li>Attempt to reverse-engineer, bypass, or tamper with API authentication, token validation, or S3 pre-signed security constraints.</li>
                <li>Circumvent storage quota limitations or abuse server-side scanning services.</li>
              </ul>
            </section>

            {/* Section 3 */}
            <section id="section-3" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  03
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Disclaimer of Warranties (&ldquo;As Is&rdquo;)</h2>
              </div>
              <div className="p-5 md:p-6 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200/90 text-sm lg:text-base leading-relaxed space-y-3">
                <div className="flex items-center gap-2 text-amber-400 font-mono text-xs md:text-sm uppercase tracking-wider font-semibold">
                  <AlertTriangle size={16} />
                  <span>Notice to Users</span>
                </div>
                <p className="font-medium text-amber-100">
                  THE SERVICE AND ITS INTEGRATED MACHINE LEARNING MALWARE DETECTION HEURISTICS ARE PROVIDED STRICTLY ON AN &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; BASIS WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED.
                </p>
                <p className="text-amber-200/80 text-xs sm:text-sm">
                  While our static analysis models and threat checks significantly reduce exposure to malicious binaries, CloudGuard does NOT guarantee 100% detection of all zero-day malware, sophisticated evasion techniques, or uncorrupted storage persistence, nor does it guarantee uninterrupted uptime.
                </p>
              </div>
            </section>

            {/* Section 4 */}
            <section id="section-4" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  04
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Limitation of Liability</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                Under no circumstances shall CloudGuard, its maintainers, or its affiliates be liable for any direct, indirect, incidental, special, consequential, or punitive damages resulting from the use of, or inability to use, this demonstration service. This includes, without limitation, loss of data, file corruption, transmission interruptions, or business disruptions. Users are strongly advised to maintain secondary offline backups of all essential documents.
              </p>
            </section>

            {/* Section 5 */}
            <section id="section-5" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  05
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Account Termination &amp; Payload Quarantine</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                We reserve the right to immediately suspend, throttle, or terminate any user account, delete suspicious file objects, or restrict upload capabilities at our sole discretion, without prior notice, if abusive upload behaviors, automated spamming, or attacks against the platform infrastructure are detected.
              </p>
            </section>

            {/* Section 6 */}
            <section id="section-6" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  06
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Modifications to Terms</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                We may revise these Terms of Service periodically to reflect infrastructure modifications, new capabilities, or legal compliance updates. Continued use of CloudGuard Vault following any posted changes constitutes full acceptance of the updated terms.
              </p>
            </section>
          </main>
        </div>
      </div>

      {/* Footer */}
      <footer className="w-full py-8 border-t border-neutral-900 bg-black text-center text-xs font-mono text-neutral-600">
        &copy; 2026 CloudGuard Vault. All rights reserved.
      </footer>
    </div>
  );
}
