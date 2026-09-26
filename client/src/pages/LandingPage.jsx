import { Link } from 'react-router-dom';
import { Terminal, ShieldCheck, FileCode2, FolderLock } from 'lucide-react';
import CloudGuardLogo from '../CloudGuardLogo';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black text-[#e3e3e3] font-sans selection:bg-[#333]">
      
      {/* Subtle Grid Background */}
      <div className="absolute inset-0 z-0 opacity-20 pointer-events-none" 
           style={{ backgroundImage: 'radial-gradient(#333 1px, transparent 1px)', backgroundSize: '32px 32px' }}>
      </div>

      {/* Top Navigation Bar */}
      <nav className="w-full flex items-center justify-between px-8 py-6 border-b border-[#222] bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <CloudGuardLogo className="h-10 w-auto flex-shrink-0 text-[#e3e3e3] fill-current"/>
          <span className="font-headline-md text-headline-md font-bold text-[#e3e3e3]">CloudGuard</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="https://github.com/nizam-ahamad/CloudGuard" target="_blank" rel="noreferrer" className="font-mono text-sm text-[#888] hover:text-[#e3e3e3] transition-colors">GITHUB</a>
          <Link to="/login" className="px-6 py-2 bg-[#111] border border-[#333] hover:border-[#e3e3e3] transition-colors rounded text-sm font-mono text-[#e3e3e3]">
            LOGIN
          </Link>
        </div>
      </nav>

      {/* Render-Style Split Layout */}
      <div className="flex flex-col lg:flex-row items-center justify-between pt-32 pb-24 px-8 relative z-10 w-full max-w-[1400px] mx-auto gap-16">
        
        {/* Left Side: Hero Text */}
        <div className="w-full lg:w-1/2 text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#111] border border-[#333] mb-8 shadow-lg">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            <span className="font-mono text-xs text-[#888]">v1.0.0 DEPLOYED ON AWS</span>
          </div>
          <h1 className="text-6xl lg:text-7xl font-extrabold mb-8 tracking-tighter text-[#e3e3e3] leading-[1.1]">
            CloudGuard Vault. <br />
            <span className="text-[#666]">AI-Driven Threat Detection.</span>
          </h1>
          <p className="text-xl text-[#888] max-w-xl mb-12 font-light leading-relaxed">
            A highly secure file management system built on AWS S3. Every upload is analyzed in real-time by a custom Python microservice utilizing Random Forest machine learning and VirusTotal API fallbacks.
          </p>
          <div className="flex items-center justify-start gap-4">
            <Link to="/login" className="px-8 py-4 bg-[#e3e3e3] text-black hover:bg-[#c4c7c5] transition-colors rounded font-medium text-lg shadow-[0_0_30px_rgba(227,227,227,0.15)]">
              Initialize Vault
            </Link>
          </div>
        </div>

        {/* Right Side: Floating Tech Stack */}
        <div className="w-full lg:w-5/12 flex flex-col gap-6 min-w-0">
          
          {/* Terminal Window */}
          <div className="w-full bg-[#050505] border border-[#222] rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#333] bg-[#0a0a0a]">
              <Terminal className="text-[#888]" size={16} />
              <span className="font-mono text-xs text-[#888]">ml_pipeline.py</span>
            </div>
            <div className="p-6 font-mono text-sm leading-relaxed overflow-x-auto">
              <div className="text-[#666]"># Initialize threat detection</div>
              <div className="text-[#c678dd]">def</div> <span className="text-[#61afef]">analyze_payload</span>(file_buffer):<br/>
              <span className="pl-4 text-[#e5c07b]">features</span> = extract_entropy(file_buffer)<br/>
              <span className="pl-4 text-[#e5c07b]">prediction</span> = rf_model.predict(features)<br/>
              <span className="pl-4 text-[#c678dd]">if</span> prediction == <span className="text-[#98c379]">'malicious'</span>:<br/>
              <span className="pl-8 text-[#56b6c2]">trigger_webhook_alert()</span><br/>
              <span className="pl-8 text-[#c678dd]">return</span> False<br/>
              <br/>
              <span className="text-green-500 animate-pulse">&gt; Pipeline ready. Awaiting uploads..._</span>
            </div>
          </div>

          {/* UI Component Window */}
          <div className="w-full bg-[#0a0a0a] border border-[#222] rounded-xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-mono text-xs text-[#888]">/src/dashboard/MyFiles.jsx</h3>
              <ShieldCheck className="text-[#555]" size={18} />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-[#111] border border-[#222] rounded">
                <div className="flex items-center gap-3">
                  <FolderLock className="text-[#888]" size={18} />
                  <span className="font-medium text-[#e3e3e3] text-sm">CloudGuard_Architecture.pdf</span>
                </div>
                <span className="font-mono text-[10px] text-green-500 bg-green-500/10 px-2 py-1 rounded border border-green-500/20">CLEAN</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-[#111] border border-[#222] rounded">
                <div className="flex items-center gap-3">
                  <FileCode2 className="text-[#888]" size={18} />
                  <span className="font-medium text-[#e3e3e3] text-sm">aws_s3_keys.pem</span>
                </div>
                <span className="font-mono text-[10px] text-green-500 bg-green-500/10 px-2 py-1 rounded border border-green-500/20">CLEAN</span>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
