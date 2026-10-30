import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Terminal, 
  ShieldCheck, 
  FileCode2, 
  ChevronDown,
  ArrowRight,
  Sparkles,
  Lock,
  PlayCircle
} from 'lucide-react';
import CloudGuardLogo from '../CloudGuardLogo';

export default function LandingPage() {
  const [heroText, setHeroText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [loopNum, setLoopNum] = useState(0);
  const [openFaq, setOpenFaq] = useState(null);

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
  }, [lineIndex, terminalLines.length]);

  const toggleFaq = (index) => {
    setOpenFaq(prev => prev === index ? null : index);
  };

  const faqs = [
    {
      q: "How does CloudGuard protect my files?",
      a: "The moment you upload any file, our automated scanner checks it for viruses, ransomware, and malicious code. If anything looks suspicious, it is quarantined immediately."
    },
    {
      q: "Can I watch videos or view PDFs without downloading them?",
      a: "Yes! CloudGuard streams video smoothly and opens PDFs, images, and documents directly inside your browser so you don't waste device storage."
    },
    {
      q: "Who can see the files I upload?",
      a: "Only you. Every file is protected behind your private login and encrypted cloud storage. No one else has access to your vault."
    },
    {
      q: "What types of files can I store?",
      a: "You can upload all common file formats, including documents, high-resolution photos, videos, and archives up to 5GB per batch."
    }
  ];

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-black text-[#e3e3e3] font-sans">
      
      {/* Subtle Grid Background */}
      <div className="absolute inset-0 z-0 opacity-20 pointer-events-none" 
           style={{ backgroundImage: 'radial-gradient(#333 1px, transparent 1px)', backgroundSize: '32px 32px' }}>
      </div>

      {/* Top Navigation Bar */}
      <nav className="w-full flex items-center justify-between px-8 py-6 border-b border-[#222] bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <CloudGuardLogo className="h-10 w-auto flex-shrink-0 text-[#e3e3e3] fill-current invert dark:invert" />
          <span className="text-2xl font-semibold tracking-tight text-[#e3e3e3]">CloudGuard</span>
        </div>
        <div className="flex items-center gap-6">
          <Link to="/login" className="px-6 py-2 text-xs font-mono uppercase tracking-widest text-slate-400 transition-all duration-300 border border-slate-700 rounded hover:border-white hover:text-white hover:bg-white/5">
            LOGIN
          </Link>
        </div>
      </nav>

      {/* Render-Style Split Layout Hero */}
      <section className="flex flex-col lg:flex-row items-center lg:items-start justify-between pt-16 pb-22 px-8 relative z-10 w-full max-w-[1400px] mx-auto gap-16">
        
        {/* Left Side: Hero Text */}
        <div className="w-full flex-1 text-left lg:pt-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-800 bg-neutral-900/60 text-xs font-mono text-neutral-400 mb-6">
            <Sparkles size={13} className="text-emerald-400" />
            <span>Zero-Trust Cloud Storage Architecture</span>
          </div>
          
          {/* Heading with fixed min-height to eliminate CLS during typewriter transitions */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white mb-8 leading-[1.15]">
            <span className="block">CloudGuard Vault.</span>
            <span className="block text-neutral-400 whitespace-nowrap text-3xl sm:text-4xl lg:text-5xl font-semibold mt-1 min-h-[1.25em] sm:min-h-[1.3em]">
              {heroText}
              <span className="animate-pulse">|</span>
            </span>
          </h1>

          <p className="text-xl text-[#888] max-w-xl mb-12 font-light leading-relaxed">
            A secure cloud file vault with real-time malware defense. Store, preview, and share your personal and enterprise files with full privacy.
          </p>
          <div className="flex items-center justify-start gap-4">
            <Link to="/login" className="px-8 py-4 bg-[#e3e3e3] text-black hover:bg-[#c4c7c5] transition-colors rounded font-medium text-lg shadow-[0_0_30px_rgba(227,227,227,0.15)] inline-flex items-center gap-2">
              <span>Initialize Vault</span>
              <ArrowRight size={18} />
            </Link>
          </div>
        </div>

        {/* Right Side: Terminal Window */}
        <div className="w-full lg:w-5/12 flex flex-col gap-6 min-w-0">
          
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

          <div className="w-full bg-[#0a0a0a] border border-[#222] rounded-xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-mono text-xs text-[#888]">/src/dashboard/MyFiles.jsx</h3>
              <ShieldCheck className="text-[#555]" size={18} />
            </div>
            <div className="p-3 bg-[#111] border border-[#222] rounded flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileCode2 className="text-[#888]" size={18} />
                <span className="font-medium text-[#e3e3e3] text-sm">cloud_storage_keys.pem</span>
              </div>
              <span className="font-mono text-[10px] text-green-500 bg-green-500/10 px-2 py-1 rounded border border-green-500/20">CLEAN</span>
            </div>
          </div>

        </div>

      </section>

      {/* Feature Highlights: 3 Simplified Cards */}
      <section className="w-full max-w-[1400px] mx-auto pt-20 pb-24 px-8 border-t border-[#222] relative z-10">
        <div className="max-w-2xl mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-[#e3e3e3] mb-4">
            Security and simplicity, combined.
          </h2>
          <p className="text-neutral-400 font-light leading-relaxed">
            Everything you need to store, inspect, and access your files without worrying about security threats.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Card 1: Automatic Virus Scanning */}
          <div className="group bg-[#0a0a0a] border border-neutral-800 p-8 rounded-2xl relative transition-all duration-300 hover:border-neutral-600 hover:shadow-[0_0_30px_rgba(255,255,255,0.03)] flex flex-col justify-start">
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-6 group-hover:scale-105 transition-transform">
              <ShieldCheck size={24} />
            </div>
            <h3 className="text-xl font-medium text-[#e3e3e3] mb-3 tracking-tight">
              Automatic Virus Scanning
            </h3>
            <p className="text-neutral-400 text-sm leading-relaxed font-light">
              Every file you upload is checked for malware and hidden threats in real time. Dangerous files are stopped before they ever reach your storage.
            </p>
          </div>

          {/* Card 2: Private & Fully Encrypted */}
          <div className="group bg-[#0a0a0a] border border-neutral-800 p-8 rounded-2xl relative transition-all duration-300 hover:border-neutral-600 hover:shadow-[0_0_30px_rgba(255,255,255,0.03)] flex flex-col justify-start">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-6 group-hover:scale-105 transition-transform">
              <Lock size={24} />
            </div>
            <h3 className="text-xl font-medium text-[#e3e3e3] mb-3 tracking-tight">
              Private & Fully Encrypted
            </h3>
            <p className="text-neutral-400 text-sm leading-relaxed font-light">
              Your files are stored in an encrypted vault built on secure cloud infrastructure. Only you hold the access to open, download, or share them.
            </p>
          </div>

          {/* Card 3: Instant Video & File Previews */}
          <div className="group bg-[#0a0a0a] border border-neutral-800 p-8 rounded-2xl relative transition-all duration-300 hover:border-neutral-600 hover:shadow-[0_0_30px_rgba(255,255,255,0.03)] flex flex-col justify-start">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-6 group-hover:scale-105 transition-transform">
              <PlayCircle size={24} />
            </div>
            <h3 className="text-xl font-medium text-[#e3e3e3] mb-3 tracking-tight">
              Instant Video & File Previews
            </h3>
            <p className="text-neutral-400 text-sm leading-relaxed font-light">
              Watch videos and preview documents directly in your browser with zero lag and no forced downloads.
            </p>
          </div>

        </div>
      </section>

      {/* FAQ Accordion Section */}
      <section className="w-full max-w-[1000px] mx-auto py-20 px-8 border-t border-[#222] relative z-10">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-[#e3e3e3] mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-neutral-400 font-light leading-relaxed">
            Everything you need to know about using CloudGuard Vault to secure and access your files.
          </p>
        </div>

        <div className="space-y-4">
          {faqs.map((item, index) => {
            const isOpen = openFaq === index;
            return (
              <div 
                key={index}
                className="bg-[#0a0a0a] border border-neutral-800 rounded-xl overflow-hidden transition-colors hover:border-neutral-700"
              >
                <button
                  type="button"
                  onClick={() => toggleFaq(index)}
                  className="w-full text-left px-6 py-5 flex items-center justify-between gap-4 focus:outline-none"
                  aria-expanded={isOpen}
                >
                  <span className="text-base sm:text-lg font-medium text-[#e3e3e3] tracking-tight">
                    {item.q}
                  </span>
                  <ChevronDown 
                    size={20} 
                    className={`text-neutral-400 flex-shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180 text-white' : ''}`}
                  />
                </button>
                {isOpen && (
                  <div className="px-6 pb-6 pt-1 text-sm text-neutral-400 font-light leading-relaxed border-t border-neutral-900">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Big Bottom CTA */}
      <section className="w-full py-12 sm:py-20 px-4 text-center relative overflow-hidden border-t border-[#222]">
        {/* Subtle Glow Effect behind CTA */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-emerald-500/5 blur-[100px] rounded-full pointer-events-none"></div>

        <div className="relative z-10 max-w-3xl mx-auto">
          <h2 className="text-3xl sm:text-5xl md:text-6xl font-bold text-[#e3e3e3] mb-4 sm:mb-6 tracking-tight">Ready to secure your digital assets?</h2>
          <p className="text-neutral-400 text-base sm:text-lg mb-8 sm:mb-10 font-light max-w-xl mx-auto">
            Join the next generation of cloud storage. Experience zero-trust file management with real-time AI threat detection.
          </p>
          <Link 
            to="/login" 
            className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3.5 rounded-xl font-medium text-black bg-white hover:bg-neutral-200 transition-colors gap-2"
          >
            <span>Open Your Vault Now</span>
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-900 bg-black/60 py-8 px-4">
        <div className="max-w-7xl mx-auto flex flex-col items-center justify-center gap-4 text-center text-xs text-neutral-400">
          
          {/* Navigation Links: Balanced Row with subtle dots */}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-normal">
            <Link className="hover:text-white transition-colors" to="/privacy">
              Privacy Policy
            </Link>
            <span className="text-neutral-700 select-none">•</span>
            <Link className="hover:text-white transition-colors" to="/terms">
              Terms of Service
            </Link>
            <span className="text-neutral-700 select-none">•</span>
            <a 
              href="https://github.com/nizam-ahamad/CloudGuard" 
              target="_blank" 
              rel="noreferrer" 
              className="hover:text-white transition-colors"
            >
              GitHub
            </a>
          </div>

          {/* Copyright Note */}
          <p className="text-neutral-500 font-light tracking-wide">
            © {new Date().getFullYear()} CloudGuard Vault. All rights reserved.
          </p>
        </div>
      </footer>

    </div>
  );
}
