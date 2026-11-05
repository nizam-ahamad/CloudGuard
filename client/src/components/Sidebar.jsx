import React from 'react';
import { NavLink, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Settings } from 'lucide-react';

const navItems = [
  {
    name: 'My Files',
    path: '/dashboard',
    iconSymbol: 'folder_open',
    end: true
  },
  {
    name: 'Photos',
    path: '/dashboard/photos',
    iconSymbol: 'photo_library'
  },
  {
    name: 'Recent',
    path: '/dashboard/recent',
    iconSymbol: 'history'
  }
];

export default function Sidebar({ isCollapsed = false, onClose, setShowSettings }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

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

  return (
    <aside className="w-full flex flex-col h-full">
      <nav className="flex flex-col space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
            onClick={() => {
              if (typeof setShowSettings === 'function') setShowSettings(false);
              if (typeof onClose === 'function') onClose();
            }}
            className={({ isActive }) =>
              `group relative w-full flex items-center h-12 rounded-full font-bold cursor-pointer active:opacity-80 transition-colors duration-200 text-center ${
                isActive
                  ? 'text-secondary bg-surface-container-low dark:bg-[#282a2c] dark:text-[#e3e3e3]'
                  : 'text-on-surface-variant dark:text-[#c4c7c5] hover:text-on-surface hover:bg-surface-container-high dark:hover:bg-[#333538] dark:hover:text-[#e3e3e3]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className="min-w-[3rem] flex justify-center items-center">
                  <span
                    className="material-symbols-outlined shrink-0"
                    data-weight={isActive ? 'fill' : ''}
                  >
                    {item.iconSymbol}
                  </span>
                </div>
                <span
                  className={`text-center font-semibold font-body-md text-body-md overflow-hidden whitespace-nowrap transition-all duration-300 ${
                    isCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100'
                  }`}
                >
                  {item.name}
                </span>
                {isCollapsed && (
                  <div className="absolute left-full ml-4 px-3 py-1 bg-[#1e1f20] border border-zinc-800 text-[#e3e3e3] rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    {item.name}
                  </div>
                )}
              </>
            )}
          </NavLink>
        ))}
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
