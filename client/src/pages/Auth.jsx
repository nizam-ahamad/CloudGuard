import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import { Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import SharkLogo from '../components/SharkLogo';
import { API_BASE_URL } from '../config';

export default function AuthPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isOtpMode, setIsOtpMode] = useState(false);
  const [isNewPasswordMode, setIsNewPasswordMode] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpValues, setOtpValues] = useState(['', '', '', '', '', '']);
  const [timer, setTimer] = useState(60);
  const [otpAttempts, setOtpAttempts] = useState(0);
  const [pendingEmail, setPendingEmail] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const navigate = useNavigate();
  const toast = useToast();
  const inputRefs = useRef([]);

  // Timer Effect for OTP
  useEffect(() => {
    let interval;
    if (isOtpMode && timer > 0) {
      interval = setInterval(() => setTimer((prev) => prev - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isOtpMode, timer]);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (formError) setFormError('');
  };

  // Google OAuth Handlers (Memoized to prevent GSI re-initialization warnings)
  const handleGoogleSuccess = useCallback(async (credentialResponse) => {
    try {
      setIsLoading(true);
      const res = await axios.post(`${API_BASE_URL}/api/auth/google`, {
        credential: credentialResponse.credential,
      });

      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));

      window.dispatchEvent(new Event('cloudguard:auth-changed'));
      window.dispatchEvent(new Event('auth-change'));
      window.dispatchEvent(new Event('storage'));

      toast.success(`Welcome back, ${res.data.user?.name || 'User'}!`);
      window.location.href = '/dashboard';
    } catch (err) {
      console.error('Google Auth Error:', err);
      const errorMsg = err.response?.data?.error || 'Google authentication failed';
      toast.error(errorMsg);
      setFormError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const handleGoogleError = useCallback(() => {
    toast.error('Google Sign-In failed');
  }, [toast]);

  // OTP handlers
  const handleOtpChange = (index, value) => {
    const numValue = value.replace(/[^0-9]/g, '');
    if (numValue.length > 1) return;

    const newOtp = [...otpValues];
    newOtp[index] = numValue;
    setOtpValues(newOtp);
    if (otpError) setOtpError('');

    if (numValue !== '' && index < 5 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1].focus();
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && otpValues[index] === '' && index > 0 && inputRefs.current[index - 1]) {
      inputRefs.current[index - 1].focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pasteData = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 6);
    if (!pasteData) return;
    const newOtp = [...otpValues];
    for (let i = 0; i < pasteData.length; i++) {
      newOtp[i] = pasteData[i];
    }
    setOtpValues(newOtp);
    if (otpError) setOtpError('');
    const nextFocus = Math.min(pasteData.length, 5);
    if (inputRefs.current[nextFocus]) {
      inputRefs.current[nextFocus].focus();
    }
  };

  const handleResendOtp = async () => {
    setIsLoading(true);
    setFormError('');
    setOtpError('');
    const targetEmail = pendingEmail || formData.email;
    try {
      if (isForgotPassword) {
        await axios.post(`${API_BASE_URL}/api/auth/forgot-password`, { email: targetEmail });
      } else {
        await axios.post(`${API_BASE_URL}/api/auth/register`, {
          name: formData.name || targetEmail.split('@')[0],
          email: targetEmail,
          password: formData.password || 'tempFallback123',
        });
      }
      setTimer(60);
      setOtpValues(['', '', '', '', '', '']);
      setOtpAttempts(0);
      toast.success('A new code has been sent.');
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || 'Failed to resend code.';
      setOtpError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Dedicated Activation OTP Verification Handler with Direct-to-Dashboard Navigation
  const handleVerifyActivationOtp = async (e) => {
    if (e) e.preventDefault();
    const enteredOtp = (otpValues.join('') || '').trim();

    if (!enteredOtp || enteredOtp.length !== 6) {
      setOtpError('Please enter the 6-digit verification code.');
      toast.error('Please enter the 6-digit verification code.');
      return;
    }

    try {
      setIsLoading(true);
      setOtpError('');
      const targetEmail = pendingEmail || formData.email;
      const res = await axios.post(`${API_BASE_URL}/api/auth/verify-activation-otp`, {
        email: targetEmail,
        otp: enteredOtp,
      });

      // 1. Immediately persist authentication session
      if (res.data?.token) {
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));

        // Notify App.jsx listeners of the authentication update
        window.dispatchEvent(new Event('auth-change'));
        window.dispatchEvent(new Event('storage'));
      }

      toast.success(`Welcome to CloudGuard, ${res.data?.user?.name || ''}!`);

      // 2. Direct transition to dashboard (replace history so back button doesn't loop OTP)
      navigate('/dashboard', { replace: true });
    } catch (err) {
      console.error('Activation OTP Error:', err);
      const newAttempts = otpAttempts + 1;
      setOtpAttempts(newAttempts);
      const msg = newAttempts >= 3 
        ? 'Too many failed attempts. Request a new code.' 
        : (err.response?.data?.error || err.response?.data?.message || 'Invalid or expired verification code');
      setOtpError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Standard Email/Password Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setFormError('');

    try {
      // 1. Handling New Password Mode
      if (isNewPasswordMode) {
        if (formData.password.length < 8 || !/[a-zA-Z]/.test(formData.password) || !/\d/.test(formData.password)) {
          setFormError('Min. 8 characters, 1 letter, and 1 number.');
          setIsLoading(false);
          return;
        }
        if (formData.password !== formData.confirmPassword) {
          setFormError('Passwords do not match.');
          setIsLoading(false);
          return;
        }

        const targetEmail = pendingEmail || formData.email;
        const enteredOtp = otpValues.join('');

        await axios.post(`${API_BASE_URL}/api/auth/reset-password`, {
          email: targetEmail,
          otp: enteredOtp,
          newPassword: formData.password,
        });
        toast.success('Password reset successfully. Please log in.');
        setIsNewPasswordMode(false);
        setIsForgotPassword(false);
        setIsSignUp(false);
        setFormData({ ...formData, password: '', confirmPassword: '' });
        return;
      }

      // 2. Handling OTP Verification Mode
      if (isOtpMode) {
        const enteredOtp = otpValues.join('');
        if (enteredOtp.length < 6) {
          setOtpError('Please enter the full 6-digit code.');
          setIsLoading(false);
          return;
        }
        if (otpAttempts >= 3) {
          setOtpError('Too many failed attempts. Request a new code.');
          setIsLoading(false);
          return;
        }

        const targetEmail = pendingEmail || formData.email;

        if (isForgotPassword) {
          try {
            await axios.post(`${API_BASE_URL}/api/auth/verify-otp`, {
              email: targetEmail,
              otp: enteredOtp,
              type: 'reset',
            });
            setIsOtpMode(false);
            setIsNewPasswordMode(true);
          } catch (err) {
            const newAttempts = otpAttempts + 1;
            setOtpAttempts(newAttempts);
            const msg = newAttempts >= 3 ? 'Too many failed attempts.' : (err.response?.data?.message || err.response?.data?.error || 'Invalid verification code.');
            setOtpError(msg);
          }
          return;
        }

        // Account Activation Verification
        await handleVerifyActivationOtp(e);
        return;
      }

      // 3. Handling Forgot Password Request
      if (isForgotPassword) {
        if (!formData.email) {
          setFormError('Please enter your email.');
          setIsLoading(false);
          return;
        }
        setPendingEmail(formData.email);
        await axios.post(`${API_BASE_URL}/api/auth/forgot-password`, { email: formData.email });
        setIsOtpMode(true);
        setTimer(60);
        setOtpValues(['', '', '', '', '', '']);
        setOtpAttempts(0);
        toast.success('Password reset code sent to your email.');
        return;
      }

      // 4. Handling Sign Up
      if (isSignUp) {
        if (formData.password.length < 8 || !/[a-zA-Z]/.test(formData.password) || !/\d/.test(formData.password)) {
          setFormError('Min. 8 characters, 1 letter, and 1 number.');
          setIsLoading(false);
          return;
        }

        const res = await axios.post(`${API_BASE_URL}/api/auth/register`, {
          name: formData.name,
          email: formData.email,
          password: formData.password,
        });

        if (res.data?.requireOtp) {
          setPendingEmail(res.data.email || formData.email);
          setIsOtpMode(true);
          setTimer(60);
          setOtpValues(['', '', '', '', '', '']);
          setOtpAttempts(0);
          toast.success(res.data.message || 'Verification code sent to your email.');
        }
        return;
      }

      // 5. Handling Login
      const endpoint = `${API_BASE_URL}/api/auth/login`;
      console.log(`[Auth] Submitting login to ${endpoint}:`, { email: formData.email });

      const res = await axios.post(endpoint, {
        email: formData.email.toLowerCase().trim(),
        password: formData.password,
      });

      console.log('[Auth] Server response:', res.data);

      if (res.data?.requireOtp) {
        setPendingEmail(formData.email);
        setIsOtpMode(true);
        setTimer(60);
        setOtpValues(['', '', '', '', '', '']);
        setOtpAttempts(0);
        toast.info(res.data.message || 'Verification code sent to your inbox.');
        return;
      }

      if (!res.data.token) {
        throw new Error('No authentication token received from server.');
      }

      // 1. Store authentication tokens
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user || { email: formData.email }));

      // 2. Dispatch custom event for any listening components
      window.dispatchEvent(new Event('cloudguard:auth-changed'));
      window.dispatchEvent(new Event('auth-change'));
      window.dispatchEvent(new Event('storage'));

      toast.success(`Welcome back, ${res.data.user?.name || 'User'}!`);

      // 3. HARD NAVIGATION: Forces App.jsx to remount and read fresh token from localStorage
      window.location.href = '/dashboard';
    } catch (err) {
      console.error('[Auth] Login error details:', err.response?.data || err.message);

      if (err.response?.data?.requireOtp) {
        setPendingEmail(err.response.data.email || formData.email);
        setIsOtpMode(true);
        setTimer(60);
        setOtpValues(['', '', '', '', '', '']);
        setOtpAttempts(0);
        toast.error(err.response.data.error || 'Please verify your account OTP');
        return;
      }

      const errorMessage =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        'Invalid email or password';

      setFormError(errorMessage);
      toast.error(errorMessage, { duration: 5000 });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-[100dvh] w-full flex items-center justify-center p-4 bg-[#0a0a0c] overflow-hidden select-none">
      
      {/* Subtle Background Grid Pattern */}
      <div 
        className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" 
      />

      <div className="relative w-full max-w-sm rounded-2xl bg-neutral-900/80 border border-neutral-800 p-5 sm:p-6 shadow-2xl backdrop-blur-xl flex flex-col my-auto">
        
        {/* Brand Header (Clickable Back to Landing Page) */}
        <Link 
          to="/" 
          className="flex items-center justify-center gap-2.5 mb-5 group select-none transition-transform active:scale-95 cursor-pointer" 
          title="Back to CloudGuard Home"
        >
          {/* Shark Logo */}
          <SharkLogo className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 transition-transform group-hover:scale-105" />

          {/* Restored Brand Title */}
          <span className="text-2xl font-bold tracking-tight text-white group-hover:text-neutral-200 transition-colors">
            CloudGuard
          </span>
        </Link>

        {/* View Mode Router */}
        {isOtpMode ? (
          /* OTP VERIFICATION VIEW */
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-neutral-800 mb-3.5 pb-2">
              <span className="text-xs font-semibold text-white">Verify Email</span>
              <button
                type="button"
                onClick={() => {
                  setIsOtpMode(false);
                  setOtpValues(['', '', '', '', '', '']);
                  setFormError('');
                  setOtpError('');
                }}
                className="text-[11px] text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                ← Back
              </button>
            </div>

            <p className="text-[11px] text-neutral-400 text-center mb-3">
              Check your email for the 6-digit verification code sent to <span className="text-white font-medium">{pendingEmail || formData.email}</span>.
            </p>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="flex justify-center gap-1.5 sm:gap-2">
                {otpValues.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => (inputRefs.current[idx] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    onPaste={handleOtpPaste}
                    className="w-8 h-10 sm:w-9 sm:h-11 text-center text-base font-semibold rounded-lg bg-neutral-800/90 border border-neutral-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                ))}
              </div>

              {otpError && (
                <p className="text-[11px] text-red-400 text-center">{otpError}</p>
              )}

              <div className="text-[11px] text-center text-neutral-400">
                {timer > 0 ? (
                  <span>Resend code in {timer}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={isLoading}
                    className="text-white underline hover:text-neutral-200 cursor-pointer"
                  >
                    Resend Code
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full mt-2 flex items-center justify-center gap-2 py-2 px-4 text-xs font-semibold rounded-xl bg-white text-neutral-900 hover:bg-neutral-200 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>Verify Code</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>
          </div>
        ) : isNewPasswordMode ? (
          /* NEW PASSWORD VIEW */
          <div className="flex flex-col">
            <div className="border-b border-neutral-800 mb-3.5 pb-2 text-center">
              <h3 className="text-xs font-semibold text-white">Secure Your Vault</h3>
              <p className="text-[10px] text-neutral-400 mt-0.5">Enter your new password below.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    required
                    disabled={isLoading}
                    value={formData.password}
                    onChange={handleInputChange}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 pr-9 text-xs rounded-xl bg-neutral-800/90 border border-neutral-700 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    name="confirmPassword"
                    required
                    disabled={isLoading}
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 pr-9 text-xs rounded-xl bg-neutral-800/90 border border-neutral-700 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white cursor-pointer"
                  >
                    {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {formError && (
                <p className="text-[11px] text-red-400 text-center">{formError}</p>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full mt-2 flex items-center justify-center gap-2 py-2 px-4 text-xs font-semibold rounded-xl bg-white text-neutral-900 hover:bg-neutral-200 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>Save New Password</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>
          </div>
        ) : isForgotPassword ? (
          /* FORGOT PASSWORD VIEW */
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-neutral-800 mb-3.5 pb-2">
              <span className="text-xs font-semibold text-white">Reset Password</span>
              <button
                type="button"
                onClick={() => {
                  setIsForgotPassword(false);
                  setFormError('');
                }}
                className="text-[11px] text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                ← Back to Login
              </button>
            </div>

            <p className="text-[11px] text-neutral-400 mb-3">
              Enter your email and we'll send a 6-digit verification code to reset your password.
            </p>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  name="email"
                  required
                  disabled={isLoading}
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="name@example.com"
                  className="w-full px-3 py-2 text-xs rounded-xl bg-neutral-800/90 border border-neutral-700 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>

              {formError && (
                <p className="text-[11px] text-red-400 text-center">{formError}</p>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full mt-2 flex items-center justify-center gap-2 py-2 px-4 text-xs font-semibold rounded-xl bg-white text-neutral-900 hover:bg-neutral-200 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>Send Reset Code</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>
          </div>
        ) : (
          /* STANDARD LOGIN / SIGN UP VIEW */
          <>
            {/* Tab Switcher */}
            <div className="flex items-center border-b border-neutral-800 mb-3.5 pb-1">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(false);
                  setFormError('');
                }}
                className={`pb-1.5 text-sm font-semibold transition-colors cursor-pointer mr-5 ${
                  !isSignUp ? 'text-white border-b-2 border-white' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(true);
                  setFormError('');
                }}
                className={`pb-1.5 text-sm font-semibold transition-colors cursor-pointer ${
                  isSignUp ? 'text-white border-b-2 border-white' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                Create Vault
              </button>
            </div>

            {/* Google Authentication */}
            <div className="w-full flex justify-center mb-5">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={handleGoogleError}
                text={isSignUp ? 'signup_with' : 'signin_with'}
                shape="pill"
                theme="filled_black"
                size="large"
              />
            </div>

            {/* 2. Compact "OR" Divider */}
            <div className="relative my-3.5 select-none">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-neutral-800" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase font-semibold tracking-wider">
                <span className="bg-neutral-900 px-2.5 text-neutral-500">
                  Or with email
                </span>
              </div>
            </div>

            {/* 3. Manual Form */}
            <form onSubmit={handleSubmit} className="space-y-3">
              {isSignUp && (
                <div>
                  <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    name="name"
                    required
                    disabled={isLoading}
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="John Doe"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-neutral-800/90 border border-neutral-700 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
              )}

              <div>
                <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  name="email"
                  required
                  disabled={isLoading}
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="name@example.com"
                  className="w-full px-3 py-2 text-xs rounded-xl bg-neutral-800/90 border border-neutral-700 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                    Password
                  </label>
                  {!isSignUp && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsForgotPassword(true);
                        setFormError('');
                      }}
                      className="text-[10px] text-neutral-400 hover:text-white transition-colors cursor-pointer"
                    >
                      Forgot Password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    required
                    disabled={isLoading}
                    value={formData.password}
                    onChange={handleInputChange}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 pr-9 text-xs rounded-xl bg-neutral-800/90 border border-neutral-700 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {formError && (
                <p className="text-[11px] text-red-400 text-center">{formError}</p>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full mt-2 flex items-center justify-center gap-2 py-2 px-4 text-xs font-semibold rounded-xl bg-white text-neutral-900 hover:bg-neutral-200 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>{isSignUp ? 'Create Vault' : 'Sign In'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>
          </>
        )}

        {/* 4. Terms Disclaimer */}
        <p className="mt-3.5 text-[10px] text-center text-neutral-500 leading-relaxed">
          By continuing, you agree to CloudGuard's{' '}
          <Link className="underline hover:text-neutral-300" to="/terms">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link className="underline hover:text-neutral-300" to="/privacy">
            Privacy Policy
          </Link>.
        </p>

      </div>
    </div>
  );
}
