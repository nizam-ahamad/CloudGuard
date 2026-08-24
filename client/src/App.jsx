import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

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
  const [searchQuery, setSearchQuery] = useState('');

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
      const res = await axios.get(`${API_BASE_URL}/api/storage-stats`);
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
        await axios.post(`${API_BASE_URL}/api/auth/register`, authForm);
        setAuthMode('login');
        setToastMessage({ type: 'success', message: 'Account created! Please sign in.' });
      } else {
        const res = await axios.post(`${API_BASE_URL}/api/auth/login`, { email: authForm.email, password: authForm.password });
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
        setViewMode('all');
        setCurrentDirectory('');
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

  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewText, setPreviewText] = useState("");
  const [sortOrder, setSortOrder] = useState('newest');
  const [activeMenu, setActiveMenu] = useState(null);
  const [fileToDelete, setFileToDelete] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStats, setUploadStats] = useState({ loaded: 0, total: 0 });
  const [toastMessage, setToastMessage] = useState(null);
  const [viewMode, setViewMode] = useState('all');
  const [currentDirectory, setCurrentDirectory] = useState('');
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    try {
      await axios.put(`${API_BASE_URL}/api/auth/password`, { currentPassword, newPassword });
      setToastMessage({ type: 'success', message: 'Password updated successfully.' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setToastMessage({ type: 'error', message: err.response?.data?.error || 'Failed to update password.' });
    }
  };

  const handleAccountDelete = async (e) => {
    e.preventDefault();
    if (deleteConfirmText !== 'DELETE') {
      setToastMessage({ type: 'error', message: 'Please type DELETE to confirm.' });
      return;
    }
    try {
      await axios.delete(`${API_BASE_URL}/api/auth/account`);
      handleLogout();
    } catch (err) {
      setToastMessage({ type: 'error', message: 'Failed to delete account.' });
    }
  };

  const fetchFiles = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/files?path=${encodeURIComponent(currentDirectory)}`);
      const sortedFiles = [...response.data];
      sortedFiles.sort((a, b) => {
        const timeA = a.mtimeMs || new Date(a.date).getTime();
        const timeB = b.mtimeMs || new Date(b.date).getTime();
        return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
      });
      setFiles(sortedFiles);
    } catch (error) {
      console.error('Error fetching files:', error);
    }
  };

  const toggleSort = () => {
    const newOrder = sortOrder === 'newest' ? 'oldest' : 'newest';
    setSortOrder(newOrder);

    const sortedFiles = [...files];
    sortedFiles.sort((a, b) => {
      const timeA = a.mtimeMs || new Date(a.date).getTime();
      const timeB = b.mtimeMs || new Date(b.date).getTime();
      return newOrder === 'newest' ? timeB - timeA : timeA - timeB;
    });
    setFiles(sortedFiles);
  };

  const confirmDelete = async () => {
    if (!fileToDelete) return;
    try {
      await axios.delete(`${API_BASE_URL}/api/files/${fileToDelete.diskName}`);
      await fetchFiles();
      await fetchStorageStats();
      setFileToDelete(null);
      setToastMessage({ type: 'success', message: 'File deleted successfully.' });
    } catch (error) {
      console.error('Error deleting file:', error);
      setToastMessage({ type: 'error', message: 'Error deleting file.' });
    }
  };

  useEffect(() => {
    if (token) fetchFiles();
  }, [currentDirectory, token]);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const handleFileUpload = async (filesToUpload) => {
    if (!filesToUpload || filesToUpload.length === 0) return;

    const totalUploadSize = Array.from(filesToUpload).reduce((sum, file) => sum + file.size, 0);
    const availableBytes = storageStats.totalLimitBytes - storageStats.usedBytes;
    
    if (totalUploadSize > availableBytes) {
      setToastMessage({ type: 'error', message: "Upload Failed: Insufficient storage space. This file exceeds your available account limit." });
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(0);
      setUploadStats({ loaded: 0, total: 0 });
      const formData = new FormData();
      for (const file of filesToUpload) {
        formData.append('files', file);
        formData.append('relativePaths', file.webkitRelativePath || file.customPath || '');
      }

      const response = await axios.post(`${API_BASE_URL}/api/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percentCompleted);
          setUploadStats({
            loaded: (progressEvent.loaded / (1024 * 1024)).toFixed(1),
            total: (progressEvent.total / (1024 * 1024)).toFixed(1)
          });
        }
      });
      
      if (response.data.status === 'safe') {
        await fetchFiles();
        await fetchStorageStats();
        setToastMessage({ type: 'success', message: 'Files uploaded safely.' });
      }
    } catch (error) {
      // Clear any potential pending success toasts
      setToastMessage(null);
      
      if (error.response && error.response.status === 400) {
        setToastMessage({ type: 'error', message: 'Security Alert: Malware detected! Files quarantined/deleted.' });
      } else if (!error.response) {
        setToastMessage({ type: 'error', message: 'Upload failed: File blocked locally or network error.' });
      } else {
        setToastMessage({ type: 'error', message: 'Error uploading files.' });
      }
      console.error(error);
    } finally {
      setUploading(false);
    }
  };

  const getFilesFromEntry = async (entry, path = '') => {
    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file(file => {
          file.customPath = path + file.name;
          resolve([file]);
        });
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      return new Promise((resolve) => {
        dirReader.readEntries(async (entries) => {
          let files = [];
          for (let i = 0; i < entries.length; i++) {
            const nestedFiles = await getFilesFromEntry(entries[i], path + entry.name + '/');
            files = files.concat(nestedFiles);
          }
          resolve(files);
        });
      });
    }
    return [];
  };

  const onDrop = async (e) => {
    e.preventDefault();
    let allFiles = [];
    if (e.dataTransfer.items) {
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            const files = await getFilesFromEntry(entry);
            allFiles = allFiles.concat(files);
          }
        }
      }
    } else if (e.dataTransfer.files) {
      allFiles = Array.from(e.dataTransfer.files);
    }

    if (allFiles.length > 15) {
      setToastMessage({ type: 'error', message: "Upload limit exceeded. Please select a maximum of 15 items per upload to ensure stability." });
      return;
    }
    
    if (allFiles.length > 0) {
      await handleFileUpload(allFiles);
    }
  };

  const onDragOver = (e) => {
    e.preventDefault();
  };

  const onFileInputChange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const allFiles = Array.from(e.target.files);
      if (allFiles.length > 15) {
        setToastMessage({ type: 'error', message: "Upload limit exceeded. Please select a maximum of 15 items per upload to ensure stability." });
        return;
      }
      await handleFileUpload(allFiles);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const getIconForType = (type) => {
    switch (type.toLowerCase()) {
      case 'pdf': return 'picture_as_pdf';
      case 'zip': return 'folder_zip';
      case 'pptx': return 'slideshow';
      case 'png': 
      case 'jpg':
      case 'jpeg': return 'image';
      case 'folder': return 'folder';
      case 'mp4':
      case 'webm':
      case 'ogg': return 'movie';
      default: return 'insert_drive_file';
    }
  };

  const handlePreview = async (file) => {
    if (file.isFolder) {
      setCurrentDirectory(file.diskName);
      return;
    }
    if (!file.diskName || file.status !== 'Safe') return;
    
    setPreviewFile(file);
    const type = file.type.toLowerCase();
    
    if (type === 'txt' || type === 'md') {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/view/${file.diskName}?token=${token}`);
        setPreviewText(typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2));
      } catch (err) {
        setPreviewText('Error loading file content.');
      }
    }
  };

  const closePreview = () => {
    setPreviewFile(null);
    setPreviewText("");
  };

  const searchFiltered = files.filter(file => file.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredFiles = viewMode === 'recent' ? searchFiltered.slice(0, 5) : searchFiltered;

  if (!token) {
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
    <div className="flex h-screen w-full">
      {/* SideNavBar */}
      <nav className="bg-surface-container-lowest dark:bg-surface-container-low h-screen w-64 fixed left-0 top-0 border-r border-outline-variant dark:border-outline flex flex-col py-stack-lg z-20 hidden md:flex">
        {/* Brand Header */}
        <div className="px-6 mb-8 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-secondary" data-weight="fill">security</span>
          </div>
          <div>
            <h1 className="font-headline-md text-headline-md font-bold text-primary dark:text-primary-fixed">CloudGuard</h1>
          </div>
        </div>
        {/* Main Navigation */}
        <div className="flex-1 px-4 space-y-1">
          <button 
            onClick={() => { setViewMode('all'); setCurrentDirectory(''); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-bold cursor-pointer active:opacity-80 transition-colors duration-200 border-l-4 ${viewMode === 'all' ? 'text-secondary border-secondary bg-surface-container-low' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high border-transparent'}`}
          >
            <span className="material-symbols-outlined" data-weight={viewMode === 'all' ? "fill" : ""}>folder_open</span>
            <span className="font-body-md text-body-md">My Files</span>
          </button>
          
          <button 
            onClick={() => { setViewMode('recent'); setCurrentDirectory(''); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-bold cursor-pointer active:opacity-80 transition-colors duration-200 border-l-4 ${viewMode === 'recent' ? 'text-secondary border-secondary bg-surface-container-low' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high border-transparent'}`}
          >
            <span className="material-symbols-outlined" data-weight={viewMode === 'recent' ? "fill" : ""}>history</span>
            <span className="font-body-md text-body-md">Recent</span>
          </button>
        </div>

        {/* Footer Navigation */}
        <div className="px-4 space-y-1 mt-auto border-t border-outline-variant pt-4 mx-4">
          <button 
            onClick={() => setViewMode('settings')}
            className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg font-bold cursor-pointer active:opacity-80 transition-colors duration-200 ${viewMode === 'settings' ? 'text-secondary bg-surface-container-low' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'}`}
          >
            <span className="material-symbols-outlined" data-weight={viewMode === 'settings' ? "fill" : ""}>settings</span>
            <span className="font-body-md text-body-md">Settings</span>
          </button>
        </div>
      </nav>

      {/* TopAppBar */}
      <header className="bg-surface-container-lowest dark:bg-surface-container-low fixed top-0 right-0 w-full md:w-[calc(100%-256px)] h-16 border-b border-outline-variant dark:border-outline flex justify-between items-center px-margin-mobile md:px-margin-desktop z-10">
        <div className="flex items-center gap-4">
          <button className="md:hidden p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors">
            <span className="material-symbols-outlined">menu</span>
          </button>
          <h1 className="font-headline-md text-headline-md font-bold text-primary dark:text-primary-fixed md:hidden">CloudGuard</h1>
        </div>
          <div className="hidden md:flex flex-1 max-w-md ml-4 mr-8">
            <div className="relative w-full focus-within:ring-2 focus-within:ring-secondary rounded-lg transition-all">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
              <input 
                value={searchQuery} 
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-surface text-on-surface border border-outline-variant rounded-lg pl-10 pr-4 py-2 font-body-md text-body-md outline-none" 
                placeholder="Search files, folders..." 
                type="text" 
              />
            </div>
          </div>
        <div className="flex items-center gap-2">
          <div className="relative ml-2">
            <div 
              onClick={(e) => { e.stopPropagation(); setShowProfileMenu(!showProfileMenu); }}
              className="w-10 h-10 rounded-full bg-secondary text-on-secondary flex items-center justify-center font-title-md cursor-pointer border-2 border-surface-container-lowest select-none"
            >
              {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
            </div>
            {showProfileMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-surface-container-lowest border border-outline-variant shadow-lg rounded-xl overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-outline-variant bg-surface-container-low cursor-default">
                  <p className="text-sm font-bold text-on-surface truncate">{user?.name || 'User'}</p>
                  <p className="text-xs text-on-surface-variant truncate">{user?.email || 'user@example.com'}</p>
                </div>
                <button 
                  onClick={() => { setViewMode('settings'); setShowProfileMenu(false); }}
                  className="w-full text-left px-4 py-3 text-on-surface hover:bg-surface-container-high text-sm flex items-center gap-2 transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">person</span> Profile Settings
                </button>
                <div className="w-full h-px bg-outline-variant"></div>
                <button 
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-3 text-error hover:bg-error/10 text-sm flex items-center gap-2 transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">logout</span> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Canvas */}
      <main 
        onClick={() => setShowProfileMenu(false)} 
        className="pt-24 pb-12 px-margin-mobile md:px-margin-desktop md:ml-64 max-w-container-max mx-auto w-full"
      >
        {viewMode === 'settings' ? (
          <div className="max-w-3xl mx-auto space-y-6">
            <h2 className="font-headline-md text-headline-md font-bold text-on-surface mb-8">Profile Settings</h2>
            
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
              <h3 className="font-title-md text-on-surface mb-4">Profile Details</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-on-surface-variant mb-1">Name</label>
                  <input type="text" value={user?.name || ''} readOnly className="w-full bg-surface-container-low text-on-surface-variant border border-outline-variant rounded-lg px-4 py-2 opacity-70 cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-on-surface-variant mb-1">Email</label>
                  <input type="text" value={user?.email || ''} readOnly className="w-full bg-surface-container-low text-on-surface-variant border border-outline-variant rounded-lg px-4 py-2 opacity-70 cursor-not-allowed" />
                </div>
              </div>
            </div>

            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
              <h3 className="font-title-md text-on-surface mb-4">Security</h3>
              <form onSubmit={handlePasswordUpdate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-on-surface-variant mb-1">Current Password</label>
                  <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required className="w-full bg-surface text-on-surface border border-outline-variant focus:ring-2 focus:ring-secondary rounded-lg px-4 py-2 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-on-surface-variant mb-1">New Password</label>
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required className="w-full bg-surface text-on-surface border border-outline-variant focus:ring-2 focus:ring-secondary rounded-lg px-4 py-2 outline-none" />
                </div>
                <button type="submit" className="px-6 py-2 bg-primary text-on-primary rounded-lg font-medium hover:bg-primary/90 transition-colors shadow-sm">Update Password</button>
              </form>
            </div>

            <div className="bg-error/10 border border-error/20 rounded-xl p-6">
              <h3 className="font-title-md text-error mb-2">Danger Zone</h3>
              <p className="text-sm text-on-surface-variant mb-4">Once you delete your account, there is no going back. Please be certain.</p>
              <form onSubmit={handleAccountDelete} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-on-surface-variant mb-1">To verify, type <strong>DELETE</strong> below:</label>
                  <input type="text" value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} className="w-full bg-surface text-on-surface border border-outline-variant focus:ring-2 focus:ring-error rounded-lg px-4 py-2 outline-none" />
                </div>
                <button type="submit" disabled={deleteConfirmText !== 'DELETE'} className={`px-6 py-2 rounded-lg font-medium transition-colors shadow-sm ${deleteConfirmText === 'DELETE' ? 'bg-error text-on-error hover:bg-[#b91c1c]' : 'bg-surface-dim text-on-surface-variant cursor-not-allowed'}`}>Delete Account</button>
              </form>
            </div>
          </div>
        ) : (
          <>
        {/* Page Title */}
        <div className="mb-stack-lg flex justify-between items-end">
          <div>
            <h2 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold text-on-surface mb-2">My Files</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">Manage and secure your enterprise data.</p>
          </div>
          <div className="hidden lg:flex items-center gap-4 bg-surface-container-lowest p-4 rounded-xl border border-outline-variant shadow-sm">
            <div className="relative w-12 h-12">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                <path className="text-surface-dim" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3"></path>
                <path className="text-secondary" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeDasharray={`${Math.min(storageStats.usedPercentage, 100)}, 100`} strokeWidth="3"></path>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center font-label-md text-[10px] font-bold text-on-surface">{Math.min(100, Math.round(storageStats.usedPercentage))}%</div>
            </div>
            <div>
              <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Storage Used</p>
              <p className="font-body-md text-body-md font-medium">{formatBytes(storageStats.usedBytes)} / {formatBytes(storageStats.totalLimitBytes, 0)}</p>
            </div>
          </div>
        </div>

        {/* Dropzone */}
        {viewMode === 'all' && (
          <section className="mb-stack-lg">
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={onFileInputChange} 
              style={{ display: 'none' }}
              multiple
            />
            <div 
              onDrop={onDrop} 
              onDragOver={onDragOver} 
              onClick={triggerFileInput}
              className="w-full border-2 border-dashed border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low transition-colors duration-200 rounded-xl p-12 flex flex-col items-center justify-center cursor-pointer group"
            >
              <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <span className="material-symbols-outlined text-secondary text-3xl">
                  {uploading ? 'sync' : 'cloud_upload'}
                </span>
              </div>
              <h3 className="font-title-lg text-title-lg text-on-surface mb-2">
                {uploading ? 'Uploading...' : 'Drag & drop files or folders here'}
              </h3>
              <p className="font-body-md text-body-md text-on-surface-variant text-center max-w-md mb-6">Securely upload documents, images, and archives. Maximum file size 5GB.</p>
              
              <button 
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                className="px-6 py-2.5 bg-primary text-on-primary rounded-lg font-label-lg hover:bg-primary/90 transition-colors"
              >
                Upload
              </button>
            </div>
          </section>
        )}

        {/* Upload Progress */}
        {uploading && (
          <div className="mb-stack-lg p-4 bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm">
            <div className="flex justify-between mb-2 font-label-md text-on-surface-variant">
              <span>Uploading... {uploadProgress}%</span>
              <span>{uploadStats.loaded} MB / {uploadStats.total} MB</span>
            </div>
            <div className="w-full bg-surface-container-high rounded-full h-2.5">
              <div className="bg-secondary h-2.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
            </div>
          </div>
        )}

        {/* Recent Files Table */}
        <section>
          <div className="flex items-center justify-between mb-stack-md">
            <h3 className="font-title-lg text-title-lg text-on-surface">
              {viewMode === 'recent' ? 'Recent Files' : 'All Files'}
            </h3>
            <div className="flex items-center gap-4">
              <button 
                onClick={toggleSort}
                className="text-on-surface-variant hover:text-secondary flex items-center gap-1 font-label-md"
              >
                <span className="material-symbols-outlined text-sm">sort</span>
                Sort: {sortOrder === 'newest' ? 'Newest First' : 'Oldest First'}
              </button>
            </div>
          </div>

          {currentDirectory && (
            <div className="flex items-center gap-2 mb-4 bg-surface-container-low px-4 py-2 rounded-lg">
              <button onClick={() => setCurrentDirectory('')} className="text-secondary hover:underline font-label-md flex items-center">
                <span className="material-symbols-outlined text-sm mr-1">home</span> Home
              </button>
              {currentDirectory.split('/').map((part, index, arr) => {
                if (!part) return null;
                const path = arr.slice(0, index + 1).join('/');
                return (
                  <React.Fragment key={path}>
                    <span className="text-on-surface-variant material-symbols-outlined text-sm">chevron_right</span>
                    <button onClick={() => setCurrentDirectory(path)} className="text-secondary hover:underline font-label-md">{part}</button>
                  </React.Fragment>
                );
              })}
            </div>
          )}

          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low text-on-surface-variant font-label-md text-label-md uppercase tracking-wider">
                    <th className="py-4 px-6 font-medium">File Name</th>
                    <th className="py-4 px-6 font-medium">Date Modified</th>
                    <th className="py-4 px-6 font-medium">Size</th>
                    <th className="py-4 px-6 font-medium">Security Status</th>
                    <th className="py-4 px-6 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="font-body-md text-body-md text-on-surface divide-y divide-outline-variant/50">
                  {filteredFiles.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="py-8 text-center text-on-surface-variant">
                        No files match your search.
                      </td>
                    </tr>
                  ) : 
                    filteredFiles.map(file => (
                    <tr 
                      key={file.id} 
                      onClick={() => file.isFolder ? setCurrentDirectory(file.diskName) : handlePreview(file)}
                      className={`hover:bg-surface-bright transition-colors group h-14 ${file.status === 'Quarantined' ? 'bg-[#fffbeb]' : ''} ${file.isFolder || (file.diskName && file.status === 'Safe') ? 'cursor-pointer' : ''}`}
                    >
                      <td className="py-3 px-6">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${file.status === 'Quarantined' ? 'bg-[#fef3c7] text-[#d97706]' : 'bg-surface-dim text-on-surface-variant'}`}>
                            <span className="material-symbols-outlined text-sm">{getIconForType(file.type)}</span>
                          </div>
                          <span className="font-medium truncate max-w-[250px]">{file.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-6 text-on-surface-variant">{file.date}</td>
                      <td className="py-3 px-6 text-on-surface-variant">{file.size}</td>
                      <td className="py-3 px-6">
                        {!file.isFolder && (
                          file.status === 'Safe' ? (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#dcfce7] text-[#166534] border border-[#bbf7d0]">
                              <span className="material-symbols-outlined text-[14px]">check_circle</span>
                              <span className="font-label-md text-[11px]">Safe</span>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#fef3c7] text-[#92400e] border border-[#fde68a]">
                              <span className="material-symbols-outlined text-[14px]">lowercase</span>
                              <span className="font-label-md text-[11px]">Quarantined</span>
                            </div>
                          )
                        )}
                      </td>
                      <td className="py-3 px-6 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!file.isFolder && file.diskName && file.status === 'Safe' && (
                            <a 
                              href={`${API_BASE_URL}/api/download/${file.diskName}?token=${token}`} 
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </section>
          </>
        )}
      </main>

      {/* Preview Modal */}
      {previewFile && (
        ['mp4', 'webm', 'ogg', 'mov', 'mkv'].includes(previewFile.type.toLowerCase()) ? (
          <div className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-md">
            <div className="flex items-center justify-between p-4 bg-transparent text-white w-full">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-white">movie</span>
                <h3 className="font-title-md text-title-md font-medium truncate">{previewFile.name}</h3>
              </div>
              <div className="flex items-center gap-2">
                <a href={`${API_BASE_URL}/api/download/${previewFile.diskName}?token=${token}`} download className="p-2 text-white/80 hover:bg-white/10 rounded-full transition-colors flex items-center">
                  <span className="material-symbols-outlined">download</span>
                </a>
                <button onClick={closePreview} className="p-2 text-white/80 hover:bg-white/10 rounded-full transition-colors">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden flex items-center justify-center p-4">
              <video 
                controls 
                autoPlay 
                controlsList="nodownload" 
                style={{ width: '100%', maxHeight: '100%' }} 
                src={`${API_BASE_URL}/api/view/${previewFile.diskName}?token=${token}`} 
              />
            </div>
          </div>
        ) : (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <div className="bg-surface-container-lowest rounded-xl shadow-lg w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-outline-variant bg-surface">
                <h3 className="font-title-lg text-on-surface truncate pr-4">{previewFile.name}</h3>
                <div className="flex items-center gap-2">
                  <a 
                    href={`${API_BASE_URL}/api/download/${previewFile.diskName}?token=${token}`} 
                    download
                    className="bg-secondary text-on-secondary hover:bg-secondary-container transition-colors p-2 rounded-lg flex items-center justify-center"
                    title="Download File"
                  >
                    <span className="material-symbols-outlined">download</span>
                  </a>
                  <button onClick={closePreview} className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors">
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto bg-surface-container p-4 flex items-center justify-center">
                {(previewFile.type.toLowerCase() === 'png' || previewFile.type.toLowerCase() === 'jpg' || previewFile.type.toLowerCase() === 'jpeg') ? (
                  <img src={`${API_BASE_URL}/api/view/${previewFile.diskName}?token=${token}`} alt={previewFile.name} className="max-w-full max-h-[70vh] object-contain shadow-sm" />
                ) : previewFile.type.toLowerCase() === 'pdf' ? (
                  <iframe src={`${API_BASE_URL}/api/view/${previewFile.diskName}?token=${token}`} className="w-full h-[70vh] border-0" title="PDF Preview" />
                ) : (previewFile.type.toLowerCase() === 'txt' || previewFile.type.toLowerCase() === 'md') ? (
                  <pre className="w-full h-full text-left bg-surface-container-lowest p-6 rounded-lg overflow-auto text-sm font-mono whitespace-pre-wrap shadow-inner border border-outline-variant">
                    {previewText || "Loading..."}
                  </pre>
                ) : (
                  <div className="text-on-surface-variant flex flex-col items-center gap-3">
                    <span className="material-symbols-outlined text-4xl">visibility_off</span>
                    <p>Preview not available for this file type.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      )}

      {/* Delete Confirmation Modal */}
      {fileToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-surface-container-lowest rounded-xl shadow-xl border border-outline-variant w-full max-w-md p-6 flex flex-col gap-4">
            <h3 className="font-title-lg text-on-surface">Confirm Delete</h3>
            <p className="font-body-md text-on-surface-variant">
              Are you sure you want to permanently delete <strong className="break-all text-on-surface">{fileToDelete.name}</strong>?
            </p>
            <div className="flex justify-end gap-3 mt-4">
              <button 
                onClick={() => setFileToDelete(null)}
                className="px-4 py-2 font-label-md text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={confirmDelete}
                className="px-4 py-2 font-label-md bg-error text-on-error hover:bg-[#b91c1c] rounded-lg transition-colors"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50">
          <div className="bg-surface-container-highest border border-outline-variant rounded-xl shadow-xl p-4 flex items-center gap-3 min-w-[300px]">
            {toastMessage.type === 'success' ? (
              <div className="w-8 h-8 rounded-full bg-[#dcfce7] flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[#166534] text-sm">check</span>
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#fef2f2] flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-error text-sm">warning</span>
              </div>
            )}
            <p className="font-body-md text-on-surface flex-1">{toastMessage.message}</p>
            <button 
              onClick={() => setToastMessage(null)}
              className="text-on-surface-variant hover:text-on-surface transition-colors p-1"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
