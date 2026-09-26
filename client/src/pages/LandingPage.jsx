import { Link } from 'react-router-dom';
import { Database, ShieldAlert, Webhook, Terminal } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#131314] text-[#e3e3e3] font-sans selection:bg-blue-500/30">
      
      {/* Top Navigation Bar */}
      <nav className="w-full flex items-center justify-between px-6 py-4 border-b border-[#282a2c] bg-[#131314]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <img src="/cloudguard-logo.svg" alt="CloudGuard Logo" className="w-8 h-8" style={{ filter: "brightness(0) invert(1)" }} />
          <span className="text-xl font-bold tracking-wide text-white">CloudGuard</span>
        </div>
        <Link to="/login" className="px-5 py-2 bg-[#1e1f20] border border-[#282a2c] hover:border-blue-500 transition-colors rounded-md text-sm font-medium">
          Sign In
        </Link>
      </nav>

      <div className="flex flex-col items-center pt-20 pb-16">
        {/* Hero Section */}
        <div className="text-center z-10 mb-16 px-4">
          <h1 className="text-5xl md:text-6xl font-bold mb-6 tracking-tight text-white">
            AI-powered security <br />
            <span className="text-[#a0a3a7]">for your digital vault.</span>
          </h1>
          <p className="text-lg md:text-xl text-[#8a8d91] max-w-2xl mx-auto mb-10">
            A secure file storage system integrating machine learning threat detection with scalable cloud infrastructure. Built to analyze, protect, and store your data seamlessly.
          </p>
          <Link to="/login" className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white transition-colors rounded-lg font-medium shadow-[0_0_20px_rgba(37,99,235,0.3)] z-10">
            Enter Vault
          </Link>
        </div>

        {/* Bento Box Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl px-6">
          
          {/* Card 1: AI Threat Detection */}
          <div className="md:col-span-2 bg-[#1e1f20] border border-[#282a2c] rounded-2xl p-8 hover:border-blue-500/50 transition-colors flex flex-col justify-between group shadow-lg">
            <div>
              <ShieldAlert className="w-8 h-8 text-blue-500 mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Active AI Threat Detection</h3>
              <p className="text-[#a0a3a7] mb-6">
                Uploads are analyzed by a custom Python microservice. We utilize Random Forest machine learning models and VirusTotal API fallbacks to verify file integrity before storage.
              </p>
            </div>
            <div className="bg-[#131314] p-4 rounded-lg font-mono text-sm text-[#4ade80] border border-[#282a2c]">
              <div className="flex items-center gap-2 mb-2">
                <Terminal size={14} className="text-[#8a8d91]" />
                <span className="text-[#8a8d91]">scan_status.py</span>
              </div>
              &gt; initializing deep scan...<br />
              &gt; random_forest_model: clean<br />
              &gt; virustotal_hash_check: 0 threats<br />
              &gt; status: safe_to_store
            </div>
          </div>

          {/* Card 2: AWS Storage */}
          <div className="bg-[#1e1f20] border border-[#282a2c] rounded-2xl p-8 hover:border-emerald-500/50 transition-colors shadow-lg">
            <Database className="w-8 h-8 text-emerald-500 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">AWS S3 Infrastructure</h3>
            <p className="text-[#a0a3a7]">
              Your files are securely routed and stored in highly reliable Amazon S3 object storage buckets, separating the application layer from the data layer.
            </p>
          </div>

          {/* Card 3: Webhooks */}
          <div className="md:col-span-3 bg-[#1e1f20] border border-[#282a2c] rounded-2xl p-8 hover:border-purple-500/50 transition-colors flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-lg">
            <div className="max-w-2xl">
              <Webhook className="w-8 h-8 text-purple-500 mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Automated Webhook Alerts</h3>
              <p className="text-[#a0a3a7]">
                CloudGuard integrates with Google Apps Script to trigger automated email webhooks, alerting you the moment a security anomaly or malicious signature is detected.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
