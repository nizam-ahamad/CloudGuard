import React, { useEffect, useRef, useState } from 'react';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Download, FileWarning, Loader2 } from 'lucide-react';

/**
 * MobilePdfViewer
 * Renders multi-page PDF documents sequentially onto high-DPI <canvas> elements
 * for mobile viewports/touch devices where native <iframe> PDF plugins fail.
 */
export default function MobilePdfViewer({ url, fileName, onDownload }) {
  const scrollContainerRef = useRef(null);
  const pagesContainerRef = useRef(null);

  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let pdfDocument = null;
    const abortController = new AbortController();

    const containerEl = pagesContainerRef.current;
    if (containerEl) {
      containerEl.replaceChildren();
    }

    setNumPages(0);
    setCurrentPage(1);
    setError(null);
    setIsLoading(true);

    if (!url) {
      return () => {
        cancelled = true;
        abortController.abort();
      };
    }

    const renderPdf = async () => {
      try {
        const isFilesCdn =
          typeof url === 'string' &&
          (url.startsWith('https://files.cloudguard.site') || url.includes('.cloudguard.site'));

        const response = await fetch(url, {
          signal: abortController.signal,
          ...(isFilesCdn ? { credentials: 'include' } : {}),
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch PDF (HTTP ${response.status})`);
        }

        const arrayBuffer = await response.arrayBuffer();
        if (cancelled) return;

        const pdfjsLib = await import('pdfjs-dist');
        if (pdfjsLib.GlobalWorkerOptions) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
        }
        if (cancelled) return;

        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(arrayBuffer),
        });
        pdfDocument = await loadingTask.promise;
        if (cancelled) {
          pdfDocument.destroy().catch(() => {});
          return;
        }

        const totalPages = pdfDocument.numPages || 0;
        setNumPages(totalPages);

        if (totalPages === 0) {
          setIsLoading(false);
          return;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const measuredWidth =
          scrollContainerRef.current?.clientWidth ||
          pagesContainerRef.current?.clientWidth ||
          (typeof window !== 'undefined' ? window.innerWidth - 32 : 340);
        const targetWidth = Math.max(measuredWidth - 16, 260);

        for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
          if (cancelled) break;

          const page = await pdfDocument.getPage(pageNumber);
          if (cancelled) {
            try {
              page.cleanup();
            } catch (_) {}
            break;
          }

          const unscaledViewport = page.getViewport({ scale: 1 });
          const baseWidth = unscaledViewport.width || 595;
          const cssScale = Math.max(targetWidth / baseWidth, 0.5);
          const renderViewport = page.getViewport({ scale: cssScale * dpr });

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(renderViewport.width));
          canvas.height = Math.max(1, Math.round(renderViewport.height));
          canvas.className = 'w-full h-auto rounded-lg shadow-md bg-white block';
          canvas.dataset.pageNumber = String(pageNumber);
          canvas.setAttribute('aria-label', `${fileName || 'PDF'} page ${pageNumber}`);

          const ctx = canvas.getContext('2d', { alpha: false });
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({
              canvasContext: ctx,
              viewport: renderViewport,
            }).promise;
          }

          try {
            page.cleanup();
          } catch (_) {}

          if (cancelled) break;

          if (pagesContainerRef.current) {
            pagesContainerRef.current.appendChild(canvas);
          }

          if (pageNumber === 1) {
            setIsLoading(false);
          }
        }

        if (!cancelled) {
          setIsLoading(false);
        }
      } catch (err) {
        if (cancelled || err?.name === 'AbortError') return;
        console.error('[MobilePdfViewer] Failed to render PDF:', err);
        setError(err?.message || 'Unable to preview PDF on this device.');
        setIsLoading(false);
      }
    };

    renderPdf();

    return () => {
      cancelled = true;
      try {
        abortController.abort();
      } catch (_) {}
      try {
        if (pdfDocument && typeof pdfDocument.destroy === 'function') {
          const destroyPromise = pdfDocument.destroy();
          if (destroyPromise && typeof destroyPromise.catch === 'function') {
            destroyPromise.catch(() => {});
          }
        }
      } catch (_) {}
      try {
        if (pagesContainerRef.current) {
          pagesContainerRef.current.replaceChildren();
        }
      } catch (_) {}
    };
  }, [url, fileName]);

  const handleScroll = () => {
    const scrollEl = scrollContainerRef.current;
    const pagesEl = pagesContainerRef.current;
    if (!scrollEl || !pagesEl || numPages <= 1) return;

    const canvases = pagesEl.children;
    if (!canvases || canvases.length === 0) return;

    const viewportCenter = scrollEl.scrollTop + scrollEl.clientHeight * 0.35;
    let activePage = 1;

    for (let i = 0; i < canvases.length; i++) {
      const canvas = canvases[i];
      if (canvas.offsetTop <= viewportCenter) {
        activePage = i + 1;
      } else {
        break;
      }
    }

    if (activePage !== currentPage) {
      setCurrentPage(activePage);
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden rounded-lg">
      {isLoading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-300 gap-2 z-20 pointer-events-none">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <span className="text-xs font-medium">Loading document...</span>
        </div>
      )}

      {error ? (
        <div className="flex flex-col items-center justify-center text-center gap-3 p-6 text-neutral-300 max-w-sm">
          <FileWarning className="w-10 h-10 text-amber-400" />
          <p className="text-sm font-medium text-neutral-100">
            Could not render PDF preview
          </p>
          <p className="text-xs text-neutral-400 break-words">
            {fileName ? `Tap below to download "${fileName}".` : 'Tap below to download and view this PDF.'}
          </p>
          {typeof onDownload === 'function' && (
            <button
              type="button"
              onClick={onDownload}
              className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download PDF</span>
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="w-full h-full overflow-y-auto px-2 py-3 space-y-3"
          >
            <div ref={pagesContainerRef} className="w-full flex flex-col space-y-3" />
          </div>

          {numPages > 0 && !isLoading && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full bg-black/75 text-white text-xs font-medium backdrop-blur-sm border border-white/10 shadow-lg">
              {currentPage} / {numPages}
            </div>
          )}
        </>
      )}
    </div>
  );
}
