import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import ResetPassword from './ResetPassword';
import CloudGuardLogo from './CloudGuardLogo';
import PasswordInput from './PasswordInput';
import OTPVerification from './OTPVerification';
import Toast from './Toast';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';

const API_BASE_URL = import.meta.env.PROD ? import.meta.env.VITE_API_URL : (import.meta.env.VITE_API_URL || 'http://localhost:5000');

function App() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        setTimeout(() => setIsLoading(false), 300);
      });
    } else {
      setTimeout(() => setIsLoading(false), 300);
    }
  }, []);
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) return savedTheme;
    return 'dark';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const [token, setToken] = useState(() => localStorage.getItem('token') || sessionStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    const userStr = localStorage.getItem('user') || sessionStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  });
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '', remember: false });
  const [authError, setAuthError] = useState('');
  const [isUnverified, setIsUnverified] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [isForgotSuccess, setIsForgotSuccess] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [isForgotLoading, setIsForgotLoading] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);

  useEffect(() => {
    if (token && !localStorage.getItem('has_seen_vault_tour')) {
      setShowWelcomeModal(true);
    }
  }, [token]);

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setForgotError('');
    setIsForgotSuccess(false);
    setIsForgotLoading(true);
    try {
      const res = await axios.post(`${API_BASE_URL}/api/auth/forgot-password`, { 
        email: forgotEmail,
        frontendUrl: window.location.origin
      });
      setIsForgotSuccess(true);
    } catch (err) {
      setForgotError(err.response?.data?.error || 'Failed to send reset email');
    } finally {
      setIsForgotLoading(false);
    }
  };
  const [storageStats, setStorageStats] = useState({ usedBytes: 0, totalLimitBytes: 1, usedPercentage: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsCollapsed(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const closePreview = () => {
    setPreviewFile(null);
    setPreviewUrl("");
    setPreviewText("");
  };

  const formatBytes = (bytes, decimals = 1) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const formatSize = (bytes) => {
    if (bytes === '--') return '--';
    if (bytes === 0) return '0 B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const fetchStorageStats = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/storage-stats`);
      setStorageStats(res.data);
    } catch (err) {
      if (err.response && err.response.status === 401) {
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = '/';
        return;
      }
      console.error('Error fetching storage stats:', err);
    }
  }, []);


  const handleResendOtp = async () => {
    try {
      setAuthError('');
      await axios.post(`${API_BASE_URL}/api/auth/resend-otp`, { email: authForm.email });
      setAuthMode('verify');
      addToast('success', 'Verification code resent!');
      setIsUnverified(false);
    } catch (err) {
      addToast('error', 'Failed to resend code.');
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setIsUnverified(false);
    setIsAuthLoading(true);

    if (authMode === 'register') {
      const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
      if (!passwordRegex.test(authForm.password)) {
        setAuthError('Password must be at least 8 characters long and contain at least 1 letter and 1 number.');
        setIsAuthLoading(false);
        return;
      }
    }

    try {
      if (authMode === 'register') {
        await axios.post(`${API_BASE_URL}/api/auth/register`, authForm);
        setAuthMode('verify');
        addToast('success', 'Vault initialized. Welcome to your secure space.');
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
      if (err.response?.data?.unverified) {
        setIsUnverified(true);
      } else {
        setIsUnverified(false);
      }
      const extracted = err.response?.data?.error || err.response?.data?.message || err.message || 'An unexpected error occurred';
      setAuthError(typeof extracted === 'string' ? extracted : JSON.stringify(extracted));
    } finally {
      setIsAuthLoading(false);
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
  const [sortOrder, setSortOrder] = useState('newest');
  const [fileToDelete, setFileToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  
  const [uploadQueue, setUploadQueue] = useState([]);
  const [isUploadDrawerOpen, setIsUploadDrawerOpen] = useState(true);
  const isQueueProcessing = useRef(false);
  const [toasts, setToasts] = useState([]);
  const [viewMode, setViewMode] = useState('all');
  const [currentDirectory, setCurrentDirectory] = useState('');
  const fileInputRef = useRef(null);
  const prevUploadRef = useRef({ time: 0, loaded: 0 });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState(null);

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      addToast('error', 'Password must be at least 8 characters with 1 letter and 1 number.');
      return;
    }
    setIsUpdatingPassword(true);
    try {
      await axios.put(`${API_BASE_URL}/api/auth/password`, { currentPassword, newPassword });
      addToast('success', 'Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      const extracted = err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to update password.';
      addToast('error', typeof extracted === 'string' ? extracted : JSON.stringify(extracted));
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleAccountDelete = async (e) => {
    e.preventDefault();
    if (deleteConfirmText !== 'DELETE') {
      addToast('error', 'Please type DELETE to confirm.');
      return;
    }
    setIsDeleteModalOpen(true);
  };

  const fetchFiles = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/files?path=${encodeURIComponent(currentDirectory)}`);
      setFiles(response.data);
    } catch (error) {
      if (error.response && error.response.status === 401) {
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = '/';
        return;
      }
      console.error('Error fetching files:', error);
    }
  }, [currentDirectory]);

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      fetchStorageStats();
      fetchFiles();
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token, fetchStorageStats, fetchFiles]);

  const toggleSort = () => {
    const newOrder = sortOrder === 'newest' ? 'oldest' : 'newest';
    setSortOrder(newOrder);
  };

  const confirmDelete = async () => {
    if (!fileToDelete) return;
    setIsDeleting(true);
    try {
      const deleteId = fileToDelete._id || fileToDelete.diskName;
      const response = await axios.delete(`${API_BASE_URL}/api/files/${encodeURIComponent(deleteId)}`);
      if (response.status === 200) {
        setFiles(prev => prev.filter(f => f._id !== fileToDelete._id && f.diskName !== fileToDelete.diskName));
        setSelectedFiles(prev => prev.filter(id => id !== fileToDelete._id));
        await fetchStorageStats();
        setFileToDelete(null);
        addToast('success', 'File deleted successfully.');
      }
    } catch (error) {
      if (error.response && error.response.status === 401) {
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = '/';
        return;
      }
      console.error('Error deleting file:', error);
      addToast('error', 'Error deleting file.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedFiles.length === 0) return;
    setIsBulkDeleting(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/api/files/bulk-delete`, { fileIds: selectedFiles }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.status === 200) {
        addToast('success', 'Selected files deleted successfully.');
        setSelectedFiles([]);
        setShowBulkDeleteModal(false);
        await fetchFiles();
        await fetchStorageStats();
      }
    } catch (error) {
      if (error.response && error.response.status === 401) {
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = '/';
        return;
      }
      console.error('Error bulk deleting files:', error);
      addToast('error', 'Error deleting selected files.');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  useEffect(() => {
    if (token) fetchFiles();
  }, [currentDirectory, token, fetchFiles]);

  const addToast = (type, message) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, type, message }]);
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.status === 401) {
          localStorage.clear();
          sessionStorage.clear();
          window.location.href = '/';
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, []);

  const processQueue = async () => {
    if (isQueueProcessing.current) return;
    isQueueProcessing.current = true;

    while (true) {
      let nextItem = null;
      setUploadQueue(prev => {
        nextItem = prev.find(item => item.status === 'queued');
        return prev;
      });

      if (!nextItem) {
        await new Promise(resolve => setTimeout(resolve, 50));
        let retryItem = null;
        setUploadQueue(prev => {
          retryItem = prev.find(item => item.status === 'queued');
          return prev;
        });
        if (!retryItem) break;
        nextItem = retryItem;
      }

      const { id, file, name, size } = nextItem;
      const controller = new AbortController();

      setUploadQueue(prev => prev.map(item => item.id === id ? { ...item, status: 'uploading', abortController: controller } : item));

      let finalStatus = 'completed';
      let errorMsg = null;
      let securityThreat = false;
      let currentFileId = null;

      try {
        const s3Axios = axios.create();
        const presignRes = await axios.post(`${API_BASE_URL}/api/presign`, {
          filename: name,
          contentType: file.type || 'application/octet-stream'
        });
        const { signedUrl, fileKey, fileId } = presignRes.data;
        currentFileId = fileId;
        
        await s3Axios.put(signedUrl, file, {
          headers: { 
            'Content-Type': file.type || 'application/octet-stream',
            'Authorization': undefined
          },
          signal: controller.signal,
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / size);
            setUploadQueue(prev => prev.map(item => item.id === id ? { ...item, progress: percentCompleted } : item));
          }
        });

        setUploadQueue(prev => prev.map(item => item.id === id ? { ...item, status: 'analyzing' } : item));
        
        const uploadRes = await axios.post(`${API_BASE_URL}/api/upload`, {
          fileKey,
          originalName: name,
          fileSize: size,
          relativePaths: file.webkitRelativePath || file.customPath || ''
        });

        const { blockedFiles } = uploadRes.data;
        if (blockedFiles && blockedFiles.length > 0) {
          finalStatus = 'threat_detected';
          securityThreat = true;
        }
      } catch (err) {
        if (axios.isCancel(err) || err.name === 'CanceledError') {
          finalStatus = 'failed';
          errorMsg = 'Canceled';
          if (currentFileId) {
             try { await axios.delete(`${API_BASE_URL}/api/files/${currentFileId}`); } catch(e){}
          }
        } else {
          finalStatus = err.response?.status === 406 ? 'threat_detected' : 'failed';
          errorMsg = err.response?.data?.error || 'Upload failed';
        }
      }

      setUploadQueue(prev => {
        const currentItem = prev.find(i => i.id === id);
        if (currentItem && currentItem.status === 'failed' && currentItem.error === 'Canceled') {
           return prev; 
        }
        return prev.map(item => item.id === id ? { ...item, status: finalStatus, error: errorMsg, abortController: null } : item);
      });
      
      if (securityThreat) {
         addToast('error', `Security Alert: Blocked threat in ${name}`);
      } else if (finalStatus === 'completed') {
         addToast('success', `Uploaded: ${name}`);
      } else if (finalStatus === 'failed' && errorMsg !== 'Canceled') {
         addToast('error', errorMsg || `Upload failed for ${name}`);
      }

      await fetchFiles();
      await fetchStorageStats();
    }

    isQueueProcessing.current = false;
  };

  const handleFileUpload = async (filesToUpload) => {
    if (!filesToUpload || filesToUpload.length === 0) return;

    const totalUploadSize = Array.from(filesToUpload).reduce((sum, file) => sum + file.size, 0);
    const availableBytes = storageStats.totalLimitBytes - storageStats.usedBytes;
    
    if (totalUploadSize > availableBytes) {
      addToast('error', "Upload Failed: Insufficient storage space.");
      return;
    }

    const newItems = Array.from(filesToUpload).map(file => ({
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      file,
      name: file.name,
      size: file.size,
      progress: 0,
      status: 'queued',
      error: null,
      abortController: null
    }));

    setUploadQueue(prev => [...prev, ...newItems]);
    setIsUploadDrawerOpen(true);
    
    processQueue();
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
      addToast('error', "Upload limit exceeded. Please select a maximum of 15 items per upload to ensure stability.");
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
        addToast('error', "Upload limit exceeded. Please select a maximum of 15 items per upload to ensure stability.");
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
    
    try {
      setPreviewText('Loading...');
      const response = await fetch(`${API_BASE_URL}/api/files/${file._id}/access`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("Could not fetch secure access URL");
      const { url } = await response.json();
      setPreviewUrl(url);
      setPreviewFile(file);

      const type = file.type.toLowerCase();
      if (type === 'txt' || type === 'md') {
        const textResponse = await fetch(url);
        if (!textResponse.ok) throw new Error("Failed to fetch file content");
        const text = await textResponse.text();
        setPreviewText(text);
      }
    } catch (err) {
      addToast('error', "Preview failed: " + err.message);
      closePreview();
    }
  };

  const handleDownload = async (file) => {
    if (file.isFolder || !file.diskName || file.status !== 'Safe') return;
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/files/${file._id}/access?download=true`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("Could not fetch secure access URL");
      const { url } = await response.json();
      
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      addToast('error', "Download failed: " + err.message);
    }
  };

  const sortedFiles = [...files].sort((a, b) => {
    const timeA = a.mtimeMs || new Date(a.createdAt || a.uploadDate || 0).getTime();
    const timeB = b.mtimeMs || new Date(b.createdAt || b.uploadDate || 0).getTime();
    return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
  });

  const searchFiltered = sortedFiles.filter(file => file.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredFiles = viewMode === 'recent' ? searchFiltered.slice(0, 5) : searchFiltered;

  const SplashOverlay = () => isLoading ? (
    <div className="fixed inset-0 z-[9999] bg-white dark:bg-[#131314] flex items-center justify-center">
      <div className="animate-pulse">
        <CloudGuardLogo size={200} />
      </div>
    </div>
  ) : null;

  if (!token) {
    const authContent = (() => {
      if (window.location.pathname.startsWith('/reset-password/')) {
        const resetToken = window.location.pathname.split('/reset-password/')[1];
        return <ResetPassword token={resetToken} />;
      }

      if (authMode === 'verify') {
        return (
          <div className="min-h-screen bg-white dark:bg-[#131314] text-slate-900 dark:text-zinc-100 flex items-center justify-center p-4">
            <OTPVerification 
              email={authForm.email} 
              onVerifySuccess={(token, user) => {
                if (token && user) {
                  localStorage.setItem('token', token);
                  localStorage.setItem('user', JSON.stringify(user));
                  setToken(token);
                  setUser(user);
                } else {
                  setAuthMode('login');
                }
              }}
              onCancel={() => setAuthMode('login')}
            />
          </div>
        );
      }

      return (
        <div className="min-h-screen bg-white dark:bg-[#131314] text-slate-900 dark:text-zinc-100 flex items-center justify-center p-4">
        <SplashOverlay />
        <div className="bg-surface dark:bg-[#1e1f20] w-full max-w-md rounded-2xl shadow-xl border border-outline-variant dark:border-zinc-800 p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="mb-4">
              <CloudGuardLogo size={175} />
            </div>
            <h1 className="font-headline-md text-primary dark:text-[#e3e3e3] font-bold">CloudGuard</h1>
            <p className="text-on-surface-variant dark:text-[#c4c7c5] mt-2 font-body-md text-center">
              {authMode === 'login' ? 'Sign in to access your secure storage' : 'Create an account to get started'}
            </p>
          </div>

          {authError && (
            <div className="mb-6 p-3 bg-error/10 border border-error/20 rounded-lg text-error text-sm text-center flex flex-col items-center">
              <span>{authError}</span>
              {isUnverified && (
                <button
                  type="button"
                  onClick={handleResendOtp}
                  className="mt-2 text-secondary dark:text-blue-400 dark:hover:text-blue-300 hover:underline font-bold"
                >
                  Verify Now / Resend Code
                </button>
              )}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authMode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-on-surface dark:text-[#c4c7c5] mb-1">Full Name</label>
                <input 
                  type="text" 
                  required 
                  className="w-full px-4 py-2 bg-white dark:bg-[#1e1f20] dark:text-zinc-200 rounded-lg border-2 border-[#282a2c] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                  value={authForm.name}
                  onChange={e => setAuthForm({...authForm, name: e.target.value})}
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-on-surface dark:text-[#c4c7c5] mb-1">Email</label>
              <input 
                type="email" 
                required 
                className="w-full px-4 py-2 bg-white dark:bg-[#1e1f20] dark:text-zinc-200 rounded-lg border-2 border-[#282a2c] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                value={authForm.email}
                onChange={e => setAuthForm({...authForm, email: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-on-surface dark:text-[#c4c7c5] mb-1">Password</label>
              <PasswordInput 
                required 
                className="w-full px-4 py-2 bg-white dark:bg-[#1e1f20] dark:text-zinc-200 rounded-lg border-2 border-[#282a2c] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                value={authForm.password}
                onChange={e => setAuthForm({...authForm, password: e.target.value})}
              />
              {authMode === 'register' && (
                <p className="text-xs text-on-surface-variant dark:text-[#c4c7c5] mt-1">
                  Must be at least 8 characters with 1 letter and 1 number
                </p>
              )}
            </div>
            
            {authMode === 'login' && (
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center">
                  <input 
                    type="checkbox" 
                    id="remember" 
                    className="rounded border-outline-variant text-secondary focus:ring-secondary w-4 h-4"
                    checked={authForm.remember}
                    onChange={e => setAuthForm({...authForm, remember: e.target.checked})}
                  />
                  <label htmlFor="remember" className="ml-2 text-sm text-on-surface-variant dark:text-[#c4c7c5]">Remember me</label>
                </div>
                <button 
                  type="button" 
                  onClick={() => setShowForgotModal(true)}
                  className="text-sm text-secondary dark:text-blue-400 dark:hover:text-blue-300 hover:underline font-medium"
                >
                  Forgot password?
                </button>
              </div>
            )}

            <button 
              type="submit" 
              disabled={isAuthLoading}
              className={`w-full py-3 bg-primary dark:bg-zinc-800 text-on-primary dark:text-[#e3e3e3] rounded-lg font-medium hover:bg-primary/90 dark:hover:bg-zinc-700 transition-colors mt-6 shadow-sm ${isAuthLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isAuthLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin inline-block w-4 h-4 border-[2px] border-current border-t-transparent rounded-full" role="status" aria-label="loading"></span>
                  Processing...
                </span>
              ) : (
                authMode === 'login' ? 'Sign In' : 'Create Account'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button 
              type="button"
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'register' : 'login');
                setAuthError('');
                setIsUnverified(false);
              }}
              className="text-secondary dark:text-blue-400 dark:hover:text-blue-300 text-sm hover:underline font-medium"
            >
              {authMode === 'login' ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>

        {/* Forgot Password Modal */}
        {showForgotModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-surface dark:bg-[#1e1f20] dark:border dark:border-zinc-800 w-full max-w-sm rounded-xl shadow-xl p-6 relative">
              <button 
                onClick={() => {
                  setShowForgotModal(false);
                  setIsForgotSuccess(false);
                  setForgotError('');
                  setForgotEmail('');
                }}
                className="absolute top-4 right-4 text-on-surface-variant dark:text-[#c4c7c5] hover:text-on-surface dark:hover:text-[#e3e3e3]"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
              
              {isForgotSuccess ? (
                <div className="py-4 text-center">
                  <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="font-title-lg font-bold text-on-surface dark:text-[#e3e3e3] mb-2">Check your inbox</h3>
                  <p className="text-sm text-on-surface-variant dark:text-[#c4c7c5] mb-6">
                    We've sent a password reset link to <strong>{forgotEmail}</strong>.
                  </p>
                  <button 
                    onClick={() => {
                      setShowForgotModal(false);
                      setIsForgotSuccess(false);
                      setForgotEmail('');
                    }}
                    className="w-full py-2 bg-surface-container-high dark:bg-zinc-800 text-on-surface dark:text-[#e3e3e3] rounded-lg font-medium transition-colors hover:bg-surface-container-highest dark:hover:bg-zinc-700"
                  >
                    Back to Login
                  </button>
                </div>
              ) : (
                <div className="text-left">
                  <h3 className="font-title-lg text-on-surface dark:text-[#e3e3e3] mb-2">Reset Password</h3>
                  <p className="text-sm text-on-surface-variant dark:text-[#c4c7c5] mb-6">Enter your email and we'll send you a link to reset your password.</p>
                  
                  {forgotError && <div className="mb-4 p-2 bg-error/10 text-error text-sm rounded-lg">{forgotError}</div>}
                  
                  <form onSubmit={handleForgotSubmit}>
                    <label className="block text-sm font-medium text-on-surface dark:text-[#c4c7c5] mb-1">Email address</label>
                    <input 
                      type="email" 
                      required 
                      className="w-full px-4 py-2 bg-white dark:bg-[#131314] border border-outline-variant dark:border-zinc-700 dark:text-zinc-200 rounded-lg focus:ring-2 focus:ring-secondary outline-none transition-all mb-4"
                      value={forgotEmail}
                      onChange={e => setForgotEmail(e.target.value)}
                    />
                    <button 
                      type="submit" 
                      disabled={isForgotLoading}
                      className={`w-full py-2 bg-primary dark:bg-zinc-800 text-on-primary dark:text-[#e3e3e3] rounded-lg font-medium transition-colors ${isForgotLoading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-primary/90 dark:hover:bg-zinc-700'}`}
                    >
                      {isForgotLoading ? 'Sending...' : 'Send Reset Link'}
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      );
    })();

    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="/reset-password/:token" element={authContent} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  const dashboardContent = (
    <div className="flex min-h-screen w-full bg-white dark:bg-[#131314] text-slate-900 dark:text-zinc-100">
      <SplashOverlay />
      
      {/* Onboarding Welcome Modal */}
      {showWelcomeModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1e1f20] rounded-xl border border-outline-variant dark:border-zinc-800 w-full max-w-md p-6 relative shadow-xl">
            <h3 className="font-title-lg text-on-surface dark:text-[#e3e3e3] text-xl font-bold">Welcome to your vault</h3>
            <p className="font-body-md text-on-surface-variant dark:text-[#c4c7c5] mt-2">
              Your secure digital space is ready. Upload documents, run malware scans, and manage your files safely.
            </p>
            <div className="flex justify-end mt-4">
              <button 
                onClick={() => {
                  setShowWelcomeModal(false);
                  localStorage.setItem('has_seen_vault_tour', 'true');
                }}
                className="px-4 py-2 bg-primary dark:bg-zinc-800 text-on-primary dark:text-[#e3e3e3] hover:bg-primary/90 dark:hover:bg-zinc-700 rounded-lg transition-colors font-medium"
              >
                Get Started
              </button>
            </div>
          </div>
        </div>
      )}
      {/* SideNavBar */}
      <nav className={`bg-slate-50 dark:bg-[#1e1f20] h-screen ${isCollapsed ? 'w-20' : 'w-64'} fixed left-0 top-0 border-r border-slate-200 dark:border-zinc-800 flex flex-col py-stack-lg z-50 transform transition-all duration-300 ease-in-out overflow-x-hidden md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-16 mb-6 flex items-center gap-2 px-4">
          <div className="min-w-[3rem] flex justify-center items-center">
            <CloudGuardLogo className="h-13 w-auto flex-shrink-0" />
          </div>
          <div className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-40 opacity-100'}`}>
            <h1 className="font-headline-md text-2xl font-bold text-primary dark:text-[#e3e3e3]">CloudGuard</h1>
          </div>
        </div>
        {/* Main Navigation */}
        <div className="flex-1 px-4 space-y-1">
          <button 
            onClick={() => { setViewMode('all'); setCurrentDirectory(''); setIsSidebarOpen(false); }}
            className={`group relative w-full flex items-center h-12 rounded-full font-bold cursor-pointer active:opacity-80 transition-colors duration-200 ${viewMode === 'all' ? 'text-secondary bg-surface-container-low dark:bg-[#282a2c] dark:text-[#e3e3e3]' : 'text-on-surface-variant dark:text-[#c4c7c5] hover:text-on-surface hover:bg-surface-container-high dark:hover:bg-[#333538] dark:hover:text-[#e3e3e3]'}`}
          >
            <div className="min-w-[3rem] flex justify-center items-center">
              <span className="material-symbols-outlined shrink-0" data-weight={viewMode === 'all' ? "fill" : ""}>folder_open</span>
            </div>
            <span className={`font-body-md text-body-md overflow-hidden whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100'}`}>My Files</span>
            {isCollapsed && (
              <div className="absolute left-full ml-4 px-3 py-1 bg-[#1e1f20] border border-zinc-800 text-[#e3e3e3] rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                My Files
              </div>
            )}
          </button>
          
          <button 
            onClick={() => { setViewMode('recent'); setCurrentDirectory(''); setIsSidebarOpen(false); }}
            className={`group relative w-full flex items-center h-12 rounded-full font-bold cursor-pointer active:opacity-80 transition-colors duration-200 ${viewMode === 'recent' ? 'text-secondary bg-surface-container-low dark:bg-[#282a2c] dark:text-[#e3e3e3]' : 'text-on-surface-variant dark:text-[#c4c7c5] hover:text-on-surface hover:bg-surface-container-high dark:hover:bg-[#333538] dark:hover:text-[#e3e3e3]'}`}
          >
            <div className="min-w-[3rem] flex justify-center items-center">
              <span className="material-symbols-outlined shrink-0" data-weight={viewMode === 'recent' ? "fill" : ""}>history</span>
            </div>
            <span className={`font-body-md text-body-md overflow-hidden whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100'}`}>Recent</span>
            {isCollapsed && (
              <div className="absolute left-full ml-4 px-3 py-1 bg-[#1e1f20] border border-zinc-800 text-[#e3e3e3] rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                Recent
              </div>
            )}
          </button>
        </div>

        {/* Footer Navigation */}
        <div className="flex flex-col gap-2 mt-auto border-t border-outline-variant pt-4 mx-4">
          <button 
            onClick={() => { setViewMode('settings'); setIsSidebarOpen(false); }}
            className={`group relative w-full flex items-center h-12 rounded-full font-bold cursor-pointer active:opacity-80 transition-colors duration-200 ${viewMode === 'settings' ? 'bg-surface-container-low dark:bg-[#282a2c] dark:text-[#c4c7c5]' : 'text-on-surface-variant dark:text-[#c4c7c5] hover:text-on-surface hover:bg-surface-container-high dark:hover:bg-[#333538] dark:hover:text-[#e3e3e3]'}`}
          >
            <div className="min-w-[3rem] flex justify-center items-center">
              <span className="material-symbols-outlined shrink-0" data-weight={viewMode === 'settings' ? "fill" : ""}>settings</span>
            </div>
            <span className={`font-body-md text-body-md overflow-hidden whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100'}`}>Settings</span>
            {isCollapsed && (
              <div className="absolute left-full ml-4 px-3 py-1 bg-[#1e1f20] border border-zinc-800 text-[#e3e3e3] rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                Settings
              </div>
            )}
          </button>
          
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden md:flex group relative w-full items-center justify-center h-12 text-on-surface-variant dark:text-[#c4c7c5] hover:text-on-surface dark:hover:text-white hover:bg-surface-container-high dark:hover:bg-white/5 rounded-xl transition-colors"
          >
            <span className="material-symbols-outlined transition-transform duration-300" style={{ transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}>
              view_sidebar
            </span>
            <div className="absolute left-full ml-4 px-3 py-1 bg-[#1e1f20] border border-zinc-800 text-[#e3e3e3] rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
              Toggle Sidebar (Ctrl+B)
            </div>
          </button>
        </div>
      </nav>

      {/* TopAppBar */}
      <header className={`bg-slate-50 dark:bg-[#1e1f20] fixed top-0 right-0 w-full h-16 border-b border-slate-200 dark:border-zinc-800 flex justify-between items-center px-margin-mobile md:px-margin-desktop z-10 transition-all duration-300 ease-in-out ${isCollapsed ? 'md:w-[calc(100%-80px)]' : 'md:w-[calc(100%-256px)]'}`}>
        <div className="flex items-center gap-4">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="md:hidden p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors">
            <span className="material-symbols-outlined">menu</span>
          </button>
          <CloudGuardLogo className="h-10 w-auto md:hidden shrink-0" />
          <h1 className="font-headline-md text-headline-md font-bold text-primary dark:text-[#e3e3e3] md:hidden -ml-2">CloudGuard</h1>
        </div>
          <div className="hidden md:flex flex-1 max-w-md ml-4 mr-8">
            <div className="relative w-full focus-within:ring-2 focus-within:ring-secondary rounded-lg transition-all">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
              <input 
                value={searchQuery} 
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-surface dark:bg-zinc-800 text-on-surface dark:text-zinc-200 border border-outline-variant dark:border-zinc-700 rounded-lg pl-10 pr-4 py-2 font-body-md text-body-md outline-none" 
                placeholder="Search files, folders..." 
                type="text" 
              />
            </div>
          </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 text-on-surface-variant dark:text-zinc-100 hover:bg-surface-container-high dark:hover:bg-zinc-800/70 rounded-full transition-colors flex items-center justify-center"
            title="Toggle Theme"
          >
            <span className="material-symbols-outlined">
              {theme === 'dark' ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
          <div className="relative ml-2">
            <div 
              onClick={(e) => { e.stopPropagation(); setShowProfileMenu(!showProfileMenu); }}
              className="w-10 h-10 rounded-full bg-secondary text-on-secondary flex items-center justify-center font-title-md cursor-pointer border-2 border-surface-container-lowest select-none"
            >
              {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
            </div>
              <div className={`absolute right-0 mt-2 w-48 bg-surface-container-lowest dark:bg-[#1e1f20] border border-outline-variant dark:border-zinc-800 shadow-lg rounded-xl overflow-hidden z-50 transition-all duration-200 ease-out origin-top-right ${showProfileMenu ? 'opacity-100 scale-100 visible translate-y-0' : 'opacity-0 scale-95 invisible -translate-y-2 pointer-events-none'}`}>
                <div className="px-4 py-3 border-b border-outline-variant dark:border-zinc-800 bg-surface-container-low dark:bg-[#131314] cursor-default">
                  <p className="text-sm font-bold text-on-surface dark:text-[#e3e3e3] truncate">{user?.name || 'User'}</p>
                  <p className="text-xs text-on-surface-variant dark:text-[#c4c7c5] truncate">{user?.email || 'user@example.com'}</p>
                </div>
                <button 
                  onClick={() => { setViewMode('settings'); setShowProfileMenu(false); }}
                  className="w-full text-left px-4 py-3 text-on-surface dark:text-[#e3e3e3] hover:bg-surface-container-high dark:hover:bg-zinc-800/70 text-sm flex items-center gap-2 transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">person</span> Profile Settings
                </button>
                <div className="w-full h-px bg-outline-variant dark:bg-zinc-800"></div>
                <button 
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-3 text-error dark:text-red-400 hover:bg-error/10 dark:hover:bg-red-950/30 text-sm flex items-center gap-2 transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">logout</span> Sign out
                </button>
              </div>
          </div>
        </div>
      </header>

      {/* Main Content Canvas */}
      <main 
        onClick={() => { setShowProfileMenu(false); setIsSidebarOpen(false); setActiveMenuId(null); }} 
        className={`pt-24 pb-12 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto w-full min-h-screen bg-white dark:bg-[#131314] transition-all duration-300 ease-in-out ${isCollapsed ? 'md:ml-20' : 'md:ml-64'}`}
      >
        {viewMode === 'settings' ? (
          <div className="max-w-3xl mx-auto space-y-6">
            <h2 className="font-headline-md text-headline-md font-bold text-on-surface dark:text-[#e3e3e3] mb-8">Profile Settings</h2>
            
            <div className="border border-gray-200 dark:border-[#333] bg-gray-50 dark:bg-transparent px-6 py-4 shadow-sm dark:shadow-none">
              <h3 className="font-title-md text-on-surface dark:text-[#e3e3e3] mb-4">Profile Details</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-mono text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Name</label>
                  <input type="text" value={user?.name || ''} readOnly className="w-full h-12 bg-transparent border border-slate-300 dark:border-[#333] focus:border-black dark:focus:border-white outline-none text-black dark:text-white px-4 transition-colors opacity-70 cursor-not-allowed" />
                </div>
                <div>
                  <label className="text-xs font-mono text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Email</label>
                  <input type="text" value={user?.email || ''} readOnly className="w-full h-12 bg-transparent border border-slate-300 dark:border-[#333] focus:border-black dark:focus:border-white outline-none text-black dark:text-white px-4 transition-colors opacity-70 cursor-not-allowed" />
                </div>
              </div>
            </div>

            <div className="border border-gray-200 dark:border-[#333] bg-gray-50 dark:bg-transparent px-6 py-4 shadow-sm dark:shadow-none">
              <h3 className="font-title-md text-on-surface dark:text-[#e3e3e3] mb-4">Security</h3>
              <form onSubmit={handlePasswordUpdate} className="space-y-4">
                <div>
                  <label className="text-xs font-mono text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Current Password</label>
                  <PasswordInput value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required className="w-full h-12 bg-transparent border border-slate-300 dark:border-[#333] focus:border-black dark:focus:border-white outline-none text-black dark:text-white px-4 transition-colors" />
                </div>
                <div>
                  <label className="text-xs font-mono text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">New Password</label>
                  <PasswordInput value={newPassword} onChange={e => setNewPassword(e.target.value)} required className="w-full h-12 bg-transparent border border-slate-300 dark:border-[#333] focus:border-black dark:focus:border-white outline-none text-black dark:text-white px-4 transition-colors" />
                  <p className="text-xs font-mono text-slate-500 dark:text-[#777] mt-2">Must be at least 8 characters with 1 letter and 1 number</p>
                </div>
                <button type="submit" disabled={isUpdatingPassword} className={`px-6 py-2 bg-primary dark:bg-zinc-800 text-on-primary dark:text-[#e3e3e3] rounded-lg font-medium transition-colors shadow-sm ${isUpdatingPassword ? 'opacity-70 cursor-not-allowed' : 'hover:bg-primary/90 dark:hover:bg-zinc-700'}`}>
                  {isUpdatingPassword ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin inline-block w-4 h-4 border-[2px] border-current border-t-transparent rounded-full" role="status" aria-label="loading"></span>
                      Updating...
                    </span>
                  ) : (
                    'Update Password'
                  )}
                </button>
              </form>
            </div>

            <div className="border border-red-200 dark:border-red-500/50 bg-red-50/50 dark:bg-transparent px-6 py-4 dark:text-red-200 shadow-sm dark:shadow-none">
              <h3 className="font-title-md text-error dark:text-red-200 mb-2">Danger Zone</h3>
              <p className="text-sm text-on-surface-variant dark:text-red-200/80 mb-4">Once you delete your account, there is no going back. Please be certain.</p>
              <form onSubmit={handleAccountDelete} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-on-surface-variant dark:text-red-200 mb-1">To verify, type <strong>DELETE</strong> below:</label>
                  <input type="text" value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} className="w-full bg-surface dark:bg-[#1e1f20] text-on-surface dark:text-zinc-200 border border-outline-variant dark:border-zinc-700 focus:ring-2 focus:ring-error rounded-lg px-4 py-2 outline-none" />
                </div>
                <button type="submit" disabled={deleteConfirmText !== 'DELETE' || isDeletingAccount} className={`w-full h-12 border border-red-500 text-red-500 hover:bg-red-500 hover:text-white bg-transparent font-mono text-sm tracking-wider uppercase transition-colors ${deleteConfirmText !== 'DELETE' || isDeletingAccount ? 'opacity-50 cursor-not-allowed hover:bg-transparent hover:text-red-500' : ''}`}>
                  {isDeletingAccount ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin inline-block w-4 h-4 border-[2px] border-current border-t-transparent rounded-full" role="status" aria-label="loading"></span>
                      Deleting...
                    </span>
                  ) : (
                    'Delete Account'
                  )}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <>
        {/* Page Title */}
        <div className="mb-stack-lg flex flex-col md:flex-row md:justify-between md:items-end gap-4">
          <div>
            <h2 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold text-on-surface dark:text-[#e3e3e3] mb-2">My Files</h2>
            <p className="font-body-md text-body-md text-on-surface-variant dark:text-zinc-400">Manage and secure your digital vault.</p>
          </div>
          <div className="flex items-center gap-4 bg-white dark:bg-[#1e1f20] p-4 rounded-xl border border-outline-variant dark:border-zinc-800/50 shadow-sm w-fit dark:text-zinc-300">
            <div className="relative w-12 h-12">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                <path className="text-surface-dim" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3"></path>
                <path className="text-secondary" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeDasharray={`${Math.min(storageStats.usedPercentage, 100)}, 100`} strokeWidth="3"></path>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center font-label-md text-[10px] font-bold text-on-surface dark:text-[#c4c7c5]">{Math.min(100, Math.round(storageStats.usedPercentage))}%</div>
            </div>
            <div>
              <p className="font-label-md text-label-md text-on-surface-variant dark:text-[#c4c7c5] uppercase tracking-wider">Storage Used</p>
              <p className="font-body-md text-body-md font-medium dark:text-[#e3e3e3]">{formatBytes(storageStats.usedBytes)} / {formatBytes(storageStats.totalLimitBytes, 0)}</p>
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
              className="w-full border-2 border-dashed border-outline-variant dark:border-zinc-800/50 bg-white dark:bg-[#1e1f20] dark:text-zinc-300 hover:bg-surface-container-low transition-colors duration-200 rounded-xl p-12 flex flex-col items-center justify-center cursor-pointer group"
            >
              <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <span className="material-symbols-outlined text-secondary text-3xl">
                  {uploading ? 'sync' : 'cloud_upload'}
                </span>
              </div>
              <h3 className="font-title-lg text-title-lg text-on-surface dark:text-zinc-200 mb-2">
                {uploading ? 'Uploading...' : 'Drag & drop files or folders here'}
              </h3>
              <p className="font-body-md text-body-md text-on-surface-variant dark:text-zinc-400 text-center max-w-md mb-6">Securely upload documents, images, and archives. Maximum file size 5GB.</p>
              
              <button 
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                className="px-6 py-2.5 bg-primary text-on-primary rounded-lg font-label-lg hover:bg-primary/90 transition-colors"
              >
                Upload
              </button>
            </div>
          </section>
        )}



        {/* Recent Files Table */}
        <section>
          <div className="flex items-center justify-between mb-stack-md">
            <div className="flex items-center gap-3">
              <div className="flex md:hidden items-center">
                <input 
                  type="checkbox" 
                  className="cursor-pointer w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary focus:ring-offset-surface"
                  checked={filteredFiles.length > 0 && selectedFiles.length === filteredFiles.filter(f => !f.isFolder).length}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedFiles(filteredFiles.filter(f => !f.isFolder).map(f => f._id));
                    } else {
                      setSelectedFiles([]);
                    }
                  }}
                />
              </div>
              <h3 className="font-title-lg text-title-lg text-on-surface dark:text-[#e3e3e3]">
                {viewMode === 'recent' ? 'Recent Files' : 'All Files'}
              </h3>
            </div>
            <div className="flex items-center gap-4">
              <button 
                onClick={toggleSort}
                className="text-on-surface-variant dark:text-zinc-300 hover:text-secondary flex items-center gap-1 font-label-md"
              >
                <span className="material-symbols-outlined text-sm">sort</span>
                Sort: {sortOrder === 'newest' ? 'Newest First' : 'Oldest First'}
              </button>
              {selectedFiles.length > 0 && (
                <button 
                  onClick={() => setShowBulkDeleteModal(true)}
                  disabled={isBulkDeleting}
                  className={`text-error hover:text-[#b91c1c] flex items-center gap-1 font-label-md ml-4 cursor-pointer ${isBulkDeleting ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  {isBulkDeleting ? (
                    <span className="animate-spin inline-block w-4 h-4 border-[2px] border-current border-t-transparent rounded-full" role="status" aria-label="loading"></span>
                  ) : (
                    <span className="material-symbols-outlined text-sm">delete</span>
                  )}
                  Delete Selected ({selectedFiles.length})
                </button>
              )}
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

          <div className="bg-white dark:bg-[#1e1f20] rounded-xl border border-outline-variant dark:border-zinc-800/50 shadow-sm overflow-hidden dark:text-zinc-300">
            <div className="md:overflow-x-auto custom-scrollbar w-full">
              <table className="w-full text-left md:border-collapse block md:table md:min-w-[800px]">
                <thead className="hidden md:table-header-group">
                  <tr className="border-b border-outline-variant dark:border-zinc-800/50 bg-surface-container-low dark:bg-[#1e1f20] text-on-surface-variant dark:text-zinc-300 font-label-md text-label-md uppercase tracking-wider">
                    <th className="py-4 px-6 font-medium w-12 text-center">
                      <input 
                        type="checkbox" 
                        className="cursor-pointer w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary focus:ring-offset-surface"
                        checked={filteredFiles.length > 0 && selectedFiles.length === filteredFiles.filter(f => !f.isFolder).length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedFiles(filteredFiles.filter(f => !f.isFolder).map(f => f._id));
                          } else {
                            setSelectedFiles([]);
                          }
                        }}
                      />
                    </th>
                    <th className="py-4 px-6 font-medium">File Name</th>
                    <th className="py-4 px-6 font-medium">Date Modified</th>
                    <th className="py-4 px-6 font-medium">Size</th>
                    <th className="py-4 px-6 font-medium">Security Status</th>
                    <th className="py-4 px-6 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="block md:table-row-group font-body-md text-body-md text-on-surface dark:text-zinc-300 divide-y divide-outline-variant/50 dark:divide-zinc-800/50">
                  {filteredFiles.length === 0 ? (
                    <tr className="block md:table-row">
                      <td colSpan="6" className="py-8 text-center text-on-surface-variant block md:table-cell">
                        {files.length === 0 ? "No files have been uploaded yet." : "No files match your search."}
                      </td>
                    </tr>
                  ) : 
                    filteredFiles.map(file => (
                    <tr 
                      key={file._id || file.id} 
                      onClick={() => file.isFolder ? setCurrentDirectory(file.diskName) : handlePreview(file)}
                      className={`flex flex-wrap md:table-row items-center py-3 px-4 md:p-0 hover:bg-surface-bright dark:hover:bg-zinc-800/70 dark:text-zinc-300 transition-colors group md:h-14 ${file.isFolder || (file.diskName && file.status === 'Safe') ? 'cursor-pointer' : ''}`}
                    >
                      <td className="pr-3 md:pr-0 md:py-3 md:px-6 w-auto md:w-12 block md:table-cell md:text-center" onClick={(e) => e.stopPropagation()}>
                        {!file.isFolder && (
                          <input 
                            type="checkbox" 
                            className="cursor-pointer w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary focus:ring-offset-surface"
                            checked={selectedFiles.includes(file._id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedFiles(prev => [...prev, file._id]);
                              } else {
                                setSelectedFiles(prev => prev.filter(id => id !== file._id));
                              }
                            }}
                          />
                        )}
                      </td>
                      <td className="flex-1 min-w-0 block md:table-cell md:py-3 md:px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded flex items-center justify-center shrink-0 bg-surface-dim text-on-surface-variant">
                            <span className="material-symbols-outlined text-sm">{getIconForType(file.type)}</span>
                          </div>
                          <div className="flex flex-col min-w-0 w-full">
                            <span className="font-medium line-clamp-2 break-all md:block md:truncate max-w-full md:max-w-[250px]">{file.name}</span>
                            <div className="md:hidden flex flex-col text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                              <span>{file.date}</span>
                              <span>{formatSize(file.size)}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="hidden md:table-cell py-3 px-6 text-on-surface-variant dark:text-[#c4c7c5]">{file.date}</td>
                      <td className="hidden md:table-cell py-3 px-6 text-on-surface-variant dark:text-[#c4c7c5]">{formatSize(file.size)}</td>
                      <td className="block md:table-cell ml-auto md:ml-0 md:py-3 md:px-6">
                        {!file.isFolder && (
                          file.status === 'Safe' ? (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#dcfce7] text-[#166534] border border-[#bbf7d0]">
                              <span className="material-symbols-outlined text-[14px]">check_circle</span>
                              <span className="font-label-md text-[11px]">Safe</span>
                            </div>
                          ) : file.status === 'Malicious' || file.status === 'malware' ? (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-error/10 text-error border border-error/20">
                              <span className="material-symbols-outlined text-[14px]">warning</span>
                              <span className="font-label-md text-[11px]">Malicious</span>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface-variant border border-outline-variant">
                              <span className="material-symbols-outlined text-[14px]">hourglass_empty</span>
                              <span className="font-label-md text-[11px]">{file.status || 'Pending'}</span>
                            </div>
                          )
                        )}
                      </td>
                      <td className="block md:table-cell ml-2 md:ml-0 md:py-3 md:px-6 md:text-right relative">
                        {/* Desktop Actions */}
                        <div className="hidden md:flex items-center justify-end gap-1">
                          {!file.isFolder && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); handlePreview(file); }}
                              className="p-1.5 text-on-surface-variant dark:text-[#c4c7c5] hover:text-secondary dark:hover:text-[#e3e3e3] rounded hover:bg-surface-container-high transition-colors"
                              title="Preview"
                            >
                              <span className="material-symbols-outlined text-[18px]">visibility</span>
                            </button>
                          )}
                          {!file.isFolder && file.diskName && file.status === 'Safe' && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleDownload(file); }}
                              className="p-1.5 text-on-surface-variant dark:text-[#c4c7c5] hover:text-secondary dark:hover:text-[#e3e3e3] rounded hover:bg-surface-container-high transition-colors"
                              title="Download"
                            >
                              <span className="material-symbols-outlined text-[18px]">download</span>
                            </button>
                          )}
                          <button 
                            onClick={(e) => { e.stopPropagation(); setFileToDelete(file); }}
                            className="p-1.5 text-on-surface-variant dark:text-[#c4c7c5] hover:text-error dark:hover:text-red-400 rounded hover:bg-error/10 transition-colors"
                            title="Delete"
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>

                        {/* Mobile Actions Menu */}
                        <div className="flex md:hidden relative justify-end">
                          <button
                            onClick={(e) => { e.stopPropagation(); setActiveMenuId(activeMenuId === (file._id || file.id) ? null : (file._id || file.id)); }}
                            className="p-1 text-on-surface-variant dark:text-[#c4c7c5] hover:text-secondary dark:hover:text-[#e3e3e3] rounded hover:bg-surface-container-high transition-colors"
                          >
                            <span className="material-symbols-outlined text-[20px]">more_vert</span>
                          </button>
                          
                          <div className={`absolute right-0 top-full mt-2 w-36 bg-white dark:bg-[#1e1f20] rounded-xl shadow-xl border border-outline-variant dark:border-zinc-800 z-[60] overflow-hidden flex flex-col py-1 transition-all duration-200 ease-out origin-top-right ${activeMenuId === (file._id || file.id) ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'}`}>
                            {!file.isFolder && (
                              <button onClick={(e) => { e.stopPropagation(); handlePreview(file); setActiveMenuId(null); }} className="w-full text-left px-4 py-2.5 text-sm text-on-surface dark:text-[#e3e3e3] hover:bg-surface-container-high dark:hover:bg-zinc-800/70 transition-colors flex items-center gap-3">
                                <span className="material-symbols-outlined text-[18px]">visibility</span> Preview
                              </button>
                            )}
                            {!file.isFolder && file.diskName && file.status === 'Safe' && (
                              <button onClick={(e) => { e.stopPropagation(); handleDownload(file); setActiveMenuId(null); }} className="w-full text-left px-4 py-2.5 text-sm text-on-surface dark:text-[#e3e3e3] hover:bg-surface-container-high dark:hover:bg-zinc-800/70 transition-colors flex items-center gap-3">
                                <span className="material-symbols-outlined text-[18px]">download</span> Download
                              </button>
                            )}
                            <button onClick={(e) => { e.stopPropagation(); setFileToDelete(file); setActiveMenuId(null); }} className="w-full text-left px-4 py-2.5 text-sm text-error dark:text-red-400 hover:bg-error/10 dark:hover:bg-red-950/30 transition-colors flex items-center gap-3">
                              <span className="material-symbols-outlined text-[18px]">delete</span> Delete
                            </button>
                          </div>
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
                <button onClick={() => handleDownload(previewFile)} className="p-2 text-white/80 hover:bg-white/10 rounded-full transition-colors flex items-center">
                  <span className="material-symbols-outlined">download</span>
                </button>
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
                src={previewUrl} 
              />
            </div>
          </div>
        ) : (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <div className="bg-white rounded-xl shadow-lg w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-outline-variant bg-surface">
                <h3 className="font-title-lg text-on-surface truncate pr-4">{previewFile.name}</h3>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleDownload(previewFile)}
                    className="bg-secondary text-on-secondary hover:bg-secondary-container transition-colors p-2 rounded-lg flex items-center justify-center"
                    title="Download File"
                  >
                    <span className="material-symbols-outlined">download</span>
                  </button>
                  <button onClick={closePreview} className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors">
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto bg-surface-container p-4 flex items-center justify-center">
                {(previewFile.type.toLowerCase() === 'png' || previewFile.type.toLowerCase() === 'jpg' || previewFile.type.toLowerCase() === 'jpeg') ? (
                  <img src={previewUrl} alt={previewFile.name} className="max-w-full max-h-[70vh] object-contain shadow-sm" />
                ) : previewFile.type.toLowerCase() === 'pdf' ? (
                  <iframe src={previewUrl} className="w-full h-[70vh] border-0" title="PDF Preview" />
                ) : (previewFile.type.toLowerCase() === 'txt' || previewFile.type.toLowerCase() === 'md') ? (
                  <pre className="w-full h-full text-left bg-white p-6 rounded-lg overflow-auto text-sm font-mono whitespace-pre-wrap shadow-inner border border-outline-variant">
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
      {(fileToDelete || showBulkDeleteModal) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-[#1e1f20] rounded-xl shadow-xl border border-outline-variant dark:border-zinc-800 w-full max-w-md p-6 flex flex-col gap-4">
            <h3 className="font-title-lg text-on-surface dark:text-[#e3e3e3]">Confirm Delete</h3>
            <p className="font-body-md text-on-surface-variant dark:text-[#c4c7c5]">
              {showBulkDeleteModal ? (
                <>Are you sure you want to permanently delete the <strong className="break-all text-on-surface dark:text-[#e3e3e3]">{selectedFiles.length}</strong> selected files?</>
              ) : (
                <>Are you sure you want to permanently delete <strong className="break-all text-on-surface dark:text-[#e3e3e3]">{fileToDelete?.name}</strong>?</>
              )}
            </p>
            <div className="flex justify-end gap-3 mt-4">
              <button 
                onClick={() => { setFileToDelete(null); setShowBulkDeleteModal(false); }}
                className="px-4 py-2 font-label-md text-on-surface-variant dark:text-[#c4c7c5] hover:bg-surface-container-high dark:hover:bg-zinc-800/70 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={showBulkDeleteModal ? handleBulkDelete : confirmDelete}
                disabled={isDeleting || isBulkDeleting}
                className={`px-4 py-2 font-label-md bg-error dark:bg-red-900 text-on-error dark:text-red-100 rounded-lg transition-colors ${(isDeleting || isBulkDeleting) ? 'opacity-70 cursor-not-allowed' : 'hover:bg-[#b91c1c] dark:hover:bg-red-800'}`}
              >
                {(isDeleting || isBulkDeleting) ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin inline-block w-4 h-4 border-[2px] border-current border-t-transparent rounded-full" role="status" aria-label="loading"></span>
                    Deleting...
                  </span>
                ) : (
                  'Yes, Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Queue Drawer */}
      {uploadQueue.length > 0 && (
        <div className={`fixed bottom-4 right-4 z-[70] w-80 md:w-96 bg-white dark:bg-[#1e1f20] rounded-t-xl rounded-b-lg shadow-2xl border border-outline-variant dark:border-zinc-800 transition-all duration-300 flex flex-col ${isUploadDrawerOpen ? 'max-h-[60vh] h-[400px]' : 'h-12'}`}>
          <div 
            className="flex items-center justify-between px-4 py-3 bg-surface-container-high dark:bg-[#2d2e30] rounded-t-xl cursor-pointer"
            onClick={() => setIsUploadDrawerOpen(!isUploadDrawerOpen)}
          >
            <span className="font-title-sm font-medium text-on-surface dark:text-[#e3e3e3]">
              Uploading {uploadQueue.filter(i => i.status === 'uploading' || i.status === 'queued' || i.status === 'analyzing').length} of {uploadQueue.length} items
            </span>
            <div className="flex items-center gap-1">
              <span className="material-symbols-outlined text-on-surface-variant dark:text-zinc-400">
                {isUploadDrawerOpen ? 'expand_more' : 'expand_less'}
              </span>
            </div>
          </div>
          
          {isUploadDrawerOpen && (
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2 custom-scrollbar">
              {uploadQueue.map(item => (
                <div key={item.id} className="flex flex-col p-3 rounded-lg hover:bg-surface-container-low dark:hover:bg-zinc-800/50 transition-colors border border-transparent dark:border-zinc-800/30">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-label-md truncate pr-2 text-on-surface dark:text-[#e3e3e3]" title={item.name}>{item.name}</span>
                    <div className="flex items-center shrink-0 gap-2">
                      {(item.status === 'uploading' || item.status === 'queued' || item.status === 'analyzing') && (
                        <button 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            if (item.abortController) item.abortController.abort();
                            setUploadQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'failed', error: 'Canceled' } : i));
                          }}
                          className="p-1 text-on-surface-variant hover:text-error dark:text-zinc-400 dark:hover:text-red-400 rounded-full hover:bg-error/10 transition-colors"
                          title="Cancel"
                        >
                          <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-on-surface-variant dark:text-zinc-400 mb-1.5">
                    <span>{(item.size / (1024 * 1024)).toFixed(1)} MB</span>
                    <span className={
                      item.status === 'completed' ? 'text-primary dark:text-green-400 font-medium' :
                      item.status === 'threat_detected' || item.status === 'failed' ? 'text-error dark:text-red-400 font-medium' : ''
                    }>
                      {item.status === 'queued' && 'Waiting in queue...'}
                      {item.status === 'uploading' && `${item.progress}%`}
                      {item.status === 'analyzing' && 'Scanning with AI...'}
                      {item.status === 'completed' && 'Done'}
                      {item.status === 'threat_detected' && 'Malware Blocked'}
                      {item.status === 'failed' && (item.error || 'Failed')}
                    </span>
                  </div>
                  {item.status === 'uploading' && (
                    <div className="w-full bg-surface-container-high dark:bg-[#131314] rounded-full h-1.5 mt-1">
                      <div className="bg-primary relative overflow-hidden h-1.5 rounded-full transition-all duration-200" style={{ width: `${item.progress}%` }}></div>
                    </div>
                  )}
                  {item.status === 'analyzing' && (
                    <div className="w-full bg-surface-container-high dark:bg-[#131314] rounded-full h-1.5 mt-1 overflow-hidden">
                      <div className="bg-secondary h-full rounded-full animate-pulse w-full"></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Toast Notification */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div key={toast.id} className="pointer-events-auto">
            <Toast 
              id={toast.id} 
              type={toast.type} 
              message={toast.message} 
              onRemove={removeToast} 
            />
          </div>
        ))}
      </div>

      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-xl dark:bg-[#1a1a1a] border border-transparent dark:border-[#333]">
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Confirm Delete</h3>
            <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
              Are you sure you want to permanently delete your CloudGuard account? All files will be lost.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsDeleteModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 transition-colors rounded-md dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setIsDeleteModalOpen(false);
                  setIsDeletingAccount(true);
                  try {
                    await axios.delete(`${API_BASE_URL}/api/auth/account`);
                    localStorage.clear();
                    sessionStorage.clear();
                    window.location.href = '/login';
                  } catch {
                    addToast('error', 'Failed to delete account.');
                  } finally {
                    setIsDeletingAccount(false);
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white transition-colors bg-red-600 rounded-md hover:bg-red-700"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={dashboardContent} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;
