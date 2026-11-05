import React from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Settings, Folder, Clock, Image } from 'lucide-react';

export default function Sidebar({ isCollapsed = false, onClose, setShowSettings, setActiveTab }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const isSettingsActive = 
    location.pathname === '/dashboard' && searchParams.get('view') === 'settings';

  const handleOpenSettings = () => {
    if (typeof setShowSettings === 'function') {
      setShowSettings(true);
    }
    if (typeof onClose === 'function') {
      onClose();
    }
    navigate('/dashboard?view=settings');
  };

  const handleNavClick = (tab) => {
    // 1. Immediately dismiss settings in state and query string
    if (typeof setShowSettings === 'function') {
      setShowSettings(false);
    }
    if (typeof onClose === 'function') {
      onClose();
    }

    // 2. Clear ?view=settings from URL
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('view');

    // 3. Navigate cleanly to the target view
    if (tab === 'files') {
      newParams.delete('tab');
      setSearchParams(newParams);
      if (typeof setActiveTab === 'function') setActiveTab('files');
      navigate('/dashboard');
    } else if (tab === 'recent') {
      newParams.set('tab', 'recent');
      setSearchParams(newParams);
      if (typeof setActiveTab === 'function') setActiveTab('recent');
      navigate('/dashboard?tab=recent');
    } else if (tab === 'photos') {
      newParams.delete('tab');
      setSearchParams(newParams);
      navigate('/dashboard/photos');
    }
  };

  const isFilesActive = 
    location.pathname === '/dashboard' && !searchParams.get('view') && searchParams.get('tab') !== 'recent';
  const isRecentActive = 
    location.pathname === '/dashboard' && !searchParams.get('view') && searchParams.get('tab') === 'recent';
  const isPhotosActive = 
    location.pathname === '/dashboard/photos';

  return (
    <aside className="w-full flex flex-col h-full">
      <nav className="flex flex-col space-y-1">
        {/* My Files Button */}
        <button
          type="button"
          onClick={() => handleNavClick('files')}
          className={`group relative w-full flex items-center h-12 rounded-full font-bold cursor-pointer active:opacity-80 transition-colors duration-200 text-left ${
            isFilesActive
              ? 'text-secondary bg-surface-container-low dark:bg-[#282a2c] dark:text-[#e3e3e3]'
              : 'text-on-surface-variant dark:text-[#c4c7c5] hover:text-on-surface hover:bg-surface-container-high dark:hover:bg-[#333538] dark:hover:text-[#e3e3e3]'
          }`}
        >
          <div className="min-w-[3rem] flex justify-center items-center">
            <span className="material-symbols-outlined shrink-0" data-weight={isFilesActive ? 'fill' : ''}>
              folder_open
            </span>
          </div>
          <span
            className={`font-semibold font-body-md text-body-md overflow-hidden whitespace-nowrap transition-all duration-300 ${
              isCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100'
            }`}
          >
            My Files
          </span>
          {isCollapsed && (
            <div className="absolute left-full ml-4 px-3 py-1 bg-[#1e1f20] border border-zinc-800 text-[#e3e3e3] rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
              My Files
            </div>
          )}
        </button>

        {/* Photos Button */}
        <button
          type="button"
          onClick={() => handleNavClick('photos')}
          className={`group relative w-full flex items-center h-12 rounded-full font-bold cursor-pointer active:opacity-80 transition-colors duration-200 text-left ${
            isPhotosActive
              ? 'text-secondary bg-surface-container-low dark:bg-[#282a2c] dark:text-[#e3e3e3]'
              : 'text-on-surface-variant dark:text-[#c4c7c5] hover:text-on-surface hover:bg-surface-container-high dark:hover:bg-[#333538] dark:hover:text-[#e3e3e3]'
          }`}
        >
          <div className="min-w-[3rem] flex justify-center items-center">
            <span className="material-symbols-outlined shrink-0" data-weight={isPhotosActive ? 'fill' : ''}>
              photo_library
            </span>
          </div>
          <span
            className={`font-semibold font-body-md text-body-md overflow-hidden whitespace-nowrap transition-all duration-300 ${
              isCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100'
            }`}
          >
            Photos
          </span>
          {isCollapsed && (
            <div className="absolute left-full ml-4 px-3 py-1 bg-[#1e1f20] border border-zinc-800 text-[#e3e3e3] rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
              Photos
            </div>
          )}
        </button>

        {/* Recent Button */}
        <button
          type="button"
          onClick={() => handleNavClick('recent')}
          className={`group relative w-full flex items-center h-12 rounded-full font-bold cursor-pointer active:opacity-80 transition-colors duration-200 text-left ${
            isRecentActive
              ? 'text-secondary bg-surface-container-low dark:bg-[#282a2c] dark:text-[#e3e3e3]'
              : 'text-on-surface-variant dark:text-[#c4c7c5] hover:text-on-surface hover:bg-surface-container-high dark:hover:bg-[#333538] dark:hover:text-[#e3e3e3]'
          }`}
        >
          <div className="min-w-[3rem] flex justify-center items-center">
            <span className="material-symbols-outlined shrink-0" data-weight={isRecentActive ? 'fill' : ''}>
              history
            </span>
          </div>
          <span
            className={`font-semibold font-body-md text-body-md overflow-hidden whitespace-nowrap transition-all duration-300 ${
              isCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100'
            }`}
          >
            Recent
          </span>
          {isCollapsed && (
            <div className="absolute left-full ml-4 px-3 py-1 bg-[#1e1f20] border border-zinc-800 text-[#e3e3e3] rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
              Recent
            </div>
          )}
        </button>
      </nav>

      {/* Bottom Settings Button in Sidebar */}
      <div className="mt-auto pt-4 border-t border-outline-variant">
        <button
          type="button"
          onClick={handleOpenSettings}
          className={`group relative flex items-center w-full h-12 rounded-full font-medium transition-colors cursor-pointer ${
            isSettingsActive
              ? 'bg-surface-container-low dark:bg-[#282a2c] text-neutral-900 dark:text-white font-semibold'
              : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 hover:text-neutral-900 dark:hover:text-white'
          }`}
        >
          <div className="min-w-[3rem] flex justify-center items-center">
            <span className="material-symbols-outlined shrink-0" data-weight={isSettingsActive ? 'fill' : ''}>settings</span>
          </div>
          <span
            className={`font-semibold font-body-md text-body-md overflow-hidden whitespace-nowrap transition-all duration-300 ${
              isCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100'
            }`}
          >
            Settings
          </span>
          {isCollapsed && (
            <div className="absolute left-full ml-4 px-3 py-1 bg-[#1e1f20] border border-zinc-800 text-[#e3e3e3] rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
              Settings
            </div>
          )}
        </button>
      </div>
    </aside>
  );
}
