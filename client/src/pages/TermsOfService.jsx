import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Scale } from 'lucide-react';
import CloudGuardLogo from '../CloudGuardLogo';

export default function TermsOfService() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen bg-black text-neutral-300 font-sans selection:bg-neutral-800 selection:text-white">
      {/* Top Header / Breadcrumb */}
      <header className="w-full border-b border-neutral-900 bg-black/60 backdrop-blur-md sticky top-0 z-50">
        <div className="w-full max-w-3xl md:max-w-5xl lg:max-w-6xl mx-auto px-4 sm:px-6 md:px-12 lg:px-16 py-4 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-3 text-neutral-400 hover:text-white transition-colors group">
            <ArrowLeft size={18} className="transition-transform group-hover:-translate-x-1" />
            <div className="flex items-center gap-2">
              <CloudGuardLogo className="h-7 w-auto flex-shrink-0 text-white fill-current invert dark:invert" />
              <span className="font-semibold text-white tracking-tight">CloudGuard</span>
            </div>
          </Link>
          <Link 
            to="/privacy" 
            className="text-xs font-mono text-neutral-400 hover:text-white transition-colors border border-neutral-800 px-3 py-1.5 rounded hover:border-neutral-700"
          >
            Privacy Policy &rarr;
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-3xl md:max-w-5xl lg:max-w-6xl mx-auto px-4 sm:px-6 md:px-12 lg:px-16 py-8 md:py-16">
        {/* Document Header */}
        <div className="mb-12 border-b border-neutral-900 pb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-800 bg-neutral-900/60 text-xs md:text-base font-mono text-neutral-400 mb-4">
            <Scale size={13} className="text-purple-400" />
            <span>Legal Documentation</span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold md:font-extrabold tracking-tight text-white mb-3">
            Terms of Service
          </h1>
          <p className="text-sm md:text-base font-mono text-neutral-500">
            Last Updated: October 2026
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-8 md:space-y-12 text-neutral-300 text-sm sm:text-base md:text-base lg:text-lg leading-relaxed md:leading-relaxed font-light">
          
          {/* Section 1 */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-white font-medium text-lg md:text-2xl lg:text-3xl md:font-bold md:mb-4">
              <span className="font-mono text-neutral-500 text-sm md:text-xl">01.</span>
              <h2>Acceptance of Terms</h2>
            </div>
            <p className="text-neutral-300">
              By accessing or using CloudGuard Vault (&ldquo;the Service&rdquo;), you acknowledge that you have read, understood, and agree to be bound by these Terms of Service. CloudGuard Vault is engineered and provided primarily as an advanced demonstration and portfolio architecture showcasing real-time AI malware scanning and zero-trust cloud file storage. If you do not agree to these terms, do not access or use the application.
            </p>
          </section>

          {/* Section 2 */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-white font-medium text-lg md:text-2xl lg:text-3xl md:font-bold md:mb-4">
              <span className="font-mono text-neutral-500 text-sm md:text-xl">02.</span>
              <h2>Acceptable Use Policy</h2>
            </div>
            <p className="text-neutral-300">
              You agree to use CloudGuard strictly for legitimate file management, streaming, and testing purposes. You expressly agree not to:
            </p>
            <ul className="list-disc list-inside space-y-2 pl-2 text-neutral-400 md:text-base lg:text-lg">
              <li>Intentionally upload, store, or distribute illegal content, unlawful material, or zero-day weaponized exploits.</li>
              <li>Deploy automated bots, denial-of-service vectors, or brute-force scripts intended to degrade or impair the host servers or S3 infrastructure.</li>
              <li>Attempt to reverse-engineer, bypass, or tamper with API authentication, token validation, or S3 pre-signed security constraints.</li>
              <li>Circumvent storage quota limitations or abuse server-side scanning services.</li>
            </ul>
          </section>

          {/* Section 3 */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-white font-medium text-lg md:text-2xl lg:text-3xl md:font-bold md:mb-4">
              <span className="font-mono text-neutral-500 text-sm md:text-xl">03.</span>
              <h2>Disclaimer of Warranties (&ldquo;As Is&rdquo;)</h2>
            </div>
            <div className="p-4 md:p-8 bg-neutral-950 border border-neutral-800 rounded-lg text-neutral-300 text-xs sm:text-sm md:text-base lg:text-lg leading-relaxed space-y-2">
              <div className="flex items-center gap-2 text-amber-400 font-mono text-xs md:text-sm uppercase tracking-wider">
                <AlertTriangle size={14} className="md:w-5 md:h-5" />
                <span>Notice to Users</span>
              </div>
              <p>
                THE SERVICE AND ITS INTEGRATED MACHINE LEARNING MALWARE DETECTION HEURISTICS ARE PROVIDED STRICTLY ON AN &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; BASIS WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED.
              </p>
              <p className="text-neutral-400">
                While our static analysis models and threat checks significantly reduce exposure to malicious binaries, CloudGuard does NOT guarantee 100% detection of all zero-day malware, sophisticated evasion techniques, or uncorrupted storage persistence, nor does it guarantee uninterrupted uptime.
              </p>
            </div>
          </section>

          {/* Section 4 */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-white font-medium text-lg md:text-2xl lg:text-3xl md:font-bold md:mb-4">
              <span className="font-mono text-neutral-500 text-sm md:text-xl">04.</span>
              <h2>Limitation of Liability</h2>
            </div>
            <p className="text-neutral-300">
              Under no circumstances shall CloudGuard, its maintainers, or its affiliates be liable for any direct, indirect, incidental, special, consequential, or punitive damages resulting from the use of, or inability to use, this demonstration service. This includes, without limitation, loss of data, file corruption, transmission interruptions, or business disruptions. Users are strongly advised to maintain secondary offline backups of all essential documents.
            </p>
          </section>

          {/* Section 5 */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-white font-medium text-lg md:text-2xl lg:text-3xl md:font-bold md:mb-4">
              <span className="font-mono text-neutral-500 text-sm md:text-xl">05.</span>
              <h2>Account Termination &amp; Payload Quarantine</h2>
            </div>
            <p className="text-neutral-300">
              We reserve the right to immediately suspend, throttle, or terminate any user account, delete suspicious file objects, or restrict upload capabilities at our sole discretion, without prior notice, if abusive upload behaviors, automated spamming, or attacks against the platform infrastructure are detected.
            </p>
          </section>

          {/* Section 6 */}
          <section className="space-y-3 pt-6 border-t border-neutral-900">
            <div className="flex items-center gap-2 text-white font-medium text-lg md:text-2xl lg:text-3xl md:font-bold md:mb-4">
              <span className="font-mono text-neutral-500 text-sm md:text-xl">06.</span>
              <h2>Modifications to Terms</h2>
            </div>
            <p className="text-neutral-300">
              We may revise these Terms of Service periodically to reflect infrastructure modifications, new capabilities, or legal compliance updates. Continued use of CloudGuard Vault following any posted changes constitutes full acceptance of the updated terms.
            </p>
          </section>

        </div>
      </main>

      {/* Footer */}
      <footer className="w-full py-8 border-t border-neutral-900 bg-black text-center text-xs font-mono text-neutral-600">
        &copy; 2026 CloudGuard Vault. All rights reserved.
      </footer>
    </div>
  );
}
