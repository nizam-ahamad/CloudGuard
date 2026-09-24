import React, { useState, useRef } from 'react';
import axios from 'axios';

export default function OTPVerification({ email, onVerifySuccess, onCancel }) {
  const [otp, setOtp] = useState(new Array(6).fill(''));
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRefs = useRef([]);

  const handleChange = (e, index) => {
    const value = e.target.value;
    if (isNaN(value)) return;
    
    const newOtp = [...otp];
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);

    if (value && index < 5 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1].focus();
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0 && inputRefs.current[index - 1]) {
      inputRefs.current[index - 1].focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').slice(0, 6).split('');
    const newOtp = [...otp];
    pastedData.forEach((char, idx) => {
      if (idx < 6 && !isNaN(char)) {
        newOtp[idx] = char;
      }
    });
    setOtp(newOtp);
    const nextIndex = Math.min(pastedData.length, 5);
    inputRefs.current[nextIndex].focus();
  };

  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  const handleSubmit = async (e) => {
    e.preventDefault();
    const otpValue = otp.join('');
    if (otpValue.length < 6) {
      setError('Please enter a 6-digit OTP.');
      return;
    }
    setError('');
    setIsLoading(true);
    
    try {
      const res = await axios.post(`${API_BASE_URL}/api/auth/verify-otp`, { email, otp: otpValue });
      if (res.status === 200) {
        onVerifySuccess();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full mx-auto">
      <div className="flex flex-col items-center mb-8">
        <div className="w-16 h-16 rounded-xl bg-surface-container-high flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-secondary text-3xl" data-weight="fill">mark_email_read</span>
        </div>
        <h1 className="font-headline-md text-primary font-bold">Verify your email</h1>
        <p className="text-on-surface-variant mt-2 font-body-md text-center">
          We sent a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-3 bg-error/10 border border-error/20 rounded-lg text-error text-sm text-center">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex justify-between gap-2 max-w-sm mx-auto">
          {otp.map((digit, index) => (
            <input
              key={index}
              type="text"
              maxLength="1"
              value={digit}
              ref={el => inputRefs.current[index] = el}
              onChange={(e) => handleChange(e, index)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              onPaste={handlePaste}
              className="w-12 h-14 text-center text-xl font-bold bg-surface-container-lowest border border-outline-variant rounded-lg focus:ring-2 focus:ring-secondary outline-none transition-all"
            />
          ))}
        </div>

        <button 
          type="submit" 
          disabled={isLoading}
          className={`w-full py-3 bg-primary text-on-primary rounded-lg font-medium hover:bg-primary/90 transition-colors shadow-sm ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin inline-block w-4 h-4 border-[2px] border-current border-t-transparent rounded-full" role="status" aria-label="loading"></span>
              Verifying...
            </span>
          ) : (
            'Verify Email'
          )}
        </button>
      </form>
      
      {onCancel && (
        <div className="mt-6 text-center">
          <button 
            type="button"
            onClick={onCancel}
            className="text-secondary text-sm hover:underline font-medium"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
