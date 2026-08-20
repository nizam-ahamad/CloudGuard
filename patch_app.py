import os

app_jsx_path = r"c:\Users\Sanu\Desktop\CloudGuard\client\src\App.jsx"

with open(app_jsx_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. ADD AUTHENTICATION STATE & LOGIC
new_imports_and_state = """import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token') || sessionStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    const userStr = localStorage.getItem('user') || sessionStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  });
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '', remember: false });
  const [authError, setAuthError] = useState('');
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [storageStats, setStorageStats] = useState({ usedBytes: 0, totalLimitBytes: 1, usedPercentage: 0 });

  const formatBytes = (bytes, decimals = 1) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const fetchStorageStats = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/storage-stats');
      setStorageStats(res.data);
    } catch (err) {
      console.error('Error fetching storage stats:', err);
    }
  };

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      fetchStorageStats();
      fetchFiles();
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (authMode === 'register') {
        await axios.post('http://localhost:5000/api/auth/register', authForm);
        setAuthMode('login');
        setToastMessage({ type: 'success', message: 'Account created! Please sign in.' });
      } else {
        const res = await axios.post('http://localhost:5000/api/auth/login', { email: authForm.email, password: authForm.password });
        const { token: newToken, user: newUser } = res.data;
        if (authForm.remember) {
          localStorage.setItem('token', newToken);
          localStorage.setItem('user', JSON.stringify(newUser));
        } else {
          sessionStorage.setItem('token', newToken);
          sessionStorage.setItem('user', JSON.stringify(newUser));
        }
        setToken(newToken);
        setUser(newUser);
      }
    } catch (err) {
      setAuthError(err.response?.data?.error || 'Authentication failed');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setShowProfileMenu(false);
  };

  const [files, setFiles] = useState([]);"""

content = content.replace("import React, { useState, useRef, useEffect } from 'react';\nimport axios from 'axios';\n\nfunction App() {\n  const [files, setFiles] = useState([]);", new_imports_and_state)

# Fix fetchFiles to use token in dependencies, remove useEffect that only listens to currentDirectory
# Let's replace the first useEffect
content = content.replace("""  useEffect(() => {
    fetchFiles();
  }, [currentDirectory]);""", """  useEffect(() => {
    if (token) fetchFiles();
  }, [currentDirectory, token]);""")

# 2. RENDER AUTH VIEW IF NO TOKEN
auth_view = """  if (!token) {
    return (
      <div className="min-h-screen bg-surface-container-lowest flex items-center justify-center p-4">
        <div className="bg-surface w-full max-w-md rounded-2xl shadow-xl border border-outline-variant p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-xl bg-surface-container-high flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-secondary text-3xl" data-weight="fill">security</span>
            </div>
            <h1 className="font-headline-md text-primary font-bold">CloudGuard</h1>
            <p className="text-on-surface-variant mt-2 font-body-md text-center">
              {authMode === 'login' ? 'Sign in to access your secure storage' : 'Create an account to get started'}
            </p>
          </div>

          {authError && (
            <div className="mb-6 p-3 bg-error/10 border border-error/20 rounded-lg text-error text-sm text-center">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authMode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Full Name</label>
                <input 
                  type="text" 
                  required 
                  className="w-full px-4 py-2 bg-surface-container-lowest border border-outline-variant rounded-lg focus:ring-2 focus:ring-secondary outline-none transition-all"
                  value={authForm.name}
                  onChange={e => setAuthForm({...authForm, name: e.target.value})}
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-on-surface mb-1">Email</label>
              <input 
                type="email" 
                required 
                className="w-full px-4 py-2 bg-surface-container-lowest border border-outline-variant rounded-lg focus:ring-2 focus:ring-secondary outline-none transition-all"
                value={authForm.email}
                onChange={e => setAuthForm({...authForm, email: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-on-surface mb-1">Password</label>
              <input 
                type="password" 
                required 
                className="w-full px-4 py-2 bg-surface-container-lowest border border-outline-variant rounded-lg focus:ring-2 focus:ring-secondary outline-none transition-all"
                value={authForm.password}
                onChange={e => setAuthForm({...authForm, password: e.target.value})}
              />
            </div>
            
            {authMode === 'login' && (
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="remember" 
                  className="rounded border-outline-variant text-secondary focus:ring-secondary w-4 h-4"
                  checked={authForm.remember}
                  onChange={e => setAuthForm({...authForm, remember: e.target.checked})}
                />
                <label htmlFor="remember" className="ml-2 text-sm text-on-surface-variant">Remember me</label>
              </div>
            )}

            <button 
              type="submit" 
              className="w-full py-3 bg-primary text-on-primary rounded-lg font-medium hover:bg-primary/90 transition-colors mt-6 shadow-sm"
            >
              {authMode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button 
              type="button"
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'register' : 'login');
                setAuthError('');
              }}
              className="text-secondary text-sm hover:underline font-medium"
            >
              {authMode === 'login' ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full">"""

content = content.replace("  return (\n    <div className=\"flex h-screen w-full\">", auth_view)


# 3. REMOVE SIDEBAR UPLOAD BUTTON
old_sidebar_cta = """        {/* CTA */}
        <div className="px-6 mb-6">
          <button onClick={triggerFileInput} className="w-full bg-secondary text-on-secondary font-body-md text-body-md font-medium py-3 px-4 rounded-lg flex items-center justify-center gap-2 hover:bg-secondary-container transition-colors shadow-sm">
            <span className="material-symbols-outlined">cloud_upload</span>
            Upload File
          </button>
        </div>"""
content = content.replace(old_sidebar_cta, "")


# 4. REPLACE STORAGE WIDGET & PROFILE AVATAR
old_top_right = """        <div className="hidden md:flex flex-1 max-w-md ml-4 mr-8">
          <div className="relative w-full focus-within:ring-2 focus-within:ring-secondary rounded-lg transition-all">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
            <input className="w-full bg-surface text-on-surface border border-outline-variant rounded-lg pl-10 pr-4 py-2 font-body-md text-body-md outline-none" placeholder="Search files, folders..." type="text" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors relative">
            <span className="material-symbols-outlined">notifications</span>
            <span className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full"></span>
          </button>
          <button className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors hidden sm:block">
            <span className="material-symbols-outlined">help</span>
          </button>
          <div className="w-10 h-10 rounded-full bg-secondary text-on-secondary flex items-center justify-center font-title-md ml-2 cursor-pointer border-2 border-surface-container-lowest">
            N
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 mt-16 md:ml-64 bg-surface h-[calc(100vh-4rem)] overflow-y-auto px-margin-mobile md:px-margin-desktop py-stack-lg">
        
        {/* Welcome Section */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end mb-stack-lg gap-4">
          <div>
            <h2 className="font-display-sm text-display-sm text-on-surface font-semibold mb-2">Welcome back, Nizam</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">Manage and secure your enterprise data.</p>
          </div>
          <div className="hidden lg:flex items-center gap-4 bg-surface-container-lowest p-4 rounded-xl border border-outline-variant shadow-sm">
            <div className="relative w-12 h-12">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                <path className="text-surface-dim" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3"></path>
                <path className="text-secondary" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeDasharray="65, 100" strokeWidth="3"></path>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center font-label-md text-[10px] font-bold text-on-surface">65%</div>
            </div>
            <div>
              <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Storage Used</p>
              <p className="font-body-md text-body-md font-medium">650 GB / 1 TB</p>
            </div>
          </div>
        </div>"""

new_top_right = """        <div className="hidden md:flex flex-1 max-w-md ml-4 mr-8">
          <div className="relative w-full focus-within:ring-2 focus-within:ring-secondary rounded-lg transition-all">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
            <input className="w-full bg-surface text-on-surface border border-outline-variant rounded-lg pl-10 pr-4 py-2 font-body-md text-body-md outline-none" placeholder="Search files, folders..." type="text" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors relative">
            <span className="material-symbols-outlined">notifications</span>
            <span className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full"></span>
          </button>
          
          {/* User Profile Dropdown */}
          <div className="relative ml-2">
            <div 
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="w-10 h-10 rounded-full bg-secondary text-on-secondary flex items-center justify-center font-title-md cursor-pointer border-2 border-surface-container-lowest select-none"
            >
              {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
            </div>
            {showProfileMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-surface-container-lowest border border-outline-variant shadow-lg rounded-xl overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-outline-variant bg-surface-container-low">
                  <p className="text-sm font-bold text-on-surface truncate">{user?.name}</p>
                  <p className="text-xs text-on-surface-variant truncate">{user?.email}</p>
                </div>
                <button 
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-3 text-error hover:bg-surface-container-high text-sm flex items-center gap-2 transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">logout</span> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 mt-16 md:ml-64 bg-surface h-[calc(100vh-4rem)] overflow-y-auto px-margin-mobile md:px-margin-desktop py-stack-lg" onClick={() => setShowProfileMenu(false)}>
        
        {/* Welcome Section */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end mb-stack-lg gap-4">
          <div>
            <h2 className="font-display-sm text-display-sm text-on-surface font-semibold mb-2">Welcome back, {user?.name ? user.name.split(' ')[0] : 'User'}</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">Manage and secure your enterprise data.</p>
          </div>
          <div className="hidden lg:flex items-center gap-4 bg-surface-container-lowest p-4 rounded-xl border border-outline-variant shadow-sm">
            <div className="relative w-12 h-12">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                <path className="text-surface-dim" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3"></path>
                <path className="text-secondary" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeDasharray={`${storageStats.usedPercentage}, 100`} strokeWidth="3"></path>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center font-label-md text-[10px] font-bold text-on-surface">{Math.round(storageStats.usedPercentage)}%</div>
            </div>
            <div>
              <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Storage Used</p>
              <p className="font-body-md text-body-md font-medium">{formatBytes(storageStats.usedBytes)} / {formatBytes(storageStats.totalLimitBytes, 0)}</p>
            </div>
          </div>
        </div>"""
content = content.replace(old_top_right, new_top_right)


# 5. FIX ACTION ICONS (Always visible, no dropdown needed, no hover needed)
old_table_actions = """                      <td className="py-3 px-6 text-right relative">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === file.id ? null : file.id); }}
                          className="p-1.5 text-on-surface-variant hover:text-secondary rounded hover:bg-surface-container-high transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                        >
                          <span className="material-symbols-outlined">more_vert</span>
                        </button>
                        {activeMenu === file.id && (
                          <div className="absolute right-8 top-10 bg-surface-container-lowest border border-outline-variant shadow-lg rounded-lg py-2 w-32 z-10 flex flex-col items-start">
                            {!file.isFolder && file.diskName && file.status === 'Safe' && (
                              <a 
                                href={`http://localhost:5000/api/download/${file.diskName}`} 
                                download
                                onClick={(e) => { e.stopPropagation(); setActiveMenu(null); }}
                                className="w-full text-left px-4 py-2 hover:bg-surface-container-high text-on-surface text-sm flex items-center gap-2"
                              >
                                <span className="material-symbols-outlined text-sm">download</span> Download
                              </a>
                            )}
                            <button 
                              onClick={(e) => { e.stopPropagation(); setActiveMenu(null); setFileToDelete(file); }}
                              className="w-full text-left px-4 py-2 hover:bg-surface-container-high text-error text-sm flex items-center gap-2"
                            >
                              <span className="material-symbols-outlined text-sm">delete</span> Delete
                            </button>
                          </div>
                        )}
                      </td>"""

new_table_actions = """                      <td className="py-3 px-6 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!file.isFolder && file.diskName && file.status === 'Safe' && (
                            <a 
                              href={`http://localhost:5000/api/download/${file.diskName}?token=${token}`} 
                              download
                              onClick={(e) => e.stopPropagation()}
                              className="p-1.5 text-on-surface-variant hover:text-secondary rounded hover:bg-surface-container-high transition-colors"
                              title="Download"
                            >
                              <span className="material-symbols-outlined text-[18px]">download</span>
                            </a>
                          )}
                          {!file.isFolder && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); handlePreview(file); }}
                              className="p-1.5 text-on-surface-variant hover:text-secondary rounded hover:bg-surface-container-high transition-colors"
                              title="Preview"
                            >
                              <span className="material-symbols-outlined text-[18px]">visibility</span>
                            </button>
                          )}
                          <button 
                            onClick={(e) => { e.stopPropagation(); setFileToDelete(file); }}
                            className="p-1.5 text-on-surface-variant hover:text-error rounded hover:bg-error/10 transition-colors"
                            title="Delete"
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                      </td>"""
content = content.replace(old_table_actions, new_table_actions)


# 6. UPDATE PREVIEW URLS
content = content.replace("`http://localhost:5000/api/view/${file.diskName}`", "`http://localhost:5000/api/view/${file.diskName}?token=${token}`")
content = content.replace("`http://localhost:5000/api/download/${previewFile.diskName}`", "`http://localhost:5000/api/download/${previewFile.diskName}?token=${token}`")
content = content.replace("`http://localhost:5000/api/view/${previewFile.diskName}`", "`http://localhost:5000/api/view/${previewFile.diskName}?token=${token}`")


with open(app_jsx_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated App.jsx successfully")
