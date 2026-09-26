import React from 'react';
import { motion } from 'framer-motion';
import { Bug } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#131314] text-[#e3e3e3] flex flex-col items-center justify-center overflow-hidden">
      <div className="relative flex items-center justify-center w-full max-w-2xl h-64 mb-8">
        <motion.img 
          src="/cloudguard-logo-fav.svg" 
          alt="CloudGuard Shark" 
          className="absolute left-1/4 w-32 h-32 z-10" 
          initial={{ x: -400, opacity: 0 }} 
          animate={{ x: 50, opacity: 1 }} 
          transition={{ type: "spring", stiffness: 120, damping: 12, delay: 0.2 }} 
        />
        <motion.div 
          className="absolute right-1/4 z-0" 
          initial={{ scale: 1, opacity: 1 }} 
          animate={{ scale: 0, opacity: 0 }} 
          transition={{ delay: 0.9, duration: 0.2 }}
        >
          <Bug className="text-red-500 w-16 h-16" />
        </motion.div>
      </div>

      <Link 
        to="/login" 
        className="px-8 py-3 bg-[#1e1f20] border border-[#282a2c] hover:border-blue-500 hover:text-blue-500 transition-colors rounded-lg font-medium shadow-lg"
      >
        Enter Vault
      </Link>
    </div>
  );
}
