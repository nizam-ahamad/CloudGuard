import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Terminal, 
  ShieldCheck, 
  FileCode2, 
  FolderLock, 
  CloudUpload, 
  Cpu, 
  Network, 
  HardDrive, 
  ChevronDown,
  ArrowRight,
  Sparkles,
  Server,
  Layers,
  FileCheck
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

  const faqItems = [
    {
      question: "How does CloudGuard detect malicious files before storage?",
      answer: "Every uploaded binary or document undergoes real-time pre-ingestion inspection via a high-performance Python FastAPI microservice. Using a Scikit-Learn Random Forest model, CloudGuard performs static PE header analysis, byte entropy checks, and suspicious section evaluations. If ambiguity persists, it triggers automated VirusTotal API fallback verification before the file can reach the vault."
    },
    {
      question: "What happens if a file is flagged as suspicious?",
      answer: "If our machine learning classifier or VirusTotal heuristics identify malicious signatures or suspicious characteristics, ingestion is immediately aborted. The payload is quarantined in an ephemeral sandbox and blocked from S3 persistence, shielding your storage environment and teammates from accidental distribution."
    },
    {
      question: "Can I stream large videos and view PDFs directly in the browser?",
      answer: "Yes. CloudGuard supports native HTTP 206 Partial Content range requests, allowing smooth seeking and instant playback for large MP4 and WebM videos without full downloads. In addition, an inline PDF renderer lets you inspect documentation safely, and multi-file selections can be dynamically packaged into streamed ZIP archives on the fly."
    },
    {
      question: "Is my stored data protected against unauthorized access?",
      answer: "All storage assets reside inside isolated, policy-locked AWS S3 buckets guarded by ephemeral, pre-signed URLs with strict expirations. With zero-trust access control, stateless JWT authentication, and scoped authorization tokens, no unauthenticated user or external proxy can read your private objects directly."
    }
  ];

  const pipelineSteps = [
    {
      step: "01",
      title: "Browser Ingestion",
      desc: "Client initiates encrypted TLS payload transmission with direct pre-signed URL coordination.",
      icon: CloudUpload
    },
    {
      step: "02",
      title: "Node.js Gateway",
      desc: "Stateless Express API verifies JWT identity, validates mime schemas, and routes upload payloads.",
      icon: Server
    },
    {
      step: "03",
      title: "Python ML Inspection",
      desc: "FastAPI microservice conducts PE header inspection, entropy scanning, and VirusTotal fallbacks.",
      icon: Cpu
    },
    {
      step: "04",
      title: "Secure S3 Vault",
      desc: "Clean payloads persist in policy-restricted AWS S3 buckets with ephemeral pre-signed access tokens.",
      icon: ShieldCheck
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
          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-medium mb-8 tracking-tighter text-[#e3e3e3] leading-[1.1]">
            CloudGuard Vault. <br />
            <span className="text-[#888] whitespace-nowrap">{heroText}<span className="text-white animate-pulse">|</span></span>
          </h1>
          <p className="text-xl text-[#888] max-w-xl mb-12 font-light leading-relaxed">
            A highly secure file management system built on scalable cloud infrastructure. Every upload is analyzed in real-time by a custom Python microservice utilizing Random Forest machine learning and VirusTotal API fallbacks.
          </p>
          <div className="flex items-center justify-start gap-4">
            <Link to="/login" className="px-8 py-4 bg-[#e3e3e3] text-black hover:bg-[#c4c7c5] transition-colors rounded font-medium text-lg shadow-[0_0_30px_rgba(227,227,227,0.15)] inline-flex items-center gap-2">
              <span>Initialize Vault</span>
              <ArrowRight size={18} />
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

      </section>

      {/* Feature Highlights: 3-Column Grid */}
      <section className="w-full max-w-[1400px] mx-auto pt-20 pb-24 px-8 border-t border-[#222] relative z-10">
        <div className="max-w-2xl mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-800 bg-neutral-900/60 text-xs font-mono text-neutral-400 mb-4">
            <Layers size={13} className="text-blue-400" />
            <span>Core Capabilities</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-[#e3e3e3] mb-4">
            Engineered for high assurance and zero compromise.
          </h2>
          <p className="text-neutral-400 font-light leading-relaxed">
            CloudGuard blends machine learning threat detection with distributed object storage to deliver deep enterprise-grade security.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Card 1: Pre-Ingestion AI Malware Detection */}
          <div className="group bg-[#0a0a0a] border border-neutral-800 p-8 rounded-2xl relative transition-all duration-300 hover:border-neutral-600 hover:shadow-[0_0_30px_rgba(255,255,255,0.03)] flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-6 group-hover:scale-105 transition-transform">
                <Cpu size={24} />
              </div>
              <h3 className="text-xl font-medium text-[#e3e3e3] mb-3 tracking-tight">
                Pre-Ingestion AI Malware Detection
              </h3>
              <p className="text-neutral-400 text-sm leading-relaxed mb-6 font-light">
                High-throughput Python FastAPI microservice powered by a Scikit-Learn Random Forest model. Evaluates static PE headers, byte entropy distributions, and suspicious import sections before files are allowed into storage, with automated VirusTotal API fallback verification.
              </p>
            </div>
            <div className="pt-4 border-t border-neutral-900 flex items-center gap-2 font-mono text-xs text-neutral-500">
              <FileCheck size={14} className="text-purple-400" />
              <span>FastAPI &bull; Random Forest &bull; VirusTotal</span>
            </div>
          </div>

          {/* Card 2: Encrypted S3 Storage & Zero Trust */}
          <div className="group bg-[#0a0a0a] border border-neutral-800 p-8 rounded-2xl relative transition-all duration-300 hover:border-neutral-600 hover:shadow-[0_0_30px_rgba(255,255,255,0.03)] flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-6 group-hover:scale-105 transition-transform">
                <FolderLock size={24} />
              </div>
              <h3 className="text-xl font-medium text-[#e3e3e3] mb-3 tracking-tight">
                Encrypted S3 Storage & Zero Trust
              </h3>
              <p className="text-neutral-400 text-sm leading-relaxed mb-6 font-light">
                Uploads stream through short-lived pre-signed AWS S3 URLs governed by strict bucket isolation policies. No public bucket exposure, strict JWT authorization checkpoints, and scoped permissions prevent cross-tenant data leakage.
              </p>
            </div>
            <div className="pt-4 border-t border-neutral-900 flex items-center gap-2 font-mono text-xs text-neutral-500">
              <ShieldCheck size={14} className="text-blue-400" />
              <span>AWS S3 &bull; Pre-Signed URLs &bull; Zero-Trust</span>
            </div>
          </div>

          {/* Card 3: High-Performance Media Streaming */}
          <div className="group bg-[#0a0a0a] border border-neutral-800 p-8 rounded-2xl relative transition-all duration-300 hover:border-neutral-600 hover:shadow-[0_0_30px_rgba(255,255,255,0.03)] flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-6 group-hover:scale-105 transition-transform">
                <HardDrive size={24} />
              </div>
              <h3 className="text-xl font-medium text-[#e3e3e3] mb-3 tracking-tight">
                High-Performance Media Streaming
              </h3>
              <p className="text-neutral-400 text-sm leading-relaxed mb-6 font-light">
                Experience instant seek times for MP4 and WebM videos via HTTP 206 Partial Content range streaming. Enjoy safe inline PDF previewing directly in your browser without client-side risk, along with dynamic multi-file ZIP folder bundling.
              </p>
            </div>
            <div className="pt-4 border-t border-neutral-900 flex items-center gap-2 font-mono text-xs text-neutral-500">
              <Network size={14} className="text-emerald-400" />
              <span>HTTP 206 &bull; PDF Renderer &bull; Dynamic Archiving</span>
            </div>
          </div>

        </div>
      </section>

      {/* System Architecture Overview: 4-Step Pipeline */}
      <section className="w-full max-w-[1400px] mx-auto py-20 px-8 border-t border-[#222] relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-800 bg-neutral-900/60 text-xs font-mono text-neutral-400 mb-4">
            <Network size={13} className="text-emerald-400" />
            <span>End-to-End Pipeline</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-[#e3e3e3] mb-4">
            System Architecture Overview
          </h2>
          <p className="text-neutral-400 font-light leading-relaxed">
            Every payload navigates a deterministic 4-stage pipeline designed to isolate, verify, and persist data safely.
          </p>
        </div>

        {/* 4-Step Architecture Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {pipelineSteps.map((step, idx) => {
            const Icon = step.icon;
            return (
              <div 
                key={idx}
                className="bg-[#0a0a0a] border border-neutral-800 rounded-xl p-6 relative hover:border-neutral-600 transition-colors flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <span className="font-mono text-2xl font-bold text-neutral-600 tracking-wider">
                      {step.step}
                    </span>
                    <div className="w-10 h-10 rounded-lg bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-300">
                      <Icon size={20} />
                    </div>
                  </div>
                  <h3 className="text-lg font-medium text-[#e3e3e3] mb-2 tracking-tight">
                    {step.title}
                  </h3>
                  <p className="text-neutral-400 text-sm font-light leading-relaxed mb-4">
                    {step.desc}
                  </p>
                </div>
                <div className="flex items-center text-neutral-600 font-mono text-xs pt-3 border-t border-neutral-900">
                  <span>Stage {idx + 1} of 4</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Visual Pipeline Bar */}
        <div className="mt-8 p-4 bg-[#050505] border border-neutral-800 rounded-xl hidden lg:flex items-center justify-between text-xs font-mono text-neutral-400">
          <span className="text-neutral-300 font-medium">Browser Ingestion</span>
          <span className="text-neutral-600">&rarr;</span>
          <span className="text-neutral-300 font-medium">Node.js Gateway</span>
          <span className="text-neutral-600">&rarr;</span>
          <span className="text-neutral-300 font-medium">Python ML Inspection</span>
          <span className="text-neutral-600">&rarr;</span>
          <span className="text-neutral-300 font-medium">Secure S3 Vault</span>
        </div>
      </section>

      {/* FAQ Accordion Section */}
      <section className="w-full max-w-[1000px] mx-auto py-20 px-8 border-t border-[#222] relative z-10">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-800 bg-neutral-900/60 text-xs font-mono text-neutral-400 mb-4">
            <ShieldCheck size={13} className="text-purple-400" />
            <span>Frequently Asked Questions</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-[#e3e3e3] mb-4">
            Questions & Answers
          </h2>
          <p className="text-neutral-400 font-light leading-relaxed">
            Everything you need to know about CloudGuard Vault&apos;s security, scanning engine, and cloud architecture.
          </p>
        </div>

        <div className="space-y-4">
          {faqItems.map((item, index) => {
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
                    {item.question}
                  </span>
                  <ChevronDown 
                    size={20} 
                    className={`text-neutral-400 flex-shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180 text-white' : ''}`}
                  />
                </button>
                {isOpen && (
                  <div className="px-6 pb-6 pt-1 text-sm text-neutral-400 font-light leading-relaxed border-t border-neutral-900">
                    {item.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Big Bottom CTA */}
      <section className="w-full py-32 px-8 text-center relative overflow-hidden border-t border-[#222]">
        {/* Subtle Glow Effect behind CTA */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-emerald-500/5 blur-[100px] rounded-full pointer-events-none"></div>

        <div className="relative z-10 max-w-3xl mx-auto">
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-bold text-[#e3e3e3] mb-6 tracking-tight">Ready to secure your digital assets?</h2>
          <p className="text-neutral-400 text-lg mb-10 font-light max-w-xl mx-auto">
            Join the next generation of cloud storage. Experience zero-trust file management with real-time AI threat detection.
          </p>
          <Link to="/login" className="px-10 py-4 bg-[#e3e3e3] text-black hover:bg-[#c4c7c5] transition-colors rounded font-medium text-lg shadow-[0_0_30px_rgba(227,227,227,0.1)] inline-flex items-center gap-2">
            <span>Open Your Vault Now</span>
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full py-8 border-t border-[#222] bg-black flex flex-col md:flex-row items-center justify-between px-8 text-neutral-500 text-sm font-mono">
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
