import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, Lock, Database, Server } from 'lucide-react';
import CloudGuardLogo from '../CloudGuardLogo';

export default function PrivacyPolicy() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen bg-black text-neutral-300 font-sans selection:bg-neutral-800 selection:text-white">
      {/* Top Header / Breadcrumb */}
      <header className="w-full border-b border-neutral-900 bg-black/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-3 text-neutral-400 hover:text-white transition-colors group">
            <ArrowLeft size={18} className="transition-transform group-hover:-translate-x-1" />
            <div className="flex items-center gap-2">
              <CloudGuardLogo className="h-7 w-auto flex-shrink-0 text-white fill-current invert dark:invert" />
              <span className="font-semibold text-white tracking-tight">CloudGuard</span>
            </div>
          </Link>
          <Link 
            to="/terms" 
            className="text-xs font-mono text-neutral-400 hover:text-white transition-colors border border-neutral-800 px-3 py-1.5 rounded hover:border-neutral-700"
          >
            Terms of Service &rarr;
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto p-6 md:p-16">
        {/* Document Header */}
        <div className="mb-12 border-b border-neutral-900 pb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-800 bg-neutral-900/60 text-xs font-mono text-neutral-400 mb-4">
            <Shield size={13} className="text-emerald-400" />
            <span>Legal Documentation</span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mb-3">
            Privacy Policy
          </h1>
          <p className="text-sm font-mono text-neutral-500">
            Last Updated: October 2026
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-10 text-neutral-300 text-sm sm:text-base leading-relaxed font-light">
          
          {/* Section 1 */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-white font-medium text-lg">
              <span className="font-mono text-neutral-500 text-sm">01.</span>
              <h2>Overview</h2>
            </div>
            <p>
              CloudGuard Vault (&ldquo;CloudGuard&rdquo;, &ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) is an encrypted cloud storage demonstration platform featuring real-time AI threat scanning and zero-trust file management. We are committed to protecting your personal data and ensuring transparent practices regarding the collection, use, and security of information processed through our service.
            </p>
          </section>

          {/* Section 2 */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-white font-medium text-lg">
              <span className="font-mono text-neutral-500 text-sm">02.</span>
              <h2>Data Collected</h2>
            </div>
            <p>
              We collect and process minimal data necessary to provide and secure our storage platform:
            </p>
            <ul className="list-disc list-inside space-y-2 pl-2 text-neutral-400">
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
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-white font-medium text-lg">
              <span className="font-mono text-neutral-500 text-sm">03.</span>
              <h2>Third-Party Processing &amp; Infrastructure</h2>
            </div>
            <p>
              To maintain high-assurance isolation and threat detection, CloudGuard integrates with dedicated cloud infrastructure:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="p-4 bg-neutral-950 border border-neutral-900 rounded-lg">
                <Database size={18} className="text-blue-400 mb-2" />
                <h3 className="text-sm font-medium text-white mb-1">Amazon Web Services (AWS)</h3>
                <p className="text-xs text-neutral-400 leading-normal">
                  Encrypted object persistence in isolated S3 buckets accessible only via ephemeral, short-lived pre-signed URLs.
                </p>
              </div>
              <div className="p-4 bg-neutral-950 border border-neutral-900 rounded-lg">
                <Server size={18} className="text-purple-400 mb-2" />
                <h3 className="text-sm font-medium text-white mb-1">Python ML Microservice</h3>
                <p className="text-xs text-neutral-400 leading-normal">
                  Pre-ingestion static inspection with optional automated VirusTotal API fallback verification for suspicious binary hashes.
                </p>
              </div>
              <div className="p-4 bg-neutral-950 border border-neutral-900 rounded-lg">
                <Lock size={18} className="text-emerald-400 mb-2" />
                <h3 className="text-sm font-medium text-white mb-1">Google Apps Script</h3>
                <p className="text-xs text-neutral-400 leading-normal">
                  Outbound transactional email delivery for one-time verification passwords (OTP) and password reset authorization tokens.
                </p>
              </div>
            </div>
          </section>

          {/* Section 4 */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-white font-medium text-lg">
              <span className="font-mono text-neutral-500 text-sm">04.</span>
              <h2>Data Ownership &amp; Retention</h2>
            </div>
            <p>
              You maintain complete ownership and intellectual property rights over all files and documents you upload to CloudGuard Vault. When you delete a file or folder from your dashboard, the corresponding object is permanently purged from our AWS S3 bucket and database indices without lingering residual copies.
            </p>
          </section>

          {/* Section 5 */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-white font-medium text-lg">
              <span className="font-mono text-neutral-500 text-sm">05.</span>
              <h2>Security Architecture</h2>
            </div>
            <p>
              We enforce modern zero-trust security controls across the application lifecycle:
            </p>
            <ul className="list-disc list-inside space-y-2 pl-2 text-neutral-400">
              <li>End-to-end HTTPS/TLS encryption for all client-to-server and server-to-S3 communications.</li>
              <li>No plain-text storage of user passwords or cloud provider master credentials.</li>
              <li>Strict tenant isolation ensuring accounts cannot query or access unauthorized object keys.</li>
              <li>Automatic quarantine of files exhibiting malicious static signatures before S3 persistence.</li>
            </ul>
          </section>

          {/* Contact / Inquiries */}
          <section className="space-y-3 pt-6 border-t border-neutral-900">
            <div className="flex items-center gap-2 text-white font-medium text-lg">
              <span className="font-mono text-neutral-500 text-sm">06.</span>
              <h2>Contact &amp; Inquiries</h2>
            </div>
            <p>
              If you have questions regarding this Privacy Policy or wish to request complete deletion of your account and associated objects, please submit an issue or inquiry via our official GitHub repository.
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
