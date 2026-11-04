import React from 'react';
import { NavLink } from 'react-router-dom';

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
  },
  {
    name: 'Settings',
    path: '/dashboard/settings',
    iconSymbol: 'settings'
  }
];

export default function Sidebar({ isCollapsed = false, onClose }) {
  return (
    <aside className="w-full">
      <nav className="flex flex-col space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
            onClick={onClose}
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
    </aside>
  );
}
