import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, Lock, Database, Server, AlignLeft, ChevronRight } from 'lucide-react';
import CloudGuardLogo from '../CloudGuardLogo';

export default function PrivacyPolicy() {
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
    { id: 'section-1', num: '01', title: 'Overview' },
    { id: 'section-2', num: '02', title: 'Data Collected' },
    { id: 'section-3', num: '03', title: 'Third-Party Processing' },
    { id: 'section-4', num: '04', title: 'Data Ownership & Retention' },
    { id: 'section-5', num: '05', title: 'Security Architecture' },
    { id: 'section-6', num: '06', title: 'Contact & Inquiries' },
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
            to="/terms" 
            className="text-xs font-mono text-neutral-400 hover:text-white transition-colors border border-neutral-800 px-3 py-1.5 rounded hover:border-neutral-700 flex items-center gap-1.5"
          >
            <span>Terms of Service</span>
            <span>&rarr;</span>
          </Link>
        </div>
      </header>

      {/* Main Container */}
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        {/* Document Header */}
        <div className="mb-10 lg:mb-12 border-b border-neutral-900 pb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-800 bg-neutral-900/60 text-xs md:text-sm font-mono text-neutral-400 mb-4">
            <Shield size={14} className="text-emerald-400" />
            <span>Legal Documentation</span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold md:font-extrabold tracking-tight text-white mb-3">
            Privacy Policy
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
                <AlignLeft size={16} className="text-emerald-400" />
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
              to="/terms"
              className="flex items-center justify-between px-5 py-3 rounded-xl bg-neutral-900/40 hover:bg-neutral-800/60 border border-neutral-800/80 hover:border-neutral-700 text-sm text-neutral-400 hover:text-white transition-all group backdrop-blur-sm"
            >
              <span>View Terms of Service</span>
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
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Overview</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                CloudGuard Vault (&ldquo;CloudGuard&rdquo;, &ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) is an encrypted cloud storage demonstration platform featuring real-time AI threat scanning and zero-trust file management. We are committed to protecting your personal data and ensuring transparent practices regarding the collection, use, and security of information processed through our service.
              </p>
            </section>

            {/* Section 2 */}
            <section id="section-2" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  02
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Data Collected</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                We collect and process minimal data necessary to provide and secure our storage platform:
              </p>
              <ul className="list-disc list-inside space-y-2.5 pl-2 text-neutral-400 text-sm sm:text-base">
                <li>
                  <strong className="text-neutral-200">Account Credentials:</strong> Your email address and securely hashed authentication credentials (passwords are processed with bcrypt and never stored in plain text). Stateless JWT tokens are utilized for session verification.
                </li>
                <li>
                  <strong className="text-neutral-200">File Payloads &amp; Metadata:</strong> Uploaded file contents, file names, file sizes, MIME types, parent folder associations, and upload timestamps needed to organize and present your vault.
                </li>
                <li>
                  <strong className="text-neutral-200">Security Inspection Logs:</strong> High-level heuristic scan summaries, PE static analysis scores, and entropy evaluation flags generated during pre-ingestion screening.
                </li>
              </ul>
            </section>

            {/* Section 3 */}
            <section id="section-3" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  03
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Third-Party Processing &amp; Infrastructure</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                To maintain high-assurance isolation and threat detection, CloudGuard integrates with dedicated cloud infrastructure:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                <div className="p-4 md:p-5 bg-neutral-950/80 border border-neutral-800/80 rounded-xl space-y-2">
                  <Database size={20} className="text-blue-400 mb-1" />
                  <h3 className="text-sm font-semibold text-white">Amazon Web Services (AWS)</h3>
                  <p className="text-xs text-neutral-400 leading-normal">
                    Encrypted object persistence in isolated S3 buckets accessible only via ephemeral, short-lived pre-signed URLs.
                  </p>
                </div>
                <div className="p-4 md:p-5 bg-neutral-950/80 border border-neutral-800/80 rounded-xl space-y-2">
                  <Server size={20} className="text-purple-400 mb-1" />
                  <h3 className="text-sm font-semibold text-white">Python ML Microservice</h3>
                  <p className="text-xs text-neutral-400 leading-normal">
                    Pre-ingestion static inspection with optional automated VirusTotal API fallback verification for suspicious binary hashes.
                  </p>
                </div>
                <div className="p-4 md:p-5 bg-neutral-950/80 border border-neutral-800/80 rounded-xl space-y-2">
                  <Lock size={20} className="text-emerald-400 mb-1" />
                  <h3 className="text-sm font-semibold text-white">Google Apps Script</h3>
                  <p className="text-xs text-neutral-400 leading-normal">
                    Outbound transactional email delivery for one-time verification passwords (OTP) and password reset authorization tokens.
                  </p>
                </div>
              </div>
            </section>

            {/* Section 4 */}
            <section id="section-4" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  04
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Data Ownership &amp; Retention</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                You maintain complete ownership and intellectual property rights over all files and documents you upload to CloudGuard Vault. When you delete a file or folder from your dashboard, the corresponding object is permanently purged from our AWS S3 bucket and database indices without lingering residual copies.
              </p>
            </section>

            {/* Section 5 */}
            <section id="section-5" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  05
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Security Architecture</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                We enforce modern zero-trust security controls across the application lifecycle:
              </p>
              <ul className="list-disc list-inside space-y-2.5 pl-2 text-neutral-400 text-sm sm:text-base">
                <li>End-to-end HTTPS/TLS encryption for all client-to-server and server-to-S3 communications.</li>
                <li>No plain-text storage of user passwords or cloud provider master credentials.</li>
                <li>Strict tenant isolation ensuring accounts cannot query or access unauthorized object keys.</li>
                <li>Automatic quarantine of files exhibiting malicious static signatures before S3 persistence.</li>
              </ul>
            </section>

            {/* Section 6 */}
            <section id="section-6" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  06
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Contact &amp; Inquiries</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                If you have questions regarding this Privacy Policy or wish to request complete deletion of your account and associated objects, please submit an issue or inquiry via our official GitHub repository.
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
