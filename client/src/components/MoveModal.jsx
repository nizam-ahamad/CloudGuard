import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Folder, FolderOpen, ChevronRight, ArrowLeft, X, FolderInput, Plus, Loader2 } from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { useToast } from '../context/ToastContext';

/**
 * Inner Move Dialog Content with Safe State Defaults and Defensive Guards
 */
function MoveModalContent({
  isOpen,
  onClose,
  itemToMove,
  itemsToMove: itemsProp,
  folders: foldersProp = [],
  onMove,
  onSuccess,
  onFolderCreated,
  initialFolderId = null,
  currentPath: initialPath,
  initialPath: initialPathAlt,
  isMoving = false
}) {
  const incomingInitialPath = initialPath || initialPathAlt || null;
  const toast = useToast();

  // 1. Safe State Defaults - Initialize currentPath from props rather than hardcoded Home
  const [folders, setFolders] = useState([]);
  const [currentPath, setCurrentPath] = useState(() => {
    if (incomingInitialPath && Array.isArray(incomingInitialPath) && incomingInitialPath.length > 0) {
      return incomingInitialPath;
    }
    return [{ id: null, name: 'Home' }];
  });

  // Inline folder creation state
  const [isCreatingInline, setIsCreatingInline] = useState(false);
  const [inlineFolderName, setInlineFolderName] = useState('');
  const [isSubmittingFolder, setIsSubmittingFolder] = useState(false);
  const [inlineError, setInlineError] = useState('');
  const inlineInputRef = useRef(null);

  // Synchronize incoming foldersProp safely
  useEffect(() => {
    if (Array.isArray(foldersProp)) {
      setFolders(foldersProp);
    } else {
      setFolders([]);
    }
  }, [foldersProp]);

  // Sync path if modal re-opens with different folder context
  useEffect(() => {
    if (isOpen && incomingInitialPath && Array.isArray(incomingInitialPath) && incomingInitialPath.length > 0) {
      setCurrentPath(incomingInitialPath);
    } else if (isOpen && (!incomingInitialPath || incomingInitialPath.length === 0)) {
      setCurrentPath([{ id: null, name: 'Home' }]);
    }
  }, [isOpen, incomingInitialPath]);

  if (!isOpen) return null;

  // Path State Guard
  const safePath = Array.isArray(currentPath) && currentPath.length > 0
    ? currentPath
    : [{ id: null, name: 'Home' }];
  const currentFolder = safePath[safePath.length - 1] || { id: null, name: 'Home' };
  const activeFolderId = currentFolder.id !== undefined ? currentFolder.id : null;

  // 2. Safe Item Handling (Single File & Multi-Item Batch Moves)
  const itemsToMove = Array.isArray(itemsProp) && itemsProp.length > 0
    ? itemsProp
    : (Array.isArray(itemToMove) && itemToMove.length > 0
        ? itemToMove
        : (itemToMove ? [itemToMove] : []));

  const isBatch = itemsToMove.length > 1;
  const singleItem = itemsToMove.length === 1 ? itemsToMove[0] : null;

  const targetName = isBatch
    ? `${itemsToMove.length} items`
    : (singleItem?.name || singleItem?.fileName || (typeof singleItem === 'string' ? '1 item' : 'Item'));

  // Safe current location check
  const getItemLocation = (item) => {
    if (!item) return null;
    if (typeof item === 'string') return initialFolderId ?? null;
    const loc = item.folderId?._id || item.folderId || item.parentId || item.parentFolderId || item.folder?._id || item.folder;
    return loc !== undefined ? loc : (initialFolderId ?? null);
  };

  const isAlreadyHere = itemsToMove.length > 0 && itemsToMove.every(item => {
    const loc = getItemLocation(item);
    const normLoc = loc ? String(loc) : null;
    const normActive = activeFolderId ? String(activeFolderId) : null;
    return normLoc === normActive;
  });

  // 3. Circular Move Protection (For Folders)
  // When moving folders, collect all selected folder IDs and all their recursive descendant subfolder IDs
  const circularFolderIds = useMemo(() => {
    const movingFolderIds = new Set();

    itemsToMove.forEach(item => {
      if (!item) return;
      const isFolderItem = item.isFolder || item.parentId !== undefined || item.parentFolderId !== undefined || (typeof item === 'object' && !item.s3Key && !item.mimetype && !item.size);
      if (isFolderItem) {
        const id = item._id || item.id || (typeof item === 'string' ? item : null);
        if (id) movingFolderIds.add(String(id));
      }
    });

    const excluded = new Set(movingFolderIds);
    movingFolderIds.forEach(rootId => {
      const queue = [rootId];
      while (queue.length > 0) {
        const curId = queue.shift();
        folders.forEach(f => {
          if (!f) return;
          const pId = String(f.parentId || f.parentFolderId || '');
          const fId = String(f._id || f.id || '');
          if (pId === curId && fId && !excluded.has(fId)) {
            excluded.add(fId);
            queue.push(fId);
          }
        });
      }
    });

    return excluded;
  }, [itemsToMove, folders]);

  // Subfolder Filtering (Subfolders Only, safely excluding circular descendants)
  const currentSubfolders = useMemo(() => {
    if (!Array.isArray(folders)) return [];

    return folders.filter(f => {
      if (!f) return false;
      const fId = String(f._id || f.id || '');
      if (fId && circularFolderIds.has(fId)) return false;

      const pId = String(f.parentId || f.parentFolderId || '');
      const aId = String(activeFolderId || '');
      return pId === aId;
    });
  }, [folders, activeFolderId, circularFolderIds]);

  const isCircularTarget = activeFolderId ? circularFolderIds.has(String(activeFolderId)) : false;
  const isMoveDisabled = isAlreadyHere || isCircularTarget || isMoving || itemsToMove.length === 0;

  // Drill down into a subfolder
  const handleOpenFolder = (folder) => {
    if (!folder) return;
    const fId = folder._id || folder.id;
    const fName = folder.name || 'Folder';
    setCurrentPath(prev => [
      ...(Array.isArray(prev) ? prev : [{ id: null, name: 'Home' }]),
      { id: fId, name: fName }
    ]);
  };

  // Navigate back one level
  const handleBack = () => {
    if (safePath.length > 1) {
      setCurrentPath(prev => (Array.isArray(prev) && prev.length > 1 ? prev.slice(0, -1) : [{ id: null, name: 'Home' }]));
    }
  };

  // Jump to specific breadcrumb
  const handleJumpToPath = (index) => {
    if (index < safePath.length - 1) {
      setCurrentPath(prev => (Array.isArray(prev) ? prev.slice(0, index + 1) : [{ id: null, name: 'Home' }]));
    }
  };

  // Inline folder creation handler
  const handleCreateInlineFolder = async (e) => {
    if (e) e.preventDefault();
    const trimmed = inlineFolderName.trim();
    if (!trimmed) {
      setInlineError('Folder name is required');
      return;
    }

    // Check duplicate locally in current view
    const isDuplicate = currentSubfolders.some(
      f => (f.name || '').toLowerCase() === trimmed.toLowerCase()
    );
    if (isDuplicate) {
      setInlineError('A folder with this name already exists here');
      return;
    }

    setIsSubmittingFolder(true);
    setInlineError('');

    try {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const res = await axios.post(
        `${API_BASE_URL}/api/folders`,
        { name: trimmed, parentId: activeFolderId || null },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const createdFolder = res.data;
      if (createdFolder) {
        // Update local folder list
        setFolders(prev => [...prev, createdFolder]);

        // Notify parent if callback provided
        if (typeof onFolderCreated === 'function') {
          onFolderCreated(createdFolder);
        }

        // Auto-navigate into the newly created folder
        setCurrentPath(prev => [
          ...(Array.isArray(prev) ? prev : [{ id: null, name: 'Home' }]),
          { id: createdFolder._id || createdFolder.id, name: createdFolder.name }
        ]);

        // Reset inline input state
        setInlineFolderName('');
        setIsCreatingInline(false);

        if (toast && typeof toast.success === 'function') {
          toast.success(`Folder "${createdFolder.name}" created`);
        }
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to create folder';
      setInlineError(msg);
      if (toast && typeof toast.error === 'function') {
        toast.error(msg);
      }
    } finally {
      setIsSubmittingFolder(false);
    }
  };

  const handleExecuteMove = () => {
    if (isMoveDisabled) return;
    if (onMove) {
      onMove(activeFolderId, itemsToMove, currentFolder);
    } else if (onSuccess) {
      onSuccess(activeFolderId, itemsToMove, currentFolder);
    }
  };

  const moveButtonText = isMoving 
    ? 'Moving...' 
    : currentFolder.name 
      ? `Move to ${currentFolder.name}` 
      : 'Move Here';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div 
        className="bg-[#121212] border border-neutral-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <FolderInput size={18} className="text-white flex-shrink-0" />
            <h3 id="move-modal-title" className="font-semibold text-white text-base truncate">
              Move &ldquo;{targetName}&rdquo;
            </h3>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Breadcrumb & Back Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-neutral-900 border-b border-neutral-800 text-xs text-neutral-400">
          <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
            <button
              type="button"
              onClick={handleBack}
              disabled={safePath.length <= 1}
              className={`p-1 rounded transition-colors shrink-0 ${
                safePath.length > 1
                  ? 'hover:bg-neutral-800 hover:text-white text-neutral-300 cursor-pointer'
                  : 'text-neutral-600 cursor-not-allowed opacity-40'
              }`}
              title="Go back"
              aria-label="Go back one folder"
            >
              <ArrowLeft size={16} />
            </button>

            <div className="h-4 w-[1px] bg-neutral-800 mx-0.5 shrink-0" />

            {/* Clickable Breadcrumb Bar */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 scrollbar-none flex-1 min-w-0">
              {safePath.map((crumb, idx) => {
                const isLast = idx === safePath.length - 1;
                return (
                  <React.Fragment key={crumb.id || `root-${idx}`}>
                    {idx > 0 && <span className="text-neutral-600 select-none shrink-0">/</span>}
                    <button
                      type="button"
                      onClick={() => handleJumpToPath(idx)}
                      disabled={isLast}
                      className={`truncate max-w-[110px] sm:max-w-[140px] transition-colors text-left shrink-0 ${
                        isLast 
                          ? 'text-white font-medium cursor-default' 
                          : 'text-neutral-400 hover:text-white cursor-pointer'
                      }`}
                      title={crumb.name || 'Home'}
                    >
                      {crumb.name || 'Home'}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Compact + New Folder Button */}
          <button
            type="button"
            onClick={() => {
              setIsCreatingInline(true);
              setInlineFolderName('');
              setInlineError('');
              setTimeout(() => inlineInputRef.current?.focus(), 50);
            }}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700/80 rounded-lg transition-colors shrink-0 cursor-pointer border border-neutral-700/50"
            title="Create new folder here"
          >
            <Plus size={14} className="shrink-0" />
            <span className="whitespace-nowrap">New Folder</span>
          </button>
        </div>

        {/* Inline Folder Creation Bar */}
        {isCreatingInline && (
          <div className="px-4 py-2.5 bg-neutral-900/90 border-b border-neutral-800 animate-in fade-in duration-150">
            <form onSubmit={handleCreateInlineFolder} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <input
                  ref={inlineInputRef}
                  type="text"
                  autoFocus
                  disabled={isSubmittingFolder}
                  value={inlineFolderName}
                  onChange={(e) => {
                    setInlineFolderName(e.target.value);
                    if (inlineError) setInlineError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsCreatingInline(false);
                      setInlineFolderName('');
                      setInlineError('');
                    }
                  }}
                  placeholder="Folder name..."
                  className="flex-1 px-3 py-1.5 text-xs bg-neutral-950 text-white placeholder-neutral-500 border border-neutral-700 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                />
                <button
                  type="submit"
                  disabled={isSubmittingFolder || !inlineFolderName.trim()}
                  className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  {isSubmittingFolder ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create</span>
                  )}
                </button>
                <button
                  type="button"
                  disabled={isSubmittingFolder}
                  onClick={() => {
                    setIsCreatingInline(false);
                    setInlineFolderName('');
                    setInlineError('');
                  }}
                  className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors shrink-0 cursor-pointer"
                  title="Cancel"
                  aria-label="Cancel folder creation"
                >
                  <X size={15} />
                </button>
              </div>
              {inlineError && (
                <p className="text-[11px] text-red-400 font-medium px-1 leading-tight">{inlineError}</p>
              )}
            </form>
          </div>
        )}

        {/* Folder List Area */}
        <div className="min-h-[220px] max-h-[60vh] overflow-y-auto overscroll-contain divide-y divide-neutral-800/50 bg-[#121212]">
          {currentSubfolders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[220px] text-center p-6 text-neutral-500">
              <FolderOpen size={36} className="text-neutral-600 mb-2 stroke-[1.5]" />
              <p className="text-sm font-normal text-neutral-400">No subfolders here</p>
              <p className="text-xs text-neutral-500 mt-1">You can move into &ldquo;{currentFolder.name || 'Home'}&rdquo;</p>
            </div>
          ) : (
            currentSubfolders.map(folder => (
              <div
                key={folder._id || folder.id}
                onClick={() => handleOpenFolder(folder)}
                className="hover:bg-neutral-800/60 cursor-pointer transition-colors p-3 flex items-center justify-between group"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleOpenFolder(folder);
                  }
                }}
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <Folder size={18} className="text-neutral-400 group-hover:text-amber-400 transition-colors flex-shrink-0" />
                  <span className="text-sm text-neutral-200 font-medium truncate">
                    {folder.name || 'Untitled Folder'}
                  </span>
                </div>
                <ChevronRight size={16} className="text-neutral-500 group-hover:text-neutral-300 transition-transform group-hover:translate-x-0.5 flex-shrink-0" />
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 bg-neutral-900/80 border-t border-neutral-800 gap-3">
          <div className="min-w-0 text-left">
            <p className="text-xs text-neutral-400 truncate">
              Moving to: <span className="text-white font-medium">{currentFolder.name || 'Home'}</span>
            </p>
            {isAlreadyHere && (
              <p className="text-[11px] text-amber-400/90 font-light mt-0.5">
                Already in this location
              </p>
            )}
            {isCircularTarget && (
              <p className="text-[11px] text-red-400 font-light mt-0.5">
                Cannot move into self or subfolder
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isMoving}
              className="text-neutral-400 hover:text-white text-sm px-3 py-1.5 rounded transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isMoveDisabled}
              onClick={handleExecuteMove}
              className="bg-white text-black font-semibold text-sm px-4 py-2 rounded hover:bg-neutral-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 cursor-pointer"
            >
              {moveButtonText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Error boundary wrapped MoveModal to prevent any unhandled render exception
 * from crashing the parent application.
 */
class MoveModalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, errorInfo) {
    console.error('[MoveModal] Crash prevented by boundary:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

export default function MoveModal(props) {
  if (!props.isOpen) return null;
  return (
    <MoveModalErrorBoundary>
      <MoveModalContent {...props} />
    </MoveModalErrorBoundary>
  );
}
