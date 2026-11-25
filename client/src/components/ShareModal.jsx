import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { X, Share2, UserPlus, Trash2, Loader2, Users } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { useToast } from '../context/ToastContext';

function getAuthHeaders() {
  try {
    const raw = localStorage.getItem('token') || sessionStorage.getItem('token');
    if (raw && raw !== 'null' && raw !== 'undefined' && raw !== 'cookie-session') {
      return { Authorization: `Bearer ${raw}` };
    }
  } catch (_) {}
  return {};
}

export default function ShareModal({ isOpen, onClose, item, itemType = 'file' }) {
  const toast = useToast();
  const [recipientEmail, setRecipientEmail] = useState('');
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState(null);

  const itemId = item?._id || item?.id;
  const itemName = item?.originalName || item?.name || (itemType === 'folder' ? 'Folder' : 'File');

  const fetchShares = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE_URL}/api/shares/item/${itemType}/${itemId}`, {
        headers: getAuthHeaders(),
        withCredentials: true,
      });
      setShares(Array.isArray(res.data?.shares) ? res.data.shares : []);
    } catch (err) {
      console.error('Failed to load share recipients:', err);
      toast?.error?.(err.response?.data?.error || 'Failed to load recipients');
    } finally {
      setLoading(false);
    }
  }, [itemId, itemType, toast]);

  useEffect(() => {
    if (isOpen && itemId) {
      setRecipientEmail('');
      fetchShares();
    } else if (!isOpen) {
      setShares([]);
      setRecipientEmail('');
    }
  }, [isOpen, itemId, fetchShares]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose && onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !item) return null;

  const handleShareSubmit = async (e) => {
    e.preventDefault();
    const trimmedEmail = recipientEmail.trim().toLowerCase();
    if (!trimmedEmail || submitting) return;

    setSubmitting(true);
    try {
      const res = await axios.post(
        `${API_BASE_URL}/api/shares`,
        {
          itemType,
          itemId,
          recipientEmail: trimmedEmail,
        },
        {
          headers: getAuthHeaders(),
          withCredentials: true,
        }
      );

      const createdShare = res.data?.share;
      if (createdShare) {
        setShares((prev) => [createdShare, ...prev]);
      } else {
        await fetchShares();
      }
      setRecipientEmail('');
      toast?.success?.(`Shared with ${trimmedEmail}`);
    } catch (err) {
      toast?.error?.(err.response?.data?.error || 'Failed to share item');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (share) => {
    if (!share?._id || removingId) return;
    setRemovingId(share._id);
    try {
      await axios.delete(`${API_BASE_URL}/api/shares/${share._id}`, {
        headers: getAuthHeaders(),
        withCredentials: true,
      });
      setShares((prev) => prev.filter((s) => s._id !== share._id));
      toast?.success?.(`Removed access for ${share.recipientEmail || 'user'}`);
    } catch (err) {
      toast?.error?.(err.response?.data?.error || 'Failed to revoke access');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose && onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#111113] border border-neutral-200 dark:border-neutral-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Share2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                Share &ldquo;{itemName}&rdquo;
              </h3>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                Grant read-only viewer access to another CloudGuard user
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onClose && onClose()}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer shrink-0"
            aria-label="Close share modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Invite Form */}
          <form onSubmit={handleShareSubmit} className="flex items-center gap-2">
            <input
              type="email"
              required
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="Enter recipient email address..."
              disabled={submitting}
              className="flex-1 min-w-0 px-3 py-2 text-xs sm:text-sm rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={submitting || !recipientEmail.trim()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors cursor-pointer shrink-0"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              <span>Share</span>
            </button>
          </form>

          {/* People with Access */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              People with access
            </h4>

            {loading ? (
              <div className="flex items-center justify-center py-6 text-neutral-400 gap-2 text-xs">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading recipients...</span>
              </div>
            ) : shares.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 px-4 rounded-xl border border-dashed border-neutral-200 dark:border-neutral-800 text-center">
                <Users className="w-5 h-5 text-neutral-400 dark:text-neutral-500 mb-1.5" />
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Not shared with anyone yet.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {shares.map((share) => {
                  const displayName = share.recipientId?.name || share.recipientEmail;
                  const displayEmail = share.recipientId?.email || share.recipientEmail;
                  const isRemoving = removingId === share._id;

                  return (
                    <div
                      key={share._id}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-900/70 border border-neutral-200/80 dark:border-neutral-800/80"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs sm:text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                          {displayName}
                        </p>
                        <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                          {displayEmail}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          Viewer
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRevoke(share)}
                          disabled={isRemoving}
                          title="Remove access"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {isRemoving ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
