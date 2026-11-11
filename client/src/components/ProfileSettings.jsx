import React, { useState } from 'react';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import PasswordInput from '../PasswordInput';
import { API_BASE_URL } from '../config';
import { useToast } from '../context/ToastContext';

export default function ProfileSettings({ user, setUser, addToast, onClose }) {
  const toastContext = useToast?.();
  const toast = {
    success: (msg) => {
      if (toastContext?.success) toastContext.success(msg);
      else if (typeof addToast === 'function') addToast('success', msg);
    },
    error: (msg) => {
      if (toastContext?.error) toastContext.error(msg);
      else if (typeof addToast === 'function') addToast('error', msg);
    },
  };

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  // 1. Add state hooks at the top of ProfileSettings component:
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const isOAuthUser = user?.authProvider === 'google' || (!user?.password && !user?.hasPassword);
  const isDeleteReady = isOAuthUser
    ? deleteConfirmText === 'DELETE'
    : deleteConfirmText === 'DELETE' && deletePassword.length > 0;

  // 2. Deletion execution handler:
  const handleExecuteAccountDeletion = async () => {
    if (!isDeleteReady || isDeletingAccount) return;

    setIsDeletingAccount(true);
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_BASE_URL}/api/auth/account`, {
        data: {
          password: deletePassword,
          confirmText: deleteConfirmText,
        },
        headers: { Authorization: `Bearer ${token}` },
      });

      toast.success('Account and all personal data permanently erased.');

      // Clear session storage & state
      localStorage.clear();
      sessionStorage.clear();
      window.dispatchEvent(new Event('cloudguard:auth-changed'));
      window.dispatchEvent(new Event('auth-change'));

      setTimeout(() => {
        window.location.href = '/login';
      }, 600);
    } catch (err) {
      const errMsg = err.response?.data?.error || 'Failed to delete account. Please try again.';
      toast.error(errMsg);
      setIsDeletingAccount(false);
    }
  };

  // Determine if the user signed up via Google and has no existing password
  const isGoogleUserWithoutPassword = 
    user?.authProvider === 'google' && !user?.hasPassword;

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      if (typeof addToast === 'function') {
        addToast('error', 'Password must be at least 8 characters with 1 letter and 1 number.');
      }
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const payload = isGoogleUserWithoutPassword ? { newPassword } : { currentPassword, newPassword };
      await axios.put(`${API_BASE_URL}/api/auth/password`, payload);

      const updatedUser = { ...user, hasPassword: true };
      if (typeof setUser === 'function') setUser(updatedUser);
      localStorage.setItem('user', JSON.stringify(updatedUser));
      sessionStorage.setItem('user', JSON.stringify(updatedUser));

      if (typeof addToast === 'function') {
        addToast('success', isGoogleUserWithoutPassword ? 'Account password set successfully.' : 'Password updated successfully.');
      }
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      const extracted = err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to update password.';
      if (typeof addToast === 'function') {
        addToast('error', typeof extracted === 'string' ? extracted : JSON.stringify(extracted));
      }
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Profile Details */}
      <div className="border border-gray-200 dark:border-[#333] bg-gray-50 dark:bg-transparent px-6 py-4 shadow-sm dark:shadow-none">
        <h3 className="font-title-md text-on-surface dark:text-[#e3e3e3] mb-4">Profile Details</h3>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-mono text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Name</label>
            <input 
              type="text" 
              value={user?.name || ''} 
              readOnly 
              className="w-full h-12 bg-transparent border border-slate-300 dark:border-[#333] focus:border-black dark:focus:border-white outline-none text-black dark:text-white px-4 transition-colors opacity-70 cursor-not-allowed" 
            />
          </div>
          <div>
            <label className="text-xs font-mono text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Email</label>
            <input 
              type="text" 
              value={user?.email || ''} 
              readOnly 
              className="w-full h-12 bg-transparent border border-slate-300 dark:border-[#333] focus:border-black dark:focus:border-white outline-none text-black dark:text-white px-4 transition-colors opacity-70 cursor-not-allowed" 
            />
          </div>
        </div>
      </div>

      {/* Security Section */}
      <div className="border border-gray-200 dark:border-[#333] bg-gray-50 dark:bg-transparent px-6 py-4 shadow-sm dark:shadow-none">
        <h3 className="font-title-md text-on-surface dark:text-[#e3e3e3] mb-1">
          {isGoogleUserWithoutPassword ? 'Set Account Password' : 'Change Password'}
        </h3>
        
        {isGoogleUserWithoutPassword && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
            You signed in using Google. Adding a password allows you to log in with either Google or your email and password.
          </p>
        )}

        <form onSubmit={handlePasswordSubmit} className="space-y-4 max-w-md">
          {/* Only show Current Password if the user already has a password */}
          {!isGoogleUserWithoutPassword && (
            <div>
              <label className="text-xs font-mono text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">
                Current Password
              </label>
              <PasswordInput
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full h-12 bg-transparent border border-slate-300 dark:border-[#333] focus:border-black dark:focus:border-white outline-none text-black dark:text-white px-4 transition-colors"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-mono text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">
              New Password
            </label>
            <PasswordInput
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              className="w-full h-12 bg-transparent border border-slate-300 dark:border-[#333] focus:border-black dark:focus:border-white outline-none text-black dark:text-white px-4 transition-colors"
              placeholder="Must be at least 8 characters"
            />
            <p className="text-xs font-mono text-slate-500 dark:text-[#777] mt-2">
              Must be at least 8 characters with 1 letter and 1 number
            </p>
          </div>

          <button
            type="submit"
            disabled={isUpdatingPassword}
            className={`px-6 py-2 bg-primary dark:bg-zinc-800 text-on-primary dark:text-[#e3e3e3] rounded-lg font-medium transition-colors shadow-sm ${
              isUpdatingPassword ? 'opacity-70 cursor-not-allowed' : 'hover:bg-primary/90 dark:hover:bg-zinc-700 cursor-pointer'
            }`}
          >
            {isUpdatingPassword ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Updating...
              </span>
            ) : (
              isGoogleUserWithoutPassword ? 'Set Password' : 'Update Password'
            )}
          </button>
        </form>
      </div>

      {/* Danger Zone: Consistent Dark UI */}
      <div className="mt-8 rounded-2xl border border-red-500/20 bg-gradient-to-b from-red-500/[0.04] to-transparent p-6 sm:p-7 shadow-xl">
        <div className="flex items-center justify-between pb-4 border-b border-red-500/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-semibold text-white">Danger Zone: Permanent Account Erasure</h3>
              <p className="text-xs text-neutral-400">Section 12 DPDP Act (Right to Erasure)</p>
            </div>
          </div>
          <span className="text-[11px] font-semibold text-red-400/90 bg-red-500/10 border border-red-500/20 px-2.5 py-1 rounded-full uppercase tracking-wider">
            Irreversible
          </span>
        </div>

        <p className="text-xs sm:text-sm text-neutral-400 leading-relaxed mt-4">
          Permanently erases your account, files, thumbnails, and cloud vault data from AWS S3 and MongoDB. This action cannot be undone.
        </p>

        <div className="mt-5 space-y-4 max-w-lg">
          {/* Password Field (for non-OAuth users) */}
          {!isOAuthUser && (
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                Account Password
              </label>
              <div className="relative">
                <input
                  type={showDeletePassword ? 'text' : 'password'}
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Enter your password to verify ownership"
                  className="w-full px-3.5 py-2.5 pr-10 rounded-xl bg-neutral-900/90 border border-neutral-800 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-red-500/60 focus:ring-1 focus:ring-red-500/40 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowDeletePassword(!showDeletePassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 transition-colors cursor-pointer"
                >
                  {showDeletePassword ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Confirmation Phrase Field */}
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">
              To confirm, type <span className="font-bold text-red-400 select-all tracking-wider">DELETE</span> below:
            </label>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE to confirm"
              className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-900/90 border border-neutral-800 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-red-500/60 focus:ring-1 focus:ring-red-500/40 transition-colors"
            />
          </div>

          {/* Action Button */}
          <button
            type="button"
            disabled={!isDeleteReady || isDeletingAccount}
            onClick={handleExecuteAccountDeletion}
            className={`w-full py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${
              isDeleteReady && !isDeletingAccount
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20 cursor-pointer active:scale-[0.99]'
                : 'bg-neutral-800/50 text-neutral-500 cursor-not-allowed border border-neutral-800/80'
            }`}
          >
            {isDeletingAccount ? (
              <span className="inline-flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Erasing Account & Data...
              </span>
            ) : (
              'Permanently Delete Account'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

