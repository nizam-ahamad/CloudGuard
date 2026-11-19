import React, { useState, useRef, useEffect } from 'react';
import { Check, MoreVertical, FolderInput, Pencil, Info, Trash2, Play } from 'lucide-react';
import { generateCardPreview, getCachedCardPreview, getMediaThumbnail } from '../utils/cardPreviewGenerator';

/**
 * Returns extension, badge label, and color theme for Google Drive-style document cards.
 */
function getDocumentCardMeta(fileName = '', mimeType = '') {
  const ext = (fileName.split('.').pop() || '').toLowerCase();

  // 1. PDF
  if (ext === 'pdf' || mimeType.includes('pdf')) {
    return { ext: 'pdf', badgeText: 'PDF', badgeColor: 'bg-red-500 text-white' };
  }
  // 2. Word
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext) || mimeType.includes('word') || mimeType.includes('officedocument.wordprocessing')) {
    return { ext: ext || 'doc', badgeText: 'DOC', badgeColor: 'bg-blue-600 text-white' };
  }
  // 3. Excel / Sheets
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext) || mimeType.includes('excel') || mimeType.includes('spreadsheet') || mimeType.includes('csv')) {
    return { ext: ext || 'xls', badgeText: ext === 'csv' ? 'CSV' : 'XLS', badgeColor: 'bg-emerald-600 text-white' };
  }
  // 4. PowerPoint / Slides
  if (['ppt', 'pptx', 'odp'].includes(ext) || mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
    return { ext: ext || 'ppt', badgeText: 'PPT', badgeColor: 'bg-amber-500 text-white' };
  }
  // 5. Code & Data
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'html', 'css', 'scss', 'json', 'xml', 'sh', 'yml', 'yaml', 'sql', 'php', 'rs', 'go', 'rb'].includes(ext)) {
    return { ext: ext || 'code', badgeText: '</>', badgeColor: 'bg-indigo-600 text-white' };
  }
  // 6. Text
  if (['txt', 'md', 'markdown', 'log'].includes(ext) || mimeType.startsWith('text/')) {
    return { ext: ext || 'txt', badgeText: 'TXT', badgeColor: 'bg-neutral-600 text-white' };
  }
  // 7. Audio
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'].includes(ext) || mimeType.startsWith('audio/')) {
    return { ext: ext || 'audio', badgeText: 'AUDIO', badgeColor: 'bg-pink-600 text-white' };
  }
  // 8. Archives
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext) || mimeType.includes('zip') || mimeType.includes('compressed')) {
    return { ext: ext || 'zip', badgeText: 'ZIP', badgeColor: 'bg-orange-500 text-white' };
  }
  // 9. Video fallback
  if (['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v', '3gp'].includes(ext) || mimeType.startsWith('video/')) {
    return { ext: ext || 'video', badgeText: 'VID', badgeColor: 'bg-rose-600 text-white' };
  }
  // 10. Image fallback
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'heic', 'heif', 'bmp', 'tiff', 'avif'].includes(ext) || mimeType.startsWith('image/')) {
    return { ext: ext || 'img', badgeText: 'IMG', badgeColor: 'bg-purple-600 text-white' };
  }

  // Fallback
  return {
    ext: ext || 'file',
    badgeText: ext ? ext.toUpperCase().slice(0, 4) : 'FILE',
    badgeColor: 'bg-neutral-500 text-white',
  };
}

/**
 * Google Drive-Style Document Preview Sheet (Instant skeleton / fallback)
 * Renders a crisp styled document card with corner fold, colored type badge, and mock text skeleton lines.
 */
function DocumentSheetCard({ ext, badgeText, badgeColor }) {
  return (
    <div className="w-20 sm:w-24 h-24 sm:h-28 bg-white dark:bg-[#1c1d20] rounded-md shadow-sm border border-neutral-200/90 dark:border-neutral-700/80 p-2 sm:p-2.5 flex flex-col justify-between transition-transform duration-200 group-hover:scale-105 group-hover:shadow-md select-none">
      {/* Sheet Header: Pill with File Type Badge & Corner Fold */}
      <div className="flex items-center justify-between">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider leading-none uppercase ${badgeColor}`}>
          {badgeText}
        </span>
        <div className="w-2 h-2 rounded-bl bg-neutral-200 dark:bg-neutral-700/80" />
      </div>

      {/* Sheet Body: Realistic simulated document lines */}
      <div className="space-y-1.5 my-auto px-0.5">
        <div className="h-1.5 w-full bg-neutral-200 dark:bg-neutral-700/70 rounded-full" />
        <div className="h-1.5 w-4/5 bg-neutral-200 dark:bg-neutral-700/70 rounded-full" />
        <div className="h-1.5 w-3/5 bg-neutral-200 dark:bg-neutral-700/70 rounded-full" />
        <div className="h-1.5 w-2/3 bg-neutral-200 dark:bg-neutral-700/70 rounded-full" />
      </div>

      {/* Sheet Footer: Subtle footer line & extension */}
      <div className="flex items-center justify-between pt-1 border-t border-neutral-100 dark:border-neutral-800">
        <div className="h-1 w-8 bg-neutral-200 dark:bg-neutral-700/60 rounded-full" />
        <span className="text-[9px] font-mono text-neutral-400 dark:text-neutral-500 uppercase">{ext || 'doc'}</span>
      </div>
    </div>
  );
}

/**
 * Real Text / Code / CSV Snippet Preview Sheet
 */
function TextSnippetSheetCard({ ext, badgeText, badgeColor, snippet }) {
  return (
    <div className="w-24 sm:w-28 h-28 sm:h-32 bg-white dark:bg-[#1c1d20] rounded-md shadow-sm border border-neutral-200/90 dark:border-neutral-700/80 p-2 flex flex-col justify-between transition-transform duration-200 group-hover:scale-105 group-hover:shadow-md select-none overflow-hidden relative">
      {/* Sheet Header */}
      <div className="flex items-center justify-between mb-1 shrink-0">
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider leading-none uppercase ${badgeColor}`}>
          {badgeText}
        </span>
        <div className="w-2 h-2 rounded-bl bg-neutral-200 dark:bg-neutral-700/80" />
      </div>

      {/* Real Text Snippet */}
      <div className="flex-1 overflow-hidden font-mono text-[8px] sm:text-[8.5px] leading-[11px] sm:leading-[12px] text-neutral-600 dark:text-neutral-300 select-none whitespace-pre-wrap break-all line-clamp-[7] opacity-90 my-auto">
        {snippet}
      </div>

      {/* Sheet Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-neutral-100 dark:border-neutral-800 shrink-0 mt-auto">
        <div className="h-1 w-8 bg-neutral-200 dark:bg-neutral-700/60 rounded-full" />
        <span className="text-[9px] font-mono text-neutral-400 dark:text-neutral-500 uppercase">{ext || 'txt'}</span>
      </div>
    </div>
  );
}

/**
 * Reusable File Grid Card for My Files and Recents
 */
export default function FileGridCard({
  file,
  index = 0,
  totalFiles = 1,
  isSelected = false,
  isSelectionActive = false,
  onToggleSelect,
  onPreview,
  onDownload,
  onMove,
  onRename,
  onDetails,
  onDelete,
  activeMenuId,
  setActiveMenuId,
  formatSize,
  token,
  prefetchAccessUrl,
}) {
  const cardRef = useRef(null);
  const [isInView, setIsInView] = useState(false);
  const [imgError, setImgError] = useState(false);

  const fileId = file?._id || file?.id;
  const menuKey = fileId;
  const isMenuOpen = activeMenuId === menuKey;

  // Direct lightweight B2 .webp thumbnail resolution (matches PhotosView.jsx)
  const directThumbnail = file.thumbnailUrl || getMediaThumbnail(fileId) || file.thumbnail;
  const hasDirectThumbnail = Boolean(directThumbnail && !imgError);

  // Read cache synchronously on initial render for instant zero-flash rendering
  const [dynamicPreview, setDynamicPreview] = useState(() => getCachedCardPreview(fileId));

  const isVideo =
    (file.mimeType && file.mimeType.startsWith('video/')) ||
    (file.mimetype && file.mimetype.startsWith('video/')) ||
    /\.(mp4|mkv|mov|avi|webm|wmv|flv|m4v|3gp)$/i.test(file.name || file.originalName || '');

  const isPdf =
    (file.mimeType && file.mimeType.includes('pdf')) ||
    (file.mimetype && file.mimetype.includes('pdf')) ||
    /\.pdf$/i.test(file.name || file.originalName || '');

  const resolvedThumbnail =
    (hasDirectThumbnail ? directThumbnail : null) ||
    (dynamicPreview?.type === 'image' && !imgError ? dynamicPreview.url : null);

  const { ext, badgeText, badgeColor } = getDocumentCardMeta(
    file.name || file.originalName || '',
    file.mimeType || file.mimetype || ''
  );

  const isRightColumn = (index % 5 >= 3) || (index % 2 === 1);
  const isBottomRow = index >= totalFiles - 2 && totalFiles > 3;

  // Viewport gating via IntersectionObserver (rootMargin: 200px)
  useEffect(() => {
    if (isInView) return;
    const el = cardRef.current;
    if (!el) return;

    if (typeof IntersectionObserver === 'undefined') {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isInView]);

  // Trigger preview generation when visible in viewport
  useEffect(() => {
    if (!isInView || !fileId) return;

    // Direct B2 thumbnail already available; no client decode needed
    const existingThumb = file.thumbnailUrl || getMediaThumbnail(fileId) || file.thumbnail;
    if (existingThumb && !imgError) return;

    const cached = getCachedCardPreview(fileId);
    if (cached) {
      setDynamicPreview(cached);
      return;
    }

    let isMounted = true;
    generateCardPreview(file, token)
      .then((res) => {
        if (isMounted && res) {
          setDynamicPreview(res);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [isInView, fileId, file, token, imgError]);

  return (
    <div
      ref={cardRef}
      onClick={() => onPreview && onPreview(file)}
      onMouseEnter={() => prefetchAccessUrl && prefetchAccessUrl(file._id, token)}
      onTouchStart={() => prefetchAccessUrl && prefetchAccessUrl(file._id, token)}
      className={`group relative flex flex-col justify-between p-3 rounded-xl border transition-all duration-150 cursor-pointer select-none ${
        isSelected
          ? 'bg-blue-50/80 border-blue-300 dark:bg-blue-950/30 dark:border-blue-700 ring-1 ring-blue-500/30'
          : 'bg-white border-neutral-200 hover:bg-neutral-50/90 hover:border-neutral-300 shadow-sm dark:bg-neutral-900/60 dark:border-neutral-800/80 dark:hover:bg-neutral-800/50 dark:hover:border-neutral-700 dark:shadow-none'
      }`}
    >
      {/* Top-Left: Selection Checkbox */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect && onToggleSelect(file._id, e);
        }}
        className={`absolute top-2.5 left-2.5 z-10 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 cursor-pointer transition-all ${
          isSelected
            ? 'opacity-100 bg-white text-black border-white shadow-sm'
            : isSelectionActive
              ? 'opacity-100 md:opacity-50 md:hover:opacity-100 border-neutral-400 dark:border-neutral-500 bg-neutral-100 dark:bg-neutral-900/80'
              : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 border-neutral-400 dark:border-neutral-500 bg-neutral-100 dark:bg-neutral-900/80 hover:border-neutral-900 dark:hover:border-white shadow-sm'
        }`}
        title={isSelected ? 'Deselect file' : 'Select file'}
      >
        {isSelected && <Check className="w-3.5 h-3.5 stroke-[3] text-black" />}
      </div>

      {/* Top-Right: Three Dots Action Menu */}
      <div onClick={(e) => e.stopPropagation()} className="absolute top-2.5 right-2.5 shrink-0 z-20">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setActiveMenuId && setActiveMenuId(isMenuOpen ? null : menuKey);
          }}
          className="p-1.5 rounded-lg bg-black/80 hover:bg-black text-white shadow-md backdrop-blur-sm border border-white/15 transition-all flex items-center justify-center shrink-0 cursor-pointer opacity-100"
          title="More options"
          aria-label="More options"
        >
          <MoreVertical size={16} className="text-white stroke-[2.5]" />
        </button>

        {isMenuOpen && (
          <div
            className={`absolute w-44 sm:w-48 rounded-xl bg-white/95 dark:bg-[#18181b]/95 backdrop-blur-md border border-neutral-200 dark:border-neutral-800 shadow-2xl p-1.5 z-50 transform transition-all duration-150 ease-out animate-in fade-in zoom-in-95 ${
              isBottomRow ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
            } ${
              isRightColumn
                ? 'right-0 sm:right-0 sm:left-auto origin-top-right'
                : 'left-0 sm:left-auto sm:right-0 origin-top-left'
            }`}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPreview && onPreview(file);
                setActiveMenuId && setActiveMenuId(null);
              }}
              onMouseEnter={() => prefetchAccessUrl && prefetchAccessUrl(file._id, token)}
              onTouchStart={() => prefetchAccessUrl && prefetchAccessUrl(file._id, token)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-zinc-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer text-left"
            >
              <span className="material-symbols-outlined text-[16px] text-neutral-400 dark:text-zinc-400 shrink-0">visibility</span>
              <span>Preview</span>
            </button>

            {!file.isMalicious && file.status !== 'Malicious' && file.status !== 'malware' && file.securityStatus !== 'threat_purged' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveMenuId && setActiveMenuId(null);
                  onDownload && onDownload(file);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-zinc-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer text-left"
              >
                <span className="material-symbols-outlined text-[16px] text-neutral-400 dark:text-zinc-400 shrink-0">download</span>
                <span>Download</span>
              </button>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMove && onMove(file);
                setActiveMenuId && setActiveMenuId(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-zinc-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer text-left"
            >
              <FolderInput className="w-4 h-4 text-neutral-400 dark:text-zinc-400 shrink-0" />
              <span>Move</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRename && onRename(file);
                setActiveMenuId && setActiveMenuId(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-zinc-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer text-left"
            >
              <Pencil className="w-4 h-4 text-neutral-400 dark:text-zinc-400 shrink-0" />
              <span>Rename</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDetails && onDetails(file);
                setActiveMenuId && setActiveMenuId(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-zinc-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer text-left"
            >
              <Info className="w-4 h-4 text-neutral-400 dark:text-zinc-400 shrink-0" />
              <span>Details</span>
            </button>

            <div className="h-[1px] bg-neutral-200 dark:bg-neutral-800 my-1" />

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete && onDelete(file);
                setActiveMenuId && setActiveMenuId(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer text-left"
            >
              <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>

      {/* Hero Preview Body (Direct B2 Thumbnail, Dynamic PDF/Video/Text, or Stylized Skeleton) */}
      <div className="w-full h-32 sm:h-36 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800/50 flex items-center justify-center relative mb-2.5 border border-neutral-200/60 dark:border-neutral-800/60">
        {resolvedThumbnail ? (
          <>
            <img
              src={resolvedThumbnail}
              alt={file.name}
              loading="lazy"
              decoding="async"
              onError={() => setImgError(true)}
              className={`w-full h-full ${
                dynamicPreview?.isPdf || isPdf ? 'object-cover object-top' : 'object-cover'
              } transition-transform duration-200 group-hover:scale-105`}
            />
            {/* Top-Left Corner Badge for PDFs */}
            {(dynamicPreview?.isPdf || isPdf) && (
              <div className="absolute top-2 left-2 z-10 pointer-events-none">
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider leading-none uppercase bg-red-500 text-white shadow-sm">
                  PDF
                </span>
              </div>
            )}
            {/* Play Button Overlay for Videos */}
            {(dynamicPreview?.isVideo || isVideo) && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                <div className="w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white shadow-md">
                  <Play className="w-4 h-4 fill-white translate-x-0.5" />
                </div>
              </div>
            )}
          </>
        ) : dynamicPreview?.type === 'text' && dynamicPreview.snippet ? (
          <TextSnippetSheetCard
            ext={ext}
            badgeText={badgeText}
            badgeColor={badgeColor}
            snippet={dynamicPreview.snippet}
          />
        ) : (
          <DocumentSheetCard ext={ext} badgeText={badgeText} badgeColor={badgeColor} />
        )}
      </div>

      {/* Card Footer: Metadata */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 mb-1 min-w-0">
          <span
            className="text-xs sm:text-sm font-medium text-neutral-800 dark:text-neutral-200 group-hover:text-black dark:group-hover:text-white truncate transition-colors flex-1"
            title={file.name}
          >
            {file.name}
          </span>
        </div>

        <div className="flex items-center justify-between text-[11px] text-neutral-400 dark:text-neutral-500">
          <span className="truncate">
            {file.date || '—'} • {typeof formatSize === 'function' ? formatSize(file.size) : file.size}
          </span>
          {file.status === 'Safe' ? (
            <span title="Safe" className="text-emerald-600 dark:text-emerald-400 shrink-0 ml-1">
              <span className="material-symbols-outlined text-[13px]">check_circle</span>
            </span>
          ) : file.status === 'Malicious' || file.status === 'malware' ? (
            <span title="Malicious" className="text-red-500 shrink-0 ml-1">
              <span className="material-symbols-outlined text-[13px]">warning</span>
            </span>
          ) : file.status === 'unscanned_too_large' ? (
            <span title="Unscanned (Too Large)" className="text-neutral-400 dark:text-neutral-500 shrink-0 ml-1">
              <span className="material-symbols-outlined text-[13px]">info</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
