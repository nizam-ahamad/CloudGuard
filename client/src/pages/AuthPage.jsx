import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, CheckCircle, Loader2 } from 'lucide-react';
import axios from 'axios';
import CloudGuardLogo from '../CloudGuardLogo';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function AuthPage() {
  const navigate = useNavigate();
  
  // View States
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isOtpMode, setIsOtpMode] = useState(false);
  const [isNewPasswordMode, setIsNewPasswordMode] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  
  // Data States
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [otpValues, setOtpValues] = useState(['', '', '', '', '', '']);
  const [timer, setTimer] = useState(60);
  const [otpError, setOtpError] = useState('');
  const [otpAttempts, setOtpAttempts] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const inputRefs = useRef([]);

  // Timer Effect
  useEffect(() => {
    let interval;
    if (isOtpMode && timer > 0) {
      interval = setInterval(() => setTimer((prev) => prev - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isOtpMode, timer]);

  // OTP Handlers (Numbers only + Auto-focus)
  const handleOtpChange = (index, value) => {
    const numValue = value.replace(/[^0-9]/g, ''); 
    if (numValue.length > 1) return; 

    const newOtp = [...otpValues];
    newOtp[index] = numValue;
    setOtpValues(newOtp);

    if (numValue !== '' && index < 5) {
      inputRefs.current[index + 1].focus();
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && otpValues[index] === '' && index > 0) {
      inputRefs.current[index - 1].focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    // Get pasted data, strip non-numbers, and limit to 6 chars
    const pastedData = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 6);
    
    if (pastedData) {
      const newOtp = ['', '', '', '', '', ''];
      for (let i = 0; i < pastedData.length; i++) {
        newOtp[i] = pastedData[i];
      }
      setOtpValues(newOtp);
      
      // Auto-focus the next empty box, or the last box if full
      const focusIndex = Math.min(pastedData.length, 5);
      if (inputRefs.current[focusIndex]) {
        inputRefs.current[focusIndex].focus();
      }
    }
  };

  const handleResend = async () => {
    setIsLoading(true);
    setFormError('');
    try {
      if (isForgotPassword) {
        await axios.post(`${API_BASE_URL}/api/auth/forgot-password`, { email });
      } else {
        await axios.post(`${API_BASE_URL}/api/auth/register`, { name: email.split('@')[0] || 'User', email, password });
      }
      setTimer(60);
      setOtpValues(['', '', '', '', '', '']);
      setOtpAttempts(0);
    } catch (error) {
      setFormError("Failed to resend OTP. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      // 1. Handling the New Password submission
      if (isNewPasswordMode) {
        if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
          setFormError('Min. 8 characters, 1 letter, 1 number.');
          return;
        }
        if (password !== confirmPassword) { setFormError("Passwords do not match."); setIsLoading(false); return; }
        
        try {
          await axios.put(`${API_BASE_URL}/api/auth/reset-password/${otpValues.join('')}`, { password });
          setPassword('');
          setConfirmPassword('');
          setOtpValues(['', '', '', '', '', '']);
          setIsNewPasswordMode(false);
          setIsForgotPassword(false);
          setIsLogin(true); 
        } catch (error) {
          setFormError(error.response?.data?.error || "Failed to reset password.");
        }
        return;
      }

      // 2. Handling Account Creation Validation
      if (!isOtpMode && !isLogin && !isForgotPassword) {
        if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
          setFormError('Min. 8 characters, 1 letter, and 1 number.');
          return;
        }
      }

      setFormError('');

      if (isOtpMode) {
        const enteredOtp = otpValues.join('');
        if (enteredOtp.length < 6) { setOtpError("Please enter the full 6-digit code."); return; }
        if (otpAttempts >= 3) { setOtpError("Too many failed attempts. Request a new code."); return; }

        try {
          const response = await axios.post(`${API_BASE_URL}/api/auth/verify-otp`, { email, otp: enteredOtp, type: isForgotPassword ? 'reset' : 'signup' });
          
          if (response.data?.token) localStorage.setItem('token', response.data.token);
          if (response.data?.user) localStorage.setItem('user', JSON.stringify(response.data.user));
          
          setIsSuccess(true);
          setOtpAttempts(0);
          setFormError('');
          
          setTimeout(() => {
            setIsSuccess(false);
            if (isForgotPassword) {
              setIsOtpMode(false);
              setIsNewPasswordMode(true);
            } else {
              window.location.href = '/dashboard'; 
            }
          }, 1500);
        } catch (error) {
          // HALT execution and show error. Do NOT advance the screen.
          const newAttempts = otpAttempts + 1;
          setOtpAttempts(newAttempts);
          setFormError(newAttempts >= 3 ? "Too many failed attempts." : (error.response?.data?.message || "Invalid verification code."));
          return;
        }
      } else if (isForgotPassword) {
        setOtpValues(['', '', '', '', '', '']);
        setOtpError('');
        setOtpAttempts(0);
        setFormError('');
        await axios.post(`${API_BASE_URL}/api/auth/forgot-password`, { email });
        setIsOtpMode(true);
        setTimer(60);
      } else if (!isLogin) {
        setOtpValues(['', '', '', '', '', '']);
        setOtpError('');
        setOtpAttempts(0);
        setFormError('');
        await axios.post(`${API_BASE_URL}/api/auth/register`, { name, email, password });
        setIsOtpMode(true);
        setTimer(60);
      } else {
        const response = await axios.post(`${API_BASE_URL}/api/auth/login`, { email, password });
        if (response.data?.token) localStorage.setItem('token', response.data.token);
        if (response.data?.user) localStorage.setItem('user', JSON.stringify(response.data.user));
        
        window.location.href = '/dashboard';
      }
    } catch (error) {
      console.error("Backend Rejection Data:", error.response?.data);
      setFormError(error.response?.data?.message || "Network error. Is your backend running?");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-4 font-sans text-[#e3e3e3]">
      
      {/* Brand Header */}
      <Link to="/" className="mb-8 inline-flex items-center justify-center gap-2 transition-opacity hover:opacity-80">
        <CloudGuardLogo className="h-12 w-auto flex-shrink-0 text-[#e3e3e3] fill-current" />
        <span className="text-2xl font-bold tracking-tight">CloudGuard</span>
      </Link>

      {/* Auth Card - STRICTLY ORIGINAL SHARP DESIGN */}
      <div className="w-full max-w-md bg-[#050505] border border-[#222] p-8 md:p-10 shadow-2xl relative overflow-hidden">
        
        {!isOtpMode && !isNewPasswordMode && (
          <div className="flex gap-6 mb-8 border-b border-[#222] pb-4">
            {isForgotPassword ? (
              <div className="w-full">
                <h2 className="text-lg font-medium text-white mb-2">Reset Password</h2>
                <button type="button" onClick={() => setIsForgotPassword(false)} className="text-xs font-mono text-[#777] hover:text-white transition-colors">
                  ← Back to Login
                </button>
              </div>
            ) : (
              <>
                <button type="button" onClick={() => setIsLogin(true)} className={`text-lg font-medium transition-colors ${isLogin ? 'text-white' : 'text-[#555] hover:text-[#888]'}`}>Login</button>
                <button type="button" onClick={() => setIsLogin(false)} className={`text-lg font-medium transition-colors ${!isLogin ? 'text-white' : 'text-[#555] hover:text-[#888]'}`}>Create Vault</button>
              </>
            )}
          </div>
        )}

        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
          
          {isNewPasswordMode ? (
            /* NEW PASSWORD VIEW */
            <div className="flex flex-col gap-6 py-2">
              <div className="text-center mb-2">
                <h3 className="text-lg font-medium text-white mb-2">Secure your vault</h3>
                <p className="text-xs font-mono text-[#777]">Enter a new password.</p>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-mono text-[#777] uppercase tracking-wider">New Password</label>
                <div className="relative">
                  <input 
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if(formError) setFormError(''); }}
                    className={`w-full bg-transparent border-b ${formError ? 'border-red-500' : 'border-[#333] focus:border-white'} outline-none py-2 pr-10 text-white transition-colors`}
                    placeholder="••••••••" 
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-[#777] hover:text-white transition-colors">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-mono text-[#777] uppercase tracking-wider">Confirm Password</label>
                <div className="relative">
                  <input 
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); if(formError) setFormError(''); }}
                    className={`w-full bg-transparent border-b ${formError ? 'border-red-500' : 'border-[#333] focus:border-white'} outline-none py-2 pr-10 text-white transition-colors`}
                    placeholder="••••••••" 
                  />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-[#777] hover:text-white transition-colors">
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          ) : !isOtpMode ? (
            <>
              {!isLogin && !isForgotPassword && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-mono text-[#777] uppercase tracking-wider">Full Name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-transparent border-b border-[#333] focus:border-white outline-none py-2 text-white transition-colors" placeholder="John Doe" />
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-xs font-mono text-[#777] uppercase tracking-wider">Email Address</label>
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-transparent border-b border-[#333] focus:border-white outline-none py-2 text-white transition-colors" 
                  placeholder="name@example.com" 
                />
              </div>

              {!isForgotPassword && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-mono text-[#777] uppercase tracking-wider">Password</label>
                  <div className="relative">
                    <input 
                      type={showPassword ? "text" : "password"} 
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); if (formError) setFormError(''); }}
                      className={`w-full bg-transparent border-b ${formError ? 'border-red-500' : 'border-[#333] focus:border-white'} outline-none py-2 pr-10 text-white transition-colors`}
                      placeholder="••••••••" 
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-[#777] hover:text-white transition-colors">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {isLogin && !isForgotPassword && (
                <button type="button" onClick={() => setIsForgotPassword(true)} className="text-left text-xs font-mono text-[#555] hover:text-white transition-colors w-max mt-[-8px]">
                  Forgot Password?
                </button>
              )}
            </>
          ) : (
            /* OTP VERIFICATION UI - RESTORED TO SHARP DESIGN */
            <div className="flex flex-col gap-6 py-2">
              
              {/* Top Left Back Button matched to Reset Password UI */}
              <div className="w-full border-b border-[#222] pb-4 mb-2">
                <button 
                  type="button"
                  onClick={() => {
                    setIsOtpMode(false);
                    setOtpValues(['', '', '', '', '', '']); 
                  }}
                  className="text-xs font-mono text-[#777] hover:text-white transition-colors"
                >
                  ← Back
                </button>
              </div>

              <div className="text-center">
                <h3 className="text-lg font-medium text-white mb-2">Check your email</h3>
                <p className="text-xs font-mono text-[#777]">
                  We sent a 6-digit code to <span className="text-white">{email || 'your email'}</span>.<br/>
                  It expires in 10 minutes.
                </p>
              </div>
              
              <div className="flex gap-2 sm:gap-3 justify-center">
                {otpValues.map((digit, index) => (
                  <input
                    key={index}
                    id={`otp-input-${index}`}
                    type="text"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!/^[0-9]*$/.test(val)) return;
                      const newOtp = [...otpValues];
                      newOtp[index] = val;
                      setOtpValues(newOtp);
                      if (val && index < 5) {
                        document.getElementById(`otp-input-${index + 1}`).focus();
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' && !digit && index > 0) {
                        document.getElementById(`otp-input-${index - 1}`).focus();
                      }
                    }}
                    className="w-10 h-12 text-center text-xl bg-transparent border border-[#333] focus:border-white outline-none text-white transition-colors"
                  />
                ))}
              </div>
              
              <div className="min-h-[24px] mt-1 mb-2 w-full flex items-center justify-center">
                {otpError ? <p className="text-xs font-mono text-red-500 text-center w-full animate-in fade-in">{otpError}</p> : null}
              </div>

              <div className="mt-4 text-xs font-mono text-[#777] flex justify-center">
                {timer > 0 ? (
                  <span>Resend code in {timer}s</span>
                ) : (
                  <button 
                    type="button" 
                    onClick={handleResend} 
                    disabled={isLoading}
                    className="text-white hover:underline transition-all disabled:opacity-50"
                  >
                    {isLoading ? 'Sending...' : 'Click to Resend Code'}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="min-h-[20px] w-full mt-2 mb-2">
            {formError && <p className="text-xs font-mono text-red-500 text-center w-full animate-in fade-in">{formError}</p>}
          </div>

          <button 
            type="submit" 
            disabled={isLoading} 
            className={`mt-4 w-full bg-white text-black py-3 px-4 font-semibold hover:bg-gray-200 transition-colors flex justify-center items-center gap-2 ${isLoading ? 'opacity-75 cursor-not-allowed' : ''}`}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                {isNewPasswordMode ? 'Save New Password' : isOtpMode ? 'Verify Code' : isForgotPassword ? 'Send Reset Code' : isLogin ? 'Sign In' : 'Create Account'}
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

        </form>
      </div>
    </div>
  );
}
