import React, { useState, useEffect } from 'react';
import {
  X,
  FileText,
  Film,
  Image as ImageIcon,
  File,
  ShieldCheck,
  AlertTriangle,
  Copy,
  Check,
} from 'lucide-react';

/**
 * Categorize MIME types and file extensions for clean display
 */
function getFileCategory(mimeType = '', fileName = '') {
  const mime = (mimeType || '').toLowerCase();
  const ext = (fileName || '').split('.').pop().toLowerCase();

  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) {
    return 'Image';
  }
  if (mime.startsWith('video/') || ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'].includes(ext)) {
    return 'Video';
  }
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) {
    return 'Audio';
  }
  if (mime === 'application/pdf' || ext === 'pdf') {
    return 'PDF';
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) || mime.includes('zip') || mime.includes('compressed')) {
    return 'Archive';
  }
  if (
    mime.startsWith('text/') ||
    ['txt', 'md', 'doc', 'docx', 'csv', 'json', 'js', 'jsx', 'ts', 'tsx', 'html', 'css'].includes(ext)
  ) {
    return 'Document';
  }
  return 'File';
}

/**
 * Format bytes into human-readable 1024-based binary units
 */
function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!n || n <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  const safeI = Math.min(Math.max(0, i), sizes.length - 1);
  return `${(n / Math.pow(k, safeI)).toFixed(safeI === 0 ? 0 : 1)} ${sizes[safeI]}`;
}

/**
 * Format date values to DD MMM YYYY, hh:mm A
 */
function formatDateTime(dateVal) {
  if (!dateVal) return '—';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '—';
  return (
    d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }) +
    ', ' +
    d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  );
}

export default function FileDetailsModal({ file, locationPath = 'My Files', onClose }) {
  const [copied, setCopied] = useState(false);

  // Close on Escape key press
  useEffect(() => {
    if (!file) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [file, onClose]);

  if (!file) return null;

  const rawMime = file.mimeType || file.mimetype || 'application/octet-stream';
  const category = getFileCategory(rawMime, file.name);
  const formattedSize = formatFileSize(file.size);
  const sha256Hash = file.sha256 || file.hash || file.checksum || null;

  const isMalicious = Boolean(
    file.isMalicious ||
    file.status === 'Malicious' ||
    file.status === 'threat' ||
    file.securityStatus === 'threat_detected' ||
    file.securityStatus === 'malicious'
  );

  const handleCopyHash = async () => {
    if (!sha256Hash) return;
    try {
      await navigator.clipboard.writeText(sha256Hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy hash to clipboard:', err);
    }
  };

  // Header icon selector
  const HeaderIcon =
    category === 'Image'
      ? ImageIcon
      : category === 'Video'
      ? Film
      : category === 'Document' || category === 'PDF'
      ? FileText
      : File;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose?.();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="file-details-title"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-5 sm:p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 text-left relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-500 flex items-center justify-center shrink-0">
              <HeaderIcon size={18} />
            </div>
            <h3
              id="file-details-title"
              className="text-base sm:text-lg font-bold text-neutral-900 dark:text-white tracking-tight truncate"
            >
              File Details
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-white rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Metadata Grid */}
        <div className="space-y-3.5 text-xs sm:text-sm">
          {/* File Name */}
          <div>
            <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 dark:text-neutral-400 block mb-1">
              File Name
            </span>
            <p className="font-medium text-neutral-900 dark:text-white break-all leading-snug">
              {file.name || file.originalName || 'Unknown file'}
            </p>
          </div>

          {/* Type & Size */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 dark:text-neutral-400 block mb-1">
                Type
              </span>
              <p className="font-medium text-neutral-800 dark:text-neutral-200 break-words">
                {category} •{' '}
                <span className="font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                  {rawMime}
                </span>
              </p>
            </div>
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 dark:text-neutral-400 block mb-1">
                Size
              </span>
              <p className="font-medium text-neutral-800 dark:text-neutral-200">
                {formattedSize}{' '}
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 block font-normal mt-0.5">
                  ({Number(file.size || 0).toLocaleString()} bytes)
                </span>
              </p>
            </div>
          </div>

          {/* Location & Security Status */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 dark:text-neutral-400 block mb-1">
                Location
              </span>
              <p
                className="font-medium text-neutral-800 dark:text-neutral-200 truncate"
                title={locationPath}
              >
                {locationPath || 'My Files'}
              </p>
            </div>
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 dark:text-neutral-400 block mb-1">
                Security Status
              </span>
              <div>
                {isMalicious ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                    <AlertTriangle size={12} className="shrink-0" />
                    Threat Blocked
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    <ShieldCheck size={12} className="shrink-0" />
                    Safe • AI Verified
                  </span>
                )}
                {file.scanDetails?.threatVerdict && (
                  <span className="block text-[10px] text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">
                    {file.scanDetails.threatVerdict}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Uploaded & Modified Dates */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 dark:text-neutral-400 block mb-1">
                Uploaded
              </span>
              <p className="text-xs text-neutral-700 dark:text-neutral-300">
                {formatDateTime(file.createdAt || file.uploadedAt)}
              </p>
            </div>
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 dark:text-neutral-400 block mb-1">
                Last Modified
              </span>
              <p className="text-xs text-neutral-700 dark:text-neutral-300">
                {formatDateTime(file.updatedAt || file.createdAt || file.uploadedAt)}
              </p>
            </div>
          </div>

          {/* SHA-256 Checksum (if exists) */}
          {sha256Hash && (
            <div className="pt-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  SHA-256 Checksum
                </span>
                <button
                  type="button"
                  onClick={handleCopyHash}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
                  title="Copy SHA-256 hash"
                >
                  {copied ? (
                    <>
                      <Check size={12} className="text-emerald-500" />
                      <span className="text-emerald-500 font-semibold">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <div className="font-mono text-[11px] text-neutral-600 dark:text-neutral-300 break-all bg-neutral-100 dark:bg-neutral-800/80 border border-neutral-200 dark:border-neutral-700/70 rounded-xl p-2.5 select-all">
                {sha256Hash}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end pt-3 border-t border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
