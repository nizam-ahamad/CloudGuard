const rateLimit = require('express-rate-limit');

const isDevelopment = process.env.NODE_ENV !== 'production';

// Skip CORS preflights AND local developer traffic
const skipLocalAndOptions = (req) => {
  if (req.method === 'OPTIONS') return true;
  if (isDevelopment) {
    const ip = req.ip || req.socket?.remoteAddress || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip.includes('127.0.0.1') || ip.includes('localhost')) {
      return true; // Never rate-limit localhost in development
    }
  }
  return false;
};

// 1. Strict Auth Limiter (Login & Registration: max 10 attempts per 15 min per IP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: skipLocalAndOptions,
  standardHeaders: true,
  legacyHeaders: false,
  message: { 
    success: false, 
    error: 'Too many login or registration attempts. Please try again after 15 minutes.' 
  },
});

// 2. Ultra-Strict OTP Limiter (Brute-Force & Email Abuse Prevention: max 5 attempts per 15 min per IP)
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skip: skipLocalAndOptions,
  standardHeaders: true,
  legacyHeaders: false,
  message: { 
    success: false, 
    error: 'Too many verification attempts. Please wait 15 minutes before trying again.' 
  },
});

// 3. Global Baseline API Limiter (DDoS & Scraping Protection: max 300 requests per 15 min per IP)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  skip: skipLocalAndOptions,
  standardHeaders: true,
  legacyHeaders: false,
  message: { 
    success: false, 
    error: 'Too many requests. Please slow down.' 
  },
});

module.exports = { authLimiter, otpLimiter, apiLimiter };
