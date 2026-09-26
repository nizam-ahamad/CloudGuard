import React from 'react';
import { motion } from 'framer-motion';
import { Bug } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#131314] text-[#e3e3e3] flex flex-col items-center justify-center overflow-hidden">
      <div className="relative w-full max-w-lg h-48 mx-auto mb-12 overflow-hidden bg-transparent">
        <motion.img 
          src="/cloudguard-logo-fav.svg" 
          alt="Shark"
          className="absolute top-1/2 -translate-y-1/2 left-0 w-32 h-32 z-20"
          initial={{ x: -150, opacity: 0 }}
          animate={{ x: 280, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.2, type: "spring", stiffness: 100 }}
        />
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 right-16 z-10 text-red-500"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [0, 1.2, 1, 0], opacity: [0, 1, 1, 0] }}
          transition={{ times: [0, 0.1, 0.8, 1], duration: 1, delay: 0.1 }}
        >
          <Bug size={64} />
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
