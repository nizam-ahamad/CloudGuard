import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, Lock, Database, Server, AlignLeft, ChevronRight } from 'lucide-react';
import CloudGuardLogo from '../CloudGuardLogo';
import Footer from '../components/Footer';

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
    { id: 'section-1', num: '01', title: 'Overview & Commitment' },
    { id: 'section-2', num: '02', title: 'Information We Collect' },
    { id: 'section-3', num: '03', title: 'How We Use Information' },
    { id: 'section-4', num: '04', title: 'Storage & Security' },
    { id: 'section-5', num: '05', title: 'Third-Party Providers' },
    { id: 'section-6', num: '06', title: 'Cookies & Storage' },
    { id: 'section-7', num: '07', title: 'Data Rights & Retention' },
    { id: 'section-8', num: '08', title: 'Grievance & Contact' },
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
            Last Updated: November 2026
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
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Overview &amp; Commitment</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                CloudGuard (&ldquo;we&rdquo;, &ldquo;our&rdquo;) respects your digital privacy. This Privacy Policy outlines what information we collect, how it is secured, and how your personal data and files are processed when using <code className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-emerald-300">cloudguard.site</code>.
              </p>
            </section>

            {/* Section 2 */}
            <section id="section-2" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  02
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Information We Collect</h2>
              </div>
              <ul className="list-disc list-inside space-y-2.5 pl-2 text-neutral-400 text-sm sm:text-base">
                <li>
                  <strong className="text-neutral-200">Account Information:</strong> Name, email address, password hash (salted bcrypt/argon2), and OAuth profile identifiers (when authenticating via Google).
                </li>
                <li>
                  <strong className="text-neutral-200">Billing &amp; Transaction Data:</strong> Payment status, transaction ID, plan type, and billing address provided during checkout. All credit card, UPI, and net-banking transactions are processed directly by certified PCI-DSS Level 1 compliant payment gateways (Cashfree Payments); CloudGuard never stores card numbers, CVVs, or sensitive banking credentials on its servers.
                </li>
                <li>
                  <strong className="text-neutral-200">Vault Metadata:</strong> File names, file sizes, MIME types, directory structures, and storage utilization counters necessary to organize your vault.
                </li>
                <li>
                  <strong className="text-neutral-200">Security &amp; Telemetry Logs:</strong> IP addresses, browser user-agent strings, access timestamps, and session tokens used for rate limiting, threat prevention, and session validation.
                </li>
              </ul>
            </section>

            {/* Section 3 */}
            <section id="section-3" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  03
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">How We Use Your Information</h2>
              </div>
              <ul className="list-disc list-inside space-y-2.5 pl-2 text-neutral-400 text-sm sm:text-base">
                <li>To provision, maintain, and scale your personal cloud storage vault.</li>
                <li>To authenticate user sessions and prevent unauthorized access.</li>
                <li>To process subscription upgrades and generate verifiable payment invoices.</li>
                <li>To run automated anti-malware and cryptographic threat verification on uploaded files to protect system stability.</li>
                <li>We <strong className="text-neutral-200">never</strong> sell, rent, monetize, or broker your personal data or uploaded files to third-party data brokers or advertising networks.</li>
              </ul>
            </section>

            {/* Section 4 */}
            <section id="section-4" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  04
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">File Storage &amp; Security Architecture</h2>
              </div>
              <ul className="list-disc list-inside space-y-2.5 pl-2 text-neutral-400 text-sm sm:text-base">
                <li>
                  <strong className="text-neutral-200">Encryption in Transit:</strong> All communication between your client browser, our Node.js gateway, and storage clusters is enforced via Transport Layer Security (TLS 1.3).
                </li>
                <li>
                  <strong className="text-neutral-200">Storage Encryption:</strong> Files are stored using AES-256 server-side encryption across Backblaze B2 (S3-compatible encrypted object storage), with application and compute servers hosted on AWS EC2.
                </li>
                <li>
                  <strong className="text-neutral-200">Access Control:</strong> File access is restricted via short-lived, cryptographically signed URLs (HMAC SHA-256). Files cannot be indexed or crawled by search engine bots unless explicitly shared via public link.
                </li>
              </ul>
            </section>

            {/* Section 5 */}
            <section id="section-5" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  05
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Third-Party Services &amp; Data Processors</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                In compliance with Sections 5 and 16 of the Digital Personal Data Protection (DPDP) Act, 2023, the itemized schedule below identifies all third-party Data Processors engaged by CloudGuard:
              </p>
              <div className="mt-4 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="border-b border-neutral-800 bg-neutral-900/80 text-neutral-400">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Entity / Processor</th>
                      <th className="px-4 py-3 font-semibold">Purpose</th>
                      <th className="px-4 py-3 font-semibold">Processing Location</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/60 text-neutral-300">
                    <tr>
                      <td className="px-4 py-3 font-medium text-white">Amazon Web Services (AWS)</td>
                      <td className="px-4 py-3">Cloud compute &amp; application server hosting (EC2)</td>
                      <td className="px-4 py-3 text-emerald-400">Mumbai, India (ap-south-1)</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium text-white">Backblaze, Inc. (Backblaze B2)</td>
                      <td className="px-4 py-3">Encrypted zero-knowledge object storage</td>
                      <td className="px-4 py-3 text-cyan-400">Amsterdam, Netherlands (eu-central-003 / EU)</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium text-white">Cloudflare, Inc.</td>
                      <td className="px-4 py-3">CDN edge delivery, DDoS protection &amp; DNS routing</td>
                      <td className="px-4 py-3">Global Edge Network</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium text-white">Cashfree Payments India Pvt. Ltd.</td>
                      <td className="px-4 py-3">PCI-DSS Level 1 payment gateway &amp; subscription billing</td>
                      <td className="px-4 py-3 text-emerald-400">India</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium text-white">Google LLC</td>
                      <td className="px-4 py-3">Federated single sign-on (OAuth 2.0)</td>
                      <td className="px-4 py-3">United States / Global</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium text-white">Resend, Inc.</td>
                      <td className="px-4 py-3">Transactional OTP &amp; verification email routing</td>
                      <td className="px-4 py-3">United States</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3 font-medium text-white">Abuse.ch / CIRCL</td>
                      <td className="px-4 py-3">Cryptographic SHA-256 hash threat reputation lookup</td>
                      <td className="px-4 py-3">Switzerland / Luxembourg</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Section 6 */}
            <section id="section-6" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  06
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Cookies &amp; Client-Side Storage</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                CloudGuard uses local browser storage (<code className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-emerald-300">localStorage</code> / secure cookies) strictly for:
              </p>
              <ul className="list-disc list-inside space-y-2.5 pl-2 text-neutral-400 text-sm sm:text-base">
                <li>Preserving your active JWT authentication token across sessions.</li>
                <li>Storing theme preferences (Light/Dark mode) and interface layout states.</li>
                <li>We do not use third-party tracking or advertising cookies.</li>
              </ul>
            </section>

            {/* Section 7 */}
            <section id="section-7" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  07
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">User Data Rights &amp; Data Retention</h2>
              </div>
              <ul className="list-disc list-inside space-y-2.5 pl-2 text-neutral-400 text-sm sm:text-base">
                <li>
                  <strong className="text-neutral-200">Data Access &amp; Export:</strong> You may view, download, and manage your stored files at any time through your dashboard.
                </li>
                <li>
                  <strong className="text-neutral-200">Account Deletion &amp; Data Purge:</strong> When you delete a file or trash folder, it is marked for immediate de-referencing and permanently pruned from storage repositories. If you request account closure, all associated records, metadata, and files are permanently purged within 30 days.
                </li>
                <li>
                  <strong className="text-neutral-200">Zero-Parking Retention &amp; DPDP Minimization:</strong> In accordance with statutory data minimization principles under the Digital Personal Data Protection (DPDP) Act, CloudGuard does not retain unmonetized personal storage indefinitely. Vaults that conclude their 14-day evaluation trial without an active subscription upgrade, or cancelled subscriptions that reach the conclusion of their prepaid term, receive a 7-day read-only grace period solely to allow users to export stored assets. Upon expiration of this 7-day grace window, all stored files, encryption keys, and metadata are permanently and irreversibly purged from our object storage repositories to maintain zero unmonetized data liability.
                </li>
              </ul>
            </section>

            {/* Section 8 */}
            <section id="section-8" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  08
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Grievance Officer &amp; Contact Details</h2>
              </div>
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 space-y-3">
                <h3 className="text-base font-semibold text-white">Data Protection Grievance Officer</h3>
                <p className="text-sm text-neutral-400 leading-relaxed">
                  In accordance with the Digital Personal Data Protection Act, 2023 (DPDP Act) and applicable rules, 
                  the details of the designated Grievance Officer for CloudGuard are published below:
                </p>
                <div className="text-sm text-neutral-300 space-y-1.5 pt-1">
                  <p><strong className="text-white">Name:</strong> Nizam Ahamad</p>
                  <p><strong className="text-white">Designation:</strong> Data Protection &amp; Grievance Officer</p>
                  <p><strong className="text-white">Email:</strong> <a href="mailto:privacy@cloudguard.site" className="text-emerald-400 hover:underline"><code className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-emerald-300">privacy@cloudguard.site</code></a></p>
                  <p><strong className="text-white">General Support:</strong> <a href="mailto:support@cloudguard.site" className="text-emerald-400 hover:underline"><code className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-emerald-300">support@cloudguard.site</code></a></p>
                  <p><strong className="text-white">Registered Business Address:</strong> House No. 120, Main Market, Ward No. 3, Shaktifarm, Udham Singh Nagar, Uttarakhand - 263151, India</p>
                  <p><strong className="text-white">Redressal Timeline:</strong> All grievances are acknowledged within 48 hours and resolved within 30 days.</p>
                </div>
                <div className="mt-4 pt-3 border-t border-neutral-800 text-xs text-neutral-400 leading-relaxed">
                  <strong className="text-neutral-200">Statutory Right of Escalation:</strong> If your privacy concern or data grievance 
                  is not resolved to your satisfaction within the prescribed timeline, you have the statutory right under Section 13(4) 
                  of the DPDP Act, 2023 to register an appeal or complaint with the{' '}
                  <span className="text-neutral-200 font-medium">Data Protection Board of India (DPBI)</span>.
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>

      {/* Universal Footer */}
      <Footer />
    </div>
  );
}
