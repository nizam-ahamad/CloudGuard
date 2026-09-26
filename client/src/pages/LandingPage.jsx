import React from 'react';
import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#131314] text-zinc-100 flex flex-col">
      <nav className="w-full flex items-center justify-between px-8 py-6 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <h1 className="font-headline-md text-2xl font-bold text-[#e3e3e3]">CloudGuard</h1>
        </div>
        <Link 
          to="/login"
          className="px-6 py-2 bg-[#1e1f20] hover:bg-[#282a2c] text-[#e3e3e3] border border-zinc-700 rounded-lg font-medium transition-colors"
        >
          Sign In
        </Link>
      </nav>
      
      <section className="flex-1 flex flex-col items-center justify-center px-4 text-center">
        <h2 className="text-5xl md:text-7xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 mb-6">
          Next-Gen Cloud Security
        </h2>
        <p className="text-xl text-[#c4c7c5] max-w-2xl mb-10">
          The most secure way to store, scan, and manage your digital life.
        </p>
        <Link 
          to="/login"
          className="px-8 py-4 bg-primary text-on-primary font-bold rounded-xl hover:bg-primary/90 transition-colors text-lg shadow-lg shadow-primary/20"
        >
          Get Started for Free
        </Link>
      </section>
    </div>
  );
}
