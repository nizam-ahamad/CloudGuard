import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Lazy HEIC/HEIF Decoder & Renderer
 * Fetches the HEIC blob, converts it client-side to a JPEG object URL using heic2any,
 * manages loading state with a spinner, and revokes the object URL on cleanup.
 */
export function HeicPreviewImage({ src, alt, className, fallbackUrl, thumbnailUrl }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let objectUrl = null;

    async function decodeHeic() {
      if (!src) {
        setIsLoading(false);
        setHasError(true);
        return;
      }
      setIsLoading(true);
      setHasError(false);

      try {
        const resp = await fetch(src);
        if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
        const arrayBuffer = await resp.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: 'image/heic' });

        const { default: heic2any } = await import('heic2any');
        const converted = await heic2any({
          blob,
          toType: 'image/jpeg',
          quality: 0.9,
        });

        const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
        if (!isMounted) return;

        objectUrl = URL.createObjectURL(jpegBlob);
        setBlobUrl(objectUrl);
      } catch (err) {
        console.warn('[HEIC Preview] Conversion failed:', err);
        if (isMounted) setHasError(true);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    decodeHeic();

    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-3 text-neutral-400 min-h-[200px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="text-xs font-medium">Decoding HEIC image...</span>
      </div>
    );
  }

  const effectiveFallback = fallbackUrl || thumbnailUrl;

  if (hasError || !blobUrl) {
    if (effectiveFallback && !/\.(heic|heif)(\?|$)/i.test(effectiveFallback)) {
      return <img src={effectiveFallback} alt={alt} className={className} />;
    }
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-3 text-neutral-500 dark:text-neutral-400">
        <span className="material-symbols-outlined text-4xl">visibility_off</span>
        <p className="text-sm font-medium">Preview not available for this HEIC image.</p>
      </div>
    );
  }

  return <img src={blobUrl} alt={alt} className={className} />;
}

export default function FilePreviewModal({
  previewFile,
  previewUrl,
  previewText,
  closePreview,
  handleDownload,
}) {
  if (!previewFile) return null;

  const isAudio = Boolean(
    previewFile?.mimeType?.startsWith('audio/') ||
    previewFile?.mimetype?.startsWith('audio/') ||
    /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(previewFile?.name || '')
  );
  const fileExt = (previewFile.type || (previewFile.name || '').split('.').pop() || '').toLowerCase();
  const isHeic = fileExt === 'heic' || fileExt === 'heif' || previewFile?.mimeType === 'image/heic' || previewFile?.mimeType === 'image/heif';

  return !isAudio && ['mp4', 'webm', 'ogg', 'mov', 'mkv'].includes(fileExt) ? (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-md">
      <div className="flex items-center justify-between p-4 bg-transparent text-white w-full">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-white">movie</span>
          <h3 className="font-title-md text-title-md font-medium truncate">{previewFile.name}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleDownload(previewFile)}
            className="p-2 text-white/80 hover:bg-white/10 rounded-full transition-colors flex items-center cursor-pointer"
            title="Download File"
          >
            <span className="material-symbols-outlined">download</span>
          </button>
          <button
            onClick={closePreview}
            className="p-2 text-white/80 hover:bg-white/10 rounded-full transition-colors cursor-pointer"
            title="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden flex items-center justify-center p-4 w-full max-w-5xl mx-auto">
        <video
          src={previewUrl || previewFile.s3Url || previewFile.url || previewFile.downloadUrl}
          controls
          autoPlay
          playsInline
          preload="auto"
          className="max-w-full max-h-[80vh] rounded-lg object-contain shadow-2xl bg-black"
        >
          Your browser does not support the video tag.
        </video>
      </div>
    </div>
  ) : (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#18181b] rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-100">
        <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60">
          <h3 className="font-title-lg text-neutral-900 dark:text-white font-semibold truncate pr-4">{previewFile.name}</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDownload(previewFile)}
              className="bg-primary text-on-primary hover:bg-primary/90 transition-colors p-2 rounded-lg flex items-center justify-center cursor-pointer"
              title="Download File"
            >
              <span className="material-symbols-outlined">download</span>
            </button>
            <button
              onClick={closePreview}
              className="p-2 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-full transition-colors cursor-pointer"
              title="Close"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-neutral-100 dark:bg-neutral-950 p-4 flex items-center justify-center">
          {isHeic ? (
            <HeicPreviewImage
              src={previewUrl}
              alt={previewFile.name}
              className="max-w-full max-h-[70vh] object-contain shadow-sm rounded"
              fallbackUrl={previewFile.thumbnailUrl || previewFile.thumbnail}
            />
          ) : ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(fileExt) ? (
            <img src={previewUrl} alt={previewFile.name} className="max-w-full max-h-[70vh] object-contain shadow-sm rounded" />
          ) : fileExt === 'pdf' ? (
            <iframe src={previewUrl} className="w-full h-[70vh] border-0 rounded" title="PDF Preview" />
          ) : (fileExt === 'txt' || fileExt === 'md') ? (
            <pre className="w-full h-full text-left bg-white dark:bg-[#121212] text-neutral-900 dark:text-neutral-100 p-6 rounded-lg overflow-auto text-sm font-mono whitespace-pre-wrap shadow-inner border border-neutral-200 dark:border-neutral-800">
              {previewText || 'Loading...'}
            </pre>
          ) : (isAudio && previewUrl) ? (
            <div className="w-full max-w-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 sm:p-8 shadow-xl flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl">music_note</span>
              </div>
              <div className="max-w-full px-2">
                <h4 className="text-base sm:text-lg font-semibold text-neutral-900 dark:text-white truncate" title={previewFile.name}>
                  {previewFile.name}
                </h4>
              </div>
              <audio
                controls
                autoPlay
                preload="metadata"
                src={previewUrl}
                className="w-full max-w-md"
              />
            </div>
          ) : (
            <div className="text-neutral-500 dark:text-neutral-400 flex flex-col items-center gap-3">
              <span className="material-symbols-outlined text-4xl">visibility_off</span>
              <p>Preview not available for this file type.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
