import React, { useState } from 'react';
import axios from 'axios';
import { Loader2 } from 'lucide-react';
import PasswordInput from '../PasswordInput';
import { API_BASE_URL } from '../config';

export default function ProfileSettings({ user, setUser, addToast, onClose }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

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
    </div>
  );
}

