import React from 'react';
import { motion } from 'framer-motion';
import { Bug } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#131314] text-[#e3e3e3] flex flex-col items-center justify-center overflow-hidden">
      <div className="relative w-full max-w-3xl h-64 mx-auto flex items-center overflow-hidden bg-transparent">
        {/* The Attacking Shark */}
        <motion.img 
          src="/cloudguard-logo.svg" 
          alt="Shark"
          className="absolute z-20 w-40 h-40"
          initial={{ left: "-10%", opacity: 0 }}
          animate={{ left: "45%", opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.2, type: "spring", stiffness: 120 }}
        />

        {/* The Virus */}
        <motion.div
          className="absolute z-10 text-red-500"
          style={{ left: "55%" }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [0, 1.2, 1, 0], opacity: [0, 1, 1, 0] }}
          transition={{ times: [0, 0.1, 0.8, 1], duration: 0.9, delay: 0.1 }}
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
