import { Link } from 'react-router-dom';
import { Terminal, ShieldCheck, FileCode2, FolderLock } from 'lucide-react';
import CloudGuardLogo from '../CloudGuardLogo';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black text-[#e3e3e3] font-sans selection:bg-[#333]">
      
      {/* Subtle Grid Background (mimicking Clears.ai noise/texture) */}
      <div className="absolute inset-0 z-0 opacity-20 pointer-events-none" 
           style={{ backgroundImage: 'radial-gradient(#333 1px, transparent 1px)', backgroundSize: '32px 32px' }}>
      </div>

      {/* Top Navigation Bar */}
      <nav className="w-full flex items-center justify-between px-8 py-5 border-b border-[#222] bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <CloudGuardLogo className="h-12 w-auto text-[#e3e3e3] fill-current" />
          <span className="text-xl font-bold tracking-tight text-[#e3e3e3]">CloudGuard</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="https://github.com/yourusername/cloudguard" target="_blank" className="font-mono text-sm text-[#888] hover:text-[#e3e3e3] transition-colors">DOCUMENTATION</a>
          <Link to="/login" className="px-5 py-2 bg-[#111] border border-[#333] hover:border-[#e3e3e3] transition-colors rounded text-sm font-mono text-[#e3e3e3]">
            LOGIN
          </Link>
        </div>
      </nav>

      <div className="flex flex-col items-center pt-32 pb-24 px-4 relative z-10 w-full max-w-[1200px] mx-auto">
        
        {/* Hero Section */}
        <div className="text-center mb-20 max-w-4xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#111] border border-[#333] mb-8">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            <span className="font-mono text-xs text-[#888]">v1.0.0 DEPLOYED ON AWS</span>
          </div>
          <h1 className="text-6xl md:text-7xl font-extrabold mb-8 tracking-tighter text-[#e3e3e3] leading-[1.1]">
            Secure object storage. <br />
            <span className="text-[#555]">Powered by Machine Learning.</span>
          </h1>
          <p className="text-xl text-[#888] max-w-2xl mx-auto mb-10 font-light">
            A high-performance digital vault integrating Python-based Random Forest threat detection directly into the upload pipeline.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link to="/login" className="px-8 py-4 bg-[#e3e3e3] text-black hover:bg-[#c4c7c5] transition-colors rounded font-medium text-lg shadow-[0_0_30px_rgba(227,227,227,0.1)]">
              Initialize Vault
            </Link>
          </div>
        </div>

        {/* The Technical Split-View Showcase (Griffin Style) */}
        <div className="w-full bg-[#0a0a0a] border border-[#222] rounded-xl overflow-hidden shadow-2xl flex flex-col md:flex-row">
          
          {/* Left Side: The UI Preview */}
          <div className="w-full md:w-1/2 border-b md:border-b-0 md:border-r border-[#222] p-8">
            <div className="flex items-center justify-between mb-8">
              <h3 className="font-mono text-sm text-[#888]">/src/dashboard/MyFiles.jsx</h3>
              <ShieldCheck className="text-[#333]" size={20} />
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-[#111] border border-[#222] rounded hover:border-[#444] transition-colors">
                <div className="flex items-center gap-3">
                  <FolderLock className="text-[#888]" size={20} />
                  <span className="font-medium text-[#ccc]">system_architecture.pdf</span>
                </div>
                <span className="font-mono text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded">CLEAN</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-[#111] border border-[#222] rounded hover:border-[#444] transition-colors">
                <div className="flex items-center gap-3">
                  <FileCode2 className="text-[#888]" size={20} />
                  <span className="font-medium text-[#ccc]">aws_s3_keys.pem</span>
                </div>
                <span className="font-mono text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded">CLEAN</span>
              </div>
            </div>
          </div>

          {/* Right Side: The Python Terminal */}
          <div className="w-full md:w-1/2 p-8 bg-black">
            <div className="flex items-center gap-2 mb-8">
              <Terminal className="text-[#555]" size={20} />
              <h3 className="font-mono text-sm text-[#555]">ml_pipeline.py — Active</h3>
            </div>
            
            <div className="font-mono text-sm leading-relaxed">
              <div className="text-[#555]"># Initialize threat detection</div>
              <div className="text-[#c678dd]">def</div> <span className="text-[#61afef]">analyze_payload</span>(file_buffer):<br/>
              <span className="pl-4 text-[#e5c07b]">features</span> = extract_entropy(file_buffer)<br/>
              <span className="pl-4 text-[#e5c07b]">prediction</span> = rf_model.predict(features)<br/>
              <br/>
              <span className="pl-4 text-[#c678dd]">if</span> prediction == <span className="text-[#98c379]">'malicious'</span>:<br/>
              <span className="pl-8 text-[#56b6c2]">trigger_webhook_alert()</span><br/>
              <span className="pl-8 text-[#c678dd]">return</span> False<br/>
              <br/>
              <span className="pl-4 text-[#555]"># Fallback check</span><br/>
              <span className="pl-4 text-[#e5c07b]">vt_status</span> = check_virustotal(file_hash)<br/>
              <span className="pl-4 text-[#c678dd]">return</span> vt_status<br/>
              <br/>
              <span className="text-green-500 animate-pulse">&gt; Pipeline ready. Awaiting uploads..._</span>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
