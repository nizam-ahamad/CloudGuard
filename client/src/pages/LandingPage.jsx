import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Terminal, ShieldCheck, FileCode2, FolderLock, CloudUpload, Cpu, Network } from 'lucide-react';
import CloudGuardLogo from '../CloudGuardLogo';

export default function LandingPage() {
  const [heroText, setHeroText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [loopNum, setLoopNum] = useState(0);

  // 1. Crash-Proof Typewriter Effect
  useEffect(() => {
    const words = ["Intelligent File Security.", "Zero-Trust Architecture.", "Scalable Object Storage."];
    const currentWord = words[loopNum % words.length];
    const typeSpeed = isDeleting ? 50 : 100;

    const timer = setTimeout(() => {
      if (!isDeleting && heroText === currentWord) {
        setTimeout(() => setIsDeleting(true), 2000);
      } else if (isDeleting && heroText === '') {
        setIsDeleting(false);
        setLoopNum((prev) => prev + 1);
      } else {
        setHeroText(currentWord.substring(0, heroText.length + (isDeleting ? -1 : 1)));
      }
    }, typeSpeed);

    return () => clearTimeout(timer);
  }, [heroText, isDeleting, loopNum]);

  // 2. Crash-Proof Terminal Sequence
  const [lineIndex, setLineIndex] = useState(0);
  const terminalLines = [
    { text: "> Establishing secure connection...", color: "text-[#888]" },
    { text: "[SUCCESS] Connected to CloudGuard.", color: "text-green-500" },
    { text: "> Uploading 'Financial_Report.pdf'...", color: "text-[#888]" },
    { text: "[SCANNING] AI analyzing file patterns...", color: "text-blue-400" },
    { text: "[SAFE] 0 malicious signatures found.", color: "text-green-500" },
    { text: "> Encrypting payload...", color: "text-[#888]" },
    { text: "[SUCCESS] File safely stored in vault.", color: "text-green-500" }
  ];

  useEffect(() => {
    if (lineIndex < terminalLines.length) {
      const timer = setTimeout(() => {
        setLineIndex(prev => prev + 1);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [lineIndex]);

  return (
    <div className="min-h-screen bg-black text-[#e3e3e3] font-sans">
      
      {/* Subtle Grid Background */}
      <div className="absolute inset-0 z-0 opacity-20 pointer-events-none" 
           style={{ backgroundImage: 'radial-gradient(#333 1px, transparent 1px)', backgroundSize: '32px 32px' }}>
      </div>

      {/* Top Navigation Bar */}
      <nav className="w-full flex items-center justify-between px-8 py-6 border-b border-[#222] bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2 shrink-0">
          <CloudGuardLogo className="h-10 w-auto shrink-0" />
          <span className="text-2xl font-semibold tracking-tight text-[#e3e3e3]">CloudGuard</span>
        </div>
        <div className="flex items-center gap-6">
          <Link to="/login" className="px-6 py-2 text-xs font-mono uppercase tracking-widest text-slate-400 transition-all duration-300 border border-slate-700 rounded hover:border-white hover:text-white hover:bg-white/5">
            LOGIN
          </Link>
        </div>
      </nav>

      {/* Render-Style Split Layout */}
      <div className="flex flex-col lg:flex-row items-center lg:items-start justify-between pt-16 pb-22 px-8 relative z-10 w-full max-w-[1400px] mx-auto gap-16">
        
        {/* Left Side: Hero Text */}
        <div className="w-full lg:w-1/2 text-left lg:pt-4">
          <h1 className="text-6xl lg:text-7xl font-medium mb-8 tracking-tighter text-[#e3e3e3] leading-[1.1]">
            CloudGuard Vault. <br />
            <span className="text-[#888] whitespace-nowrap">{heroText}<span className="text-white animate-pulse">|</span></span>
          </h1>
          <p className="text-xl text-[#888] max-w-xl mb-12 font-light leading-relaxed">
            A highly secure file management system built on scalable cloud infrastructure. Every upload is analyzed in real-time by a custom Python microservice utilizing Random Forest machine learning and VirusTotal API fallbacks.
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
            <div className="p-6 font-mono text-sm leading-relaxed overflow-x-auto h-[320px]">
              {terminalLines.slice(0, lineIndex).map((line, index) => (
                <div key={index} className={`${line.color} mb-2 animate-fade-in`}>
                  {line.text}
                </div>
              ))}
              {lineIndex === terminalLines.length && (
                <div className="text-[#555] animate-pulse mt-4">&gt; Awaiting next upload..._</div>
              )}
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
                  <span className="font-medium text-[#e3e3e3] text-sm">cloud_storage_keys.pem</span>
                </div>
                <span className="font-mono text-[10px] text-green-500 bg-green-500/10 px-2 py-1 rounded border border-green-500/20">CLEAN</span>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* Architecture / How it Works Section */}
      <div className="w-full max-w-[1400px] mx-auto pt-16 border-t border-[#222] pb-24 px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl lg:text-4xl font-semibold tracking-tight text-[#e3e3e3] mb-4">
            Infrastructure built for zero-trust.
          </h2>
          <p className="text-[#888] font-light max-w-2xl mx-auto">
            How CloudGuard protects your system from the inside out, layer by layer.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full">
          
          {/* Card 1 */}
          <div className="bg-[#0a0a0a] border border-[#222] p-8 rounded-xl hover:border-[#444] transition-colors">
            <CloudUpload className="text-blue-500 mb-6" size={32}/>
            <h3 className="text-lg font-medium text-[#e3e3e3] mb-3">1. Decentralized Storage</h3>
            <p className="text-[#888] text-sm leading-relaxed">
              Your files are stored in highly secure, cloud-based vaults, keeping them completely separated from the main website for maximum privacy and safety.
            </p>
          </div>

          {/* Card 2 */}
          <div className="bg-[#0a0a0a] border border-[#222] p-8 rounded-xl hover:border-[#444] transition-colors">
            <Cpu className="text-purple-500 mb-6" size={32}/>
            <h3 className="text-lg font-medium text-[#e3e3e3] mb-3">2. Active AI Scanning</h3>
            <p className="text-[#888] text-sm leading-relaxed">
              Every file you upload is instantly checked by an advanced AI system. It scans for hidden viruses and threats to ensure your vault stays clean.
            </p>
          </div>

          {/* Card 3 */}
          <div className="bg-[#0a0a0a] border border-[#222] p-8 rounded-xl hover:border-[#444] transition-colors">
            <Network className="text-green-500 mb-6" size={32}/>
            <h3 className="text-lg font-medium text-[#e3e3e3] mb-3">3. Global Verification</h3>
            <p className="text-[#888] text-sm leading-relaxed">
              To eliminate false positives, any suspicious file flagged by the AI is automatically cross-referenced against the VirusTotal API to guarantee the threat is accurately blocked before entering the vault.
            </p>
          </div>

        </div>
      </div>

      {/* Tech Stack Strip */}
      <div className="w-full py-10 bg-[#050505] border-t border-b border-[#222]">
        <div className="max-w-[1200px] mx-auto px-8 text-center">
          <p className="text-xl md:text-sm font-medium text-[#888] mb-3 tracking-tight">Powered by modern, scalable technologies</p>
          <div className="flex flex-wrap justify-center items-center gap-6 md:gap-16 text-xl md:text-2xl font-semibold text-[#e3e3e3] tracking-tight">
            {/* <span className="hover:text-[#e3e3e3] transition-colors cursor-default">React & Vite</span>
            <span className="text-[#333]">/</span>
            <span className="hover:text-[#e3e3e3] transition-colors cursor-default">Python FastAPI</span>
            <span className="text-[#333]">/</span>
            <span className="hover:text-[#e3e3e3] transition-colors cursor-default">S3-Compatible Storage</span>
            <span className="text-[#333]">/</span>
            <span className="hover:text-[#e3e3e3] transition-colors cursor-default">Machine Learning</span> */}
          </div>
        </div>
      </div>

      {/* Big Bottom CTA */}
      <div className="w-full py-33 px-8 text-center relative overflow-hidden">
        {/* Subtle Glow Effect behind CTA */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-green-500/5 blur-[100px] rounded-full pointer-events-none"></div>

        <div className="relative z-10 max-w-3xl mx-auto">
          <h2 className="text-5xl md:text-6xl font-bold text-[#e3e3e3] mb-6 tracking-tight">Ready to secure your digital assets?</h2>
          <p className="text-[#888] text-lg mb-10 font-light max-w-xl mx-auto">
            Join the next generation of cloud storage. Experience zero-trust file management with real-time AI threat detection.
          </p>
          <Link to="/login" className="px-10 py-4 bg-[#e3e3e3] text-black hover:bg-[#c4c7c5] transition-colors rounded font-medium text-lg shadow-[0_0_30px_rgba(227,227,227,0.1)] inline-block">
            Open Your Vault Now
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="w-full py-8 border-t border-[#222] bg-black flex flex-col md:flex-row items-center justify-between px-8 text-[#555] text-sm font-mono">
        <div>&copy; 2026 CloudGuard. All rights reserved.</div>
        <div className="flex gap-6 mt-4 md:mt-0">
          <a href="https://github.com/nizam-ahamad/CloudGuard" target="_blank" rel="noreferrer" className="hover:text-[#e3e3e3] transition-colors">
            GitHub Repository
          </a>
        </div>
      </footer>

    </div>
  );
}
