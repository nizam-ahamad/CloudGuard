import { Link } from 'react-router-dom';
import { ShieldCheck, FileText, Lock, FolderArchive } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#131314] text-[#e3e3e3] font-sans overflow-x-hidden selection:bg-blue-500/30">
      
      {/* Top Navigation Bar */}
      <nav className="w-full flex items-center justify-between px-6 py-4 border-b border-[#282a2c] bg-[#131314]/90 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <img 
            src="/cloudguard-logo.svg" 
            alt="CloudGuard Logo" 
            className="h-10 w-auto object-contain" 
            style={{ filter: "brightness(0) invert(1)" }} 
          />
          <span className="text-2xl font-bold tracking-wide text-white">CloudGuard</span>
        </div>
        <Link to="/login" className="px-5 py-2 bg-[#1e1f20] border border-[#282a2c] hover:border-blue-500 transition-colors rounded-md text-sm font-medium shadow-sm">
          Sign In
        </Link>
      </nav>

      <div className="flex flex-col items-center pt-24 pb-20 px-4 relative">
        
        {/* Background Radial Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none"></div>

        {/* Hero Section */}
        <div className="text-center z-10 mb-16 max-w-3xl">
          <h1 className="text-5xl md:text-6xl font-bold mb-6 tracking-tight text-white leading-tight">
            The secure vault for your <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">most critical files.</span>
          </h1>
          <p className="text-lg md:text-xl text-[#8a8d91] mb-10">
            End-to-end Python machine learning threat detection seamlessly integrated into a high-performance AWS S3 storage interface.
          </p>
          <Link to="/login" className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white transition-colors rounded-lg font-medium shadow-[0_0_20px_rgba(37,99,235,0.4)]">
            Open Your Vault
          </Link>
        </div>

        {/* Floating App Preview */}
        <div className="w-full max-w-5xl bg-[#1a1b1d]/80 backdrop-blur-xl border border-[#282a2c] rounded-2xl shadow-2xl overflow-hidden z-10 relative">
          
          {/* Mock Dashboard Header */}
          <div className="px-6 py-4 border-b border-[#282a2c] flex items-center justify-between bg-[#1e1f20]/50">
            <h2 className="text-lg font-semibold text-white">My Files</h2>
            <div className="flex items-center gap-2 text-xs font-mono text-[#4ade80] bg-[#4ade80]/10 px-3 py-1 rounded-full border border-[#4ade80]/20">
              <ShieldCheck size={14} />
              <span>System Secure</span>
            </div>
          </div>

          {/* Mock File List */}
          <div className="p-2">
            <div className="grid grid-cols-12 gap-4 px-4 py-3 text-xs font-semibold text-[#8a8d91] border-b border-[#282a2c]/50 uppercase tracking-wider">
              <div className="col-span-6">File Name</div>
              <div className="col-span-2">Size</div>
              <div className="col-span-4 text-right">ML Security Status</div>
            </div>

            {/* Dummy File 1 */}
            <div className="grid grid-cols-12 gap-4 px-4 py-4 items-center hover:bg-[#282a2c]/30 rounded-lg transition-colors cursor-default">
              <div className="col-span-6 flex items-center gap-3">
                <FolderArchive className="text-blue-400" size={20} />
                <span className="font-medium text-white">cloudguard_final_build.zip</span>
              </div>
              <div className="col-span-2 text-sm text-[#8a8d91]">24.5 MB</div>
              <div className="col-span-4 flex justify-end">
                <span className="flex items-center gap-1.5 text-xs font-mono text-[#4ade80]">
                  <Lock size={12} /> Scanned: Clean
                </span>
              </div>
            </div>

            {/* Dummy File 2 */}
            <div className="grid grid-cols-12 gap-4 px-4 py-4 items-center hover:bg-[#282a2c]/30 rounded-lg transition-colors cursor-default">
              <div className="col-span-6 flex items-center gap-3">
                <FileText className="text-emerald-400" size={20} />
                <span className="font-medium text-white">aws_s3_architecture.pdf</span>
              </div>
              <div className="col-span-2 text-sm text-[#8a8d91]">3.2 MB</div>
              <div className="col-span-4 flex justify-end">
                <span className="flex items-center gap-1.5 text-xs font-mono text-[#4ade80]">
                  <Lock size={12} /> Scanned: Clean
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
