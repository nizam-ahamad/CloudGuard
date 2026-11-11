import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Loader2, Trash2, X, ShieldAlert } from 'lucide-react';
import PasswordInput from '../PasswordInput';
import { API_BASE_URL } from '../config';

export default function ProfileSettings({ user, setUser, addToast, onClose }) {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  // Account Erasure State (DPDP Act Section 12)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Close modal on Escape
  useEffect(() => {
    if (!isDeleteModalOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isDeletingAccount) setIsDeleteModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDeleteModalOpen, isDeletingAccount]);

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

  // Dedicated Account Deletion Handler (DPDP Act Section 12)
  const handleDeleteAccount = async (e) => {
    if (e) e.preventDefault();

    if (user?.hasPassword && !deletePassword) {
      setDeleteError('Please enter your account password to confirm.');
      return;
    }
    if (!user?.hasPassword && deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      setDeleteError('Please type DELETE to confirm.');
      return;
    }

    try {
      setIsDeletingAccount(true);
      setDeleteError('');

      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const payload = {
        password: deletePassword,
        confirmation: true,
        confirmText: deleteConfirmText.trim(),
      };

      await axios.delete(`${API_BASE_URL}/api/auth/account`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        data: payload,
      });

      // Clear all stored credentials and sessions
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
      localStorage.clear();
      sessionStorage.clear();

      window.dispatchEvent(new Event('cloudguard:auth-changed'));
      window.dispatchEvent(new Event('auth-change'));
      window.dispatchEvent(new Event('storage'));

      if (typeof addToast === 'function') {
        addToast('success', 'Account and all personal data permanently erased.');
      }

      setIsDeleteModalOpen(false);
      if (typeof onClose === 'function') onClose();

      navigate('/login');
      setTimeout(() => {
        window.location.href = '/login';
      }, 100);
    } catch (err) {
      console.error('Account erasure error:', err);
      const msg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        'Failed to erase account and data.';
      setDeleteError(typeof msg === 'string' ? msg : JSON.stringify(msg));
      if (typeof addToast === 'function') {
        addToast('error', typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
    } finally {
      setIsDeletingAccount(false);
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

      {/* Danger Zone: Delete Account (DPDP Act Section 12) */}
      <div className="border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/10 px-6 py-4 shadow-sm dark:shadow-none">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-title-md text-red-600 dark:text-red-400 mb-1 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400" />
              Danger Zone: Delete Account
            </h3>
            <p className="text-xs text-neutral-600 dark:text-neutral-400 max-w-xl leading-relaxed">
              Permanently erase your account and all associated personal data in accordance with Section 12 of India's Digital Personal Data Protection (DPDP) Act, 2023. All uploaded files, preview thumbnails, and user profile data will be permanently wiped from AWS S3 and the database.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setIsDeleteModalOpen(true);
              setDeletePassword('');
              setDeleteConfirmText('');
              setDeleteError('');
            }}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white rounded-lg text-xs font-semibold whitespace-nowrap transition-all shadow-sm cursor-pointer self-start sm:self-center"
          >
            Delete Account &amp; Erase All Data
          </button>
        </div>
      </div>

      {/* Account Deletion Confirmation Modal */}
      {isDeleteModalOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none animate-in fade-in duration-150"
          onClick={() => !isDeletingAccount && setIsDeleteModalOpen(false)}
        >
          <div 
            className="relative w-full max-w-md rounded-2xl border p-6 shadow-2xl transform transition-all duration-200 ease-out scale-100 opacity-100
                       bg-white border-neutral-200 text-neutral-900
                       dark:bg-neutral-900 dark:border-neutral-800 dark:text-neutral-100"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0
                              bg-red-50 text-red-600 border border-red-200/60
                              dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/40">
                <Trash2 className="w-5 h-5"/>
              </div>

              <div className="flex-1 min-w-0 pr-2">
                <h3 className="text-base font-semibold leading-6 text-neutral-900 dark:text-white">
                  Erase Account &amp; All Data?
                </h3>
                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                  In accordance with <strong>Section 12 of India's DPDP Act, 2023</strong> (Right to Erasure), confirming this action will permanently and irreversibly erase all your uploaded files, storage thumbnails, and profile data from AWS S3 and CloudGuard databases.
                </p>
              </div>

              <button
                type="button"
                onClick={() => !isDeletingAccount && setIsDeleteModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                title="Close"
                disabled={isDeletingAccount}
              >
                <X className="w-4 h-4"/>
              </button>
            </div>

            {/* Confirmation Form */}
            <form onSubmit={handleDeleteAccount} className="mt-5 space-y-4">
              <div>
                <label className="text-xs font-mono text-neutral-600 dark:text-neutral-300 block mb-1.5">
                  {user?.hasPassword 
                    ? 'Enter your account password to confirm:'
                    : 'Type DELETE to confirm:'}
                </label>
                
                {user?.hasPassword ? (
                  <PasswordInput
                    value={deletePassword}
                    onChange={(e) => {
                      setDeletePassword(e.target.value);
                      if (deleteError) setDeleteError('');
                    }}
                    placeholder="Account password"
                    required
                    disabled={isDeletingAccount}
                    className="w-full h-10 bg-transparent border border-neutral-300 dark:border-neutral-700 rounded-lg focus:border-red-500 dark:focus:border-red-500 outline-none text-neutral-900 dark:text-white px-3 text-xs"
                  />
                ) : (
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => {
                      setDeleteConfirmText(e.target.value);
                      if (deleteError) setDeleteError('');
                    }}
                    placeholder="Type DELETE"
                    required
                    disabled={isDeletingAccount}
                    className="w-full h-10 bg-transparent border border-neutral-300 dark:border-neutral-700 rounded-lg focus:border-red-500 dark:focus:border-red-500 outline-none text-neutral-900 dark:text-white px-3 text-xs font-mono uppercase"
                  />
                )}

                {deleteError && (
                  <p className="text-xs text-red-500 mt-1.5">{deleteError}</p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 sm:gap-3 pt-2">
                <button
                  type="button"
                  disabled={isDeletingAccount}
                  onClick={() => setIsDeleteModalOpen(false)}
                  className="w-full sm:w-auto px-4 py-2 text-xs font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    isDeletingAccount ||
                    (user?.hasPassword ? !deletePassword : deleteConfirmText.trim().toUpperCase() !== 'DELETE')
                  }
                  className="w-full sm:w-auto px-4 py-2 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDeletingAccount ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Erasing all data...</span>
                    </>
                  ) : (
                    <span>Permanently Erase Account</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

