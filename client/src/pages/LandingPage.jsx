import { Link } from 'react-router-dom';
import { Database, ShieldAlert, Webhook, Terminal } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#131314] text-[#e3e3e3] flex flex-col items-center pt-24 pb-16 font-sans">
      
      {/* Hero Section */}
      <div className="text-center z-10 mb-16 px-4">
        <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight text-white">
          Secure infrastructure <br />
          <span className="text-[#a0a3a7]">for your digital vault.</span>
        </h1>
        <p className="text-lg md:text-xl text-[#8a8d91] max-w-2xl mx-auto mb-10">
          Scale your file security from your first upload to your billionth. CloudGuard delivers enterprise-grade threat detection and object storage in one seamless platform.
        </p>
        <Link to="/login" className="px-8 py-3 bg-white text-black hover:bg-[#e3e3e3] transition-colors rounded-lg font-medium shadow-lg z-10">
          Enter Vault
        </Link>
      </div>

      {/* Bento Box Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl px-6">
        
        {/* Card 1: AI Threat Detection (Spans 2 columns for bento asymmetry) */}
        <div className="md:col-span-2 bg-[#1e1f20] border border-[#282a2c] rounded-2xl p-8 hover:border-[#3a3d40] transition-colors flex flex-col justify-between group">
          <div>
            <ShieldAlert className="w-8 h-8 text-blue-500 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Active AI Threat Detection</h3>
            <p className="text-[#a0a3a7] mb-6">
              Every upload is instantly scanned by a dedicated Python microservice utilizing Random Forest machine learning algorithms, backed by VirusTotal API fallbacks to guarantee absolute file integrity.
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
        <div className="bg-[#1e1f20] border border-[#282a2c] rounded-2xl p-8 hover:border-[#3a3d40] transition-colors">
          <Database className="w-8 h-8 text-emerald-500 mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">AWS S3 Infrastructure</h3>
          <p className="text-[#a0a3a7]">
            Built on top of Amazon Web Services. Your files are encrypted, decentralized, and stored in highly scalable S3 object storage buckets for zero downtime.
          </p>
        </div>

        {/* Card 3: Webhooks */}
        <div className="md:col-span-3 bg-[#1e1f20] border border-[#282a2c] rounded-2xl p-8 hover:border-[#3a3d40] transition-colors flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="max-w-2xl">
            <Webhook className="w-8 h-8 text-purple-500 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Automated Webhook Alerts</h3>
            <p className="text-[#a0a3a7]">
              Stay instantly informed. CloudGuard integrates directly with Google Apps Script to trigger real-time email webhooks the millisecond a security anomaly or unauthorized access attempt is detected.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
