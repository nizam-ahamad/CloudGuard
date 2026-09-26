import { motion } from 'framer-motion';
import { Bug } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#131314] text-[#e3e3e3] flex flex-col items-center justify-center overflow-hidden font-sans">
      
      {/* Hero Text */}
      <div className="text-center z-10 mb-12">
        <h1 className="text-5xl font-bold mb-4 tracking-tight">CloudGuard</h1>
        <p className="text-xl text-[#a0a3a7]">Next-Gen Secure Digital Vault.</p>
      </div>

      {/* Animation Canvas */}
      <div className="relative w-full max-w-2xl h-48 mx-auto flex items-center justify-center overflow-hidden mb-12">
        
        {/* The Attacking Shark */}
        <motion.img 
          src="/cloudguard-logo.svg" 
          alt="Shark"
          className="absolute z-20 w-32 h-32 drop-shadow-xl"
          style={{ filter: "brightness(0) invert(1)" }}
          initial={{ left: "-20%", opacity: 0 }}
          animate={{ left: "40%", opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.2, type: "spring", stiffness: 120 }}
        />

        {/* The Virus */}
        <motion.div
          className="absolute z-10 text-red-500"
          style={{ left: "50%" }}
          initial={{ scale: 1, opacity: 1 }}
          animate={{ scale: [1, 1.2, 0], opacity: [1, 1, 0] }}
          transition={{ times: [0, 0.8, 1], duration: 0.8, delay: 0.3 }}
        >
          <Bug size={64} />
        </motion.div>

      </div>

      {/* CTA Button */}
      <Link to="/login" className="px-8 py-3 bg-[#1e1f20] border-2 border-[#282a2c] hover:border-blue-500 hover:text-blue-500 transition-all duration-300 rounded-lg font-medium shadow-lg z-10">
        Enter Vault
      </Link>
    </div>
  );
}
