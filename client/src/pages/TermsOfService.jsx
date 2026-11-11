import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Scale, AlignLeft, ChevronRight } from 'lucide-react';
import CloudGuardLogo from '../CloudGuardLogo';
import Footer from '../components/Footer';

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
    { id: 'section-2', num: '02', title: 'Service & Digital Delivery' },
    { id: 'section-3', num: '03', title: 'User Accounts & Responsibilities' },
    { id: 'section-4', num: '04', title: 'Acceptable Use & Content' },
    { id: 'section-5', num: '05', title: 'Security Scanning & Threats' },
    { id: 'section-6', num: '06', title: 'Subscription Billing & Pricing' },
    { id: 'section-7', num: '07', title: 'Cancellation & Refund Policy' },
    { id: 'section-8', num: '08', title: 'Data Loss & Liability' },
    { id: 'section-9', num: '09', title: 'Account Suspension' },
    { id: 'section-10', num: '10', title: 'Governing Law & Disputes' },
    { id: 'section-11', num: '11', title: 'Contact Information' },
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
                By accessing or using CloudGuard (&ldquo;CloudGuard&rdquo;, &ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) via <code className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-purple-300">cloudguard.site</code> and associated APIs, you agree to be bound by these Terms and Conditions. If you do not agree to these terms, do not access or use our services. These terms constitute a legally binding agreement between you and CloudGuard.
              </p>
            </section>

            {/* Section 2 */}
            <section id="section-2" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  02
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Service Description &amp; Digital Delivery</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                CloudGuard provides high-performance cloud storage, file synchronization, automated cryptographic threat detection, and media management services.
              </p>
              <ul className="list-disc list-inside space-y-2.5 pl-2 text-neutral-400 text-sm sm:text-base">
                <li>
                  <strong className="text-neutral-200">Instant Digital Fulfillment:</strong> Upon successful payment confirmation for any upgraded subscription tier or storage allocation, access to additional storage quotas and premium features is provisioned immediately to your account dashboard with zero shipping or handling delay.
                </li>
                <li>
                  <strong className="text-neutral-200">14-Day Evaluation Trial (Zero Forever-Free Policy):</strong> New accounts are provisioned with a 14-day evaluation trial including 5 GB of storage to evaluate platform performance, zero-knowledge encryption, and automated malware analysis. CloudGuard does not provide a permanent, unmonetized forever-free storage tier. Unpaid vaults are never parked or held indefinitely; accounts that do not upgrade prior to trial expiration transition to a 7-day read-only grace period before permanent cryptographic deletion.
                </li>
              </ul>
            </section>

            {/* Section 3 */}
            <section id="section-3" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  03
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">User Accounts &amp; Responsibilities</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                You must be at least 18 years of age or possess legal parental/guardian consent to use CloudGuard. You are solely responsible for maintaining the confidentiality of your account credentials, multi-factor authentication devices, and all activities that occur under your account.
              </p>
            </section>

            {/* Section 4 */}
            <section id="section-4" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  04
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Acceptable Use &amp; Prohibited Content</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                You retain all ownership rights to the files, media, and data you upload to CloudGuard. However, you agree not to upload, store, share, or transmit:
              </p>
              <ul className="list-disc list-inside space-y-2.5 pl-2 text-neutral-400 text-sm sm:text-base">
                <li>Malware, viruses, trojans, ransomware, spyware, or malicious payloads.</li>
                <li>Material that infringes on any third party’s intellectual property, patent, trademark, or copyright.</li>
                <li>Child Sexual Abuse Material (CSAM), non-consensual sexual content, or violent extremist material.</li>
                <li>Content intended to perpetrate phishing, denial of service attacks, or unauthorized penetration testing against CloudGuard infrastructure or third parties.</li>
              </ul>
            </section>

            {/* Section 5 */}
            <section id="section-5" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  05
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Automated Security Scanning &amp; Threat Enforcement</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                To maintain platform integrity and prevent the distribution of malicious software:
              </p>
              <ul className="list-disc list-inside space-y-2.5 pl-2 text-neutral-400 text-sm sm:text-base">
                <li>CloudGuard employs automated hashing (SHA-256) and heuristic static analysis microservices on uploaded binary artifacts.</li>
                <li>If a file is determined to contain known malware signatures or harmful payloads, CloudGuard reserves the right to automatically quarantine, restrict public access to, or purge the infected artifact without prior liability.</li>
                <li>Automated scanning does not grant CloudGuard any proprietary license or ownership over your legitimate personal data.</li>
              </ul>
            </section>

            {/* Section 6 */}
            <section id="section-6" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  06
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Subscription Billing, Pricing &amp; Renewals</h2>
              </div>
              <ul className="list-disc list-inside space-y-2.5 pl-2 text-neutral-400 text-sm sm:text-base">
                <li>
                  <strong className="text-neutral-200">Declared Capacity Tiers:</strong> Paid storage tiers are provisioned at the following rates:
                  <ul className="list-circle list-inside space-y-1.5 pl-6 mt-1.5 text-neutral-400 text-sm sm:text-base">
                    <li><strong className="text-neutral-300">Essential Vault (50 GB):</strong> ₹49 / month OR ₹499 / year (~₹41.58/mo).</li>
                    <li><strong className="text-neutral-300">Pro Vault (100 GB):</strong> ₹99 / month OR ₹999 / year (~₹83.25/mo).</li>
                    <li><strong className="text-neutral-300">Ultra Vault (200 GB):</strong> ₹189 / month OR ₹1,899 / year (~₹158.25/mo).</li>
                  </ul>
                </li>
                <li>
                  <strong className="text-neutral-200">Mid-Cycle Upgrades &amp; Co-Terming:</strong> Users may upgrade capacity at any point during an active term. Annual-to-annual tier upgrades are calculated using daily co-terming (paying the rate delta for remaining days with an unchanged anniversary date). Monthly-to-annual upgrades add 365 days directly to the remaining cycle.
                </li>
                <li>
                  <strong className="text-neutral-200">Plan Downgrades:</strong> Downgrades take effect strictly at the conclusion of the active prepaid billing cycle. To complete a downgrade, current aggregate stored volume must be less than or equal to the target tier quota.
                </li>
                <li>
                  <strong className="text-neutral-200">Payment Processing:</strong> Payment processing is handled by certified, PCI-DSS compliant third-party payment gateways (e.g., Razorpay, Stripe). CloudGuard does not collect, store, or process full credit/debit card numbers or sensitive banking PINs on its servers.
                </li>
                <li>
                  <strong className="text-neutral-200">Automatic Renewal:</strong> Recurring subscriptions renew automatically at the end of each billing cycle unless cancelled prior to the renewal date via your account settings.
                </li>
              </ul>
            </section>

            {/* Section 7 */}
            <section id="section-7" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  07
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Cancellation &amp; Refund Policy</h2>
              </div>
              <ul className="list-disc list-inside space-y-2.5 pl-2 text-neutral-400 text-sm sm:text-base">
                <li>
                  <strong className="text-neutral-200">Subscription Cancellation:</strong> You may cancel your paid subscription at any time via your account dashboard. Upon cancellation, your account will remain active at the paid tier until the conclusion of the current prepaid billing period.
                </li>
                <li>
                  <strong className="text-neutral-200">Refund Eligibility:</strong> Because CloudGuard provisions digital storage allocations immediately upon payment:
                  <ul className="list-circle list-inside space-y-1.5 pl-6 mt-1.5 text-neutral-400 text-sm sm:text-base">
                    <li>First-time annual subscription purchases are eligible for a full refund within seven (7) calendar days of initial purchase if you have utilized less than 5% of your upgraded quota.</li>
                    <li>Monthly recurring charges, consumed storage overages, and renewal billing cycles are non-refundable once activated.</li>
                    <li>To request a refund review under exceptional technical failures, contact <a href="mailto:support@cloudguard.site" className="text-purple-400 hover:underline"><code className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-purple-300">support@cloudguard.site</code></a> within 7 days of the charge with your transaction ID.</li>
                    <li>Approved refunds are processed and credited back to the customer's original payment method within 5 to 7 business days, subject to the issuing bank's clearing cycle.</li>
                  </ul>
                </li>
              </ul>
            </section>

            {/* Section 8 */}
            <section id="section-8" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  08
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Data Loss, Backups &amp; Limitation of Liability</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                While CloudGuard utilizes redundant cloud object storage and automated failover pipelines:
              </p>
              <div className="p-5 md:p-6 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200/90 text-sm lg:text-base leading-relaxed space-y-3">
                <div className="flex items-center gap-2 text-amber-400 font-mono text-xs md:text-sm uppercase tracking-wider font-semibold">
                  <AlertTriangle size={16} />
                  <span>Important Disclaimer</span>
                </div>
                <ul className="list-disc list-inside space-y-2 text-amber-200/90 text-sm sm:text-base">
                  <li>The service is provided on an &ldquo;AS IS&rdquo; and &ldquo;AS AVAILABLE&rdquo; basis. You are encouraged to maintain independent local backups of mission-critical data.</li>
                  <li>To the maximum extent permitted by applicable law, CloudGuard and its affiliates shall not be liable for any indirect, incidental, punitive, or consequential damages, including loss of data, loss of business profits, or system downtime resulting from network interruptions or third-party cloud provider outages.</li>
                  <li><strong className="text-amber-200">Zero-Parking Policy &amp; Automated Cryptographic Purge:</strong> Accounts that reach trial expiration without upgrading, or cancelled subscriptions reaching term-end, enter a 7-day read-only grace period solely to allow users to export stored assets. Upon conclusion of this 7-day grace window, all files, cryptographic keys, and metadata are permanently and irreversibly purged from object storage clusters. CloudGuard explicitly disclaims all liability for data loss arising from automated purges of unpaid or expired accounts.</li>
                </ul>
              </div>
            </section>

            {/* Section 9 */}
            <section id="section-9" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  09
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Account Suspension, Termination &amp; Zero-Parking Purge</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                CloudGuard reserves the right to temporarily suspend or permanently terminate accounts that violate these terms, engage in chargeback fraud, or attempt to compromise server infrastructure. Upon termination for cause, access to stored files may be permanently revoked.
              </p>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                <strong className="text-neutral-200">Zero-Parking Lifecycle:</strong> CloudGuard strictly prohibits unmonetized permanent data parking. If an evaluation trial is not upgraded within 14 days, or if an active subscription lapses and is not renewed, the account immediately enters a 7-day read-only grace period during which file downloads are permitted but new uploads are disabled. Following this 7-day grace period, all uploaded files, cryptographic keys, and directory structures are automatically, permanently, and irreversibly purged from our storage infrastructure to maintain ₹0.00 unmonetized storage costs. CloudGuard disclaims all liability for data destroyed under this automated policy.
              </p>
            </section>

            {/* Section 10 */}
            <section id="section-10" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  10
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Governing Law &amp; Dispute Resolution</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                These Terms shall be governed by and construed in accordance with the laws of India. Any disputes arising out of or related to these terms shall be subject to the exclusive jurisdiction of the competent courts in Udham Singh Nagar / Nainital, Uttarakhand, India.
              </p>
            </section>

            {/* Section 11 */}
            <section id="section-11" className="scroll-mt-28 bg-neutral-900/30 border border-neutral-800/80 rounded-2xl p-6 lg:p-8 backdrop-blur-sm hover:border-neutral-700/80 transition-colors space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-md bg-neutral-800 text-neutral-300 border border-neutral-700">
                  11
                </span>
                <h2 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Contact Information &amp; Customer Support</h2>
              </div>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                For inquiries, billing disputes, or technical assistance:
              </p>
              <ul className="list-disc list-inside space-y-2.5 pl-2 text-neutral-400 text-sm sm:text-base">
                <li><strong className="text-neutral-200">Support Email:</strong> <a href="mailto:support@cloudguard.site" className="text-purple-400 hover:underline"><code className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-purple-300">support@cloudguard.site</code></a></li>
                <li><strong className="text-neutral-200">Registered Business Address:</strong> House No. 120, Main Market, Ward No. 3, Shaktifarm, Udham Singh Nagar, Uttarakhand - 263151</li>
                <li><strong className="text-neutral-200">Response SLA:</strong> Inquiries are acknowledged within 24 to 48 business hours.</li>
              </ul>
            </section>
          </main>
        </div>
      </div>

      {/* Universal Footer */}
      <Footer />
    </div>
  );
}
