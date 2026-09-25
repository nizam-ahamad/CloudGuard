import React, { useState } from 'react';
import axios from 'axios';
import PasswordInput from './PasswordInput';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function ResetPassword({ token }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      setError('Password must be at least 8 characters long and contain at least 1 letter and 1 number.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setError('');
    setMessage('');
    setIsLoading(true);

    try {
      const res = await axios.put(`${API_BASE_URL}/api/auth/reset-password/${token}`, { password });
      setMessage(res.data.message);
      setTimeout(() => {
        window.location.href = '/';
      }, 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'An error occurred during password reset');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-container-lowest dark:bg-[#131314] flex items-center justify-center p-4">
      <div className="bg-surface dark:bg-[#1e1f20] w-full max-w-md rounded-2xl shadow-xl border border-outline-variant dark:border-zinc-800 p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-xl bg-surface-container-high flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-secondary text-3xl" data-weight="fill">lock_reset</span>
          </div>
          <h1 className="font-headline-md text-primary dark:text-[#e3e3e3] font-bold">Reset Password</h1>
          <p className="text-on-surface-variant dark:text-[#c4c7c5] mt-2 font-body-md text-center">
            Enter your new password below.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-error/10 border border-error/20 rounded-lg text-error text-sm text-center">
            {error}
          </div>
        )}
        
        {message && (
          <div className="mb-6 p-3 bg-success/10 border border-success/20 rounded-lg text-success text-sm text-center">
            {message}
            <br />
            Redirecting to login...
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-on-surface dark:text-[#c4c7c5] mb-1">New Password</label>
            <PasswordInput 
              required 
              className="w-full px-4 py-2 bg-surface-container-lowest dark:bg-[#131314] border border-outline-variant dark:border-zinc-700 dark:text-zinc-200 rounded-lg focus:ring-2 focus:ring-secondary outline-none transition-all"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            <p className="text-xs text-on-surface-variant dark:text-[#c4c7c5] mt-1">Must be at least 8 characters with 1 letter and 1 number</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-on-surface dark:text-[#c4c7c5] mb-1">Confirm New Password</label>
            <PasswordInput 
              required 
              className="w-full px-4 py-2 bg-surface-container-lowest dark:bg-[#131314] border border-outline-variant dark:border-zinc-700 dark:text-zinc-200 rounded-lg focus:ring-2 focus:ring-secondary outline-none transition-all"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
            />
          </div>

          <button 
            type="submit" 
            disabled={isLoading || !!message}
            className={`w-full py-3 bg-primary dark:bg-zinc-800 text-on-primary dark:text-[#e3e3e3] rounded-lg font-medium hover:bg-primary/90 dark:hover:bg-zinc-700 transition-colors mt-6 shadow-sm ${isLoading || message ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin inline-block w-4 h-4 border-[2px] border-current border-t-transparent rounded-full" role="status" aria-label="loading"></span>
                Processing...
              </span>
            ) : (
              'Reset Password'
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button 
            type="button"
            onClick={() => window.location.href = '/'}
            className="text-secondary dark:text-blue-400 dark:hover:text-blue-300 text-sm hover:underline font-medium"
          >
            Back to login
          </button>
        </div>
      </div>
    </div>
  );
}

export default ResetPassword;
