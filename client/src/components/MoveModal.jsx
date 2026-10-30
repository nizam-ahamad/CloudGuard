import React, { useState, useMemo, useEffect } from 'react';
import { Folder, FolderOpen, ChevronRight, ArrowLeft, X, FolderInput } from 'lucide-react';

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
  initialFolderId = null,
  isMoving = false
}) {
  // 1. Safe State Defaults
  const [folders, setFolders] = useState([]);
  const [currentPath, setCurrentPath] = useState([{ id: null, name: 'Home' }]);

  // Synchronize incoming foldersProp safely
  useEffect(() => {
    if (Array.isArray(foldersProp)) {
      setFolders(foldersProp);
    } else {
      setFolders([]);
    }
  }, [foldersProp]);

  // Reset path when modal opens or item changes
  useEffect(() => {
    if (isOpen) {
      setCurrentPath([{ id: null, name: 'Home' }]);
    }
  }, [isOpen, itemToMove, itemsProp]);

  if (!isOpen) return null;

  // 3. Path State Guard
  const safePath = Array.isArray(currentPath) && currentPath.length > 0
    ? currentPath
    : [{ id: null, name: 'Home' }];
  const currentFolder = safePath[safePath.length - 1] || { id: null, name: 'Home' };
  const activeFolderId = currentFolder.id !== undefined ? currentFolder.id : null;

  // 2. Safe Item Handling (Single File & Batch)
  const itemsToMove = Array.isArray(itemsProp) 
    ? itemsProp 
    : (Array.isArray(itemToMove) ? itemToMove : null);

  const isBatch = Array.isArray(itemsToMove) && itemsToMove.length > 1;

  const singleItem = !isBatch
    ? (Array.isArray(itemsToMove) && itemsToMove.length === 1 ? itemsToMove[0] : itemToMove)
    : null;

  const targetName = isBatch
    ? `${itemsToMove.length} items`
    : (singleItem?.name || singleItem?.fileName || (typeof singleItem === 'string' ? '1 item' : 'Item'));

  // Safe current location check
  const rawLocId = singleItem?.folderId || singleItem?.parentFolderId || singleItem?.parentId || singleItem?.folder;
  const currentLocId = rawLocId !== undefined
    ? rawLocId
    : (typeof singleItem === 'string' && initialFolderId !== undefined ? initialFolderId : null);

  const isAlreadyHere = !isBatch && (
    (currentLocId === null && activeFolderId === null) ||
    (currentLocId && activeFolderId && currentLocId.toString() === activeFolderId.toString())
  );

  // Subfolder Filtering (Subfolders Only, safely computed)
  const currentSubfolders = useMemo(() => {
    if (!Array.isArray(folders)) return [];

    // Find descendant IDs if moving a folder to prevent circular loops
    const movingFolderId = (singleItem && (singleItem.isFolder || singleItem.parentId !== undefined))
      ? (singleItem._id || singleItem.id)
      : null;

    const excludedIds = new Set();
    if (movingFolderId) {
      try {
        const rootId = movingFolderId.toString();
        excludedIds.add(rootId);
        const queue = [rootId];
        while (queue.length > 0) {
          const curId = queue.shift();
          folders.forEach(f => {
            if (!f) return;
            const pId = (f.parentId || f.parentFolderId) ? (f.parentId || f.parentFolderId).toString() : null;
            const fId = (f._id || f.id) ? (f._id || f.id).toString() : null;
            if (pId === curId && fId && !excludedIds.has(fId)) {
              excludedIds.add(fId);
              queue.push(fId);
            }
          });
        }
      } catch (err) {
        console.error('[MoveModal] Error calculating descendants:', err);
      }
    }

    return folders.filter(f => {
      if (!f) return false;
      const fId = (f._id || f.id) ? (f._id || f.id).toString() : null;
      if (fId && excludedIds.has(fId)) return false;

      const pId = (f.parentId || f.parentFolderId) ? (f.parentId || f.parentFolderId).toString() : null;
      const aId = activeFolderId ? activeFolderId.toString() : null;
      return pId === aId;
    });
  }, [folders, activeFolderId, singleItem]);

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
        <div className="flex items-center gap-2 px-4 py-2.5 bg-neutral-900 border-b border-neutral-800 text-xs text-neutral-400">
          <button
            type="button"
            onClick={handleBack}
            disabled={safePath.length <= 1}
            className={`p-1 rounded transition-colors ${
              safePath.length > 1
                ? 'hover:bg-neutral-800 hover:text-white text-neutral-300 cursor-pointer'
                : 'text-neutral-600 cursor-not-allowed opacity-40'
            }`}
            title="Go back"
            aria-label="Go back one folder"
          >
            <ArrowLeft size={16} />
          </button>

          <div className="h-4 w-[1px] bg-neutral-800 mx-0.5" />

          {/* Clickable Breadcrumb Bar */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 scrollbar-none flex-1">
            {safePath.map((crumb, idx) => {
              const isLast = idx === safePath.length - 1;
              return (
                <React.Fragment key={crumb.id || `root-${idx}`}>
                  {idx > 0 && <span className="text-neutral-600 select-none">/</span>}
                  <button
                    type="button"
                    onClick={() => handleJumpToPath(idx)}
                    disabled={isLast}
                    className={`truncate max-w-[120px] transition-colors text-left ${
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

        {/* Folder List Area */}
        <div className="min-h-[220px] max-h-[300px] overflow-y-auto divide-y divide-neutral-800/50 bg-[#121212]">
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
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isMoving}
              className="text-neutral-400 hover:text-white text-sm px-3 py-1.5 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isAlreadyHere || isMoving}
              onClick={() => {
                if (onMove && !isAlreadyHere && !isMoving) {
                  onMove(activeFolderId);
                }
              }}
              className="bg-white text-black font-semibold text-sm px-4 py-2 rounded hover:bg-neutral-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {isMoving ? 'Moving...' : 'Move Here'}
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
