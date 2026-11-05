import React from 'react';

/**
 * Clean Dark-Themed Skeleton Loader Component for Folder and File Navigation
 */
export const FolderNavigationSkeleton = () => (
  <div className="space-y-2 mt-4 animate-pulse">
    {/* Folder Skeletons */}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 bg-neutral-900/60 border border-neutral-800/60 rounded-lg" />
      ))}
    </div>

    {/* File Row Skeletons */}
    {[1, 2, 3, 4, 5].map((i) => (
      <div
        key={i}
        className="h-12 w-full bg-neutral-900/40 border border-neutral-800/40 rounded-lg flex items-center justify-between px-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 bg-neutral-800 rounded" />
          <div className="w-36 h-3 bg-neutral-800 rounded" />
        </div>
        <div className="w-16 h-3 bg-neutral-800 rounded" />
      </div>
    ))}
  </div>
);

export default FolderNavigationSkeleton;

