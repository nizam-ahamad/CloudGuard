import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useSearchParams, useLocation, useNavigate, NavLink } from 'react-router-dom';
import axios from 'axios';
import ResetPassword from './ResetPassword';
import CloudGuardLogo from './CloudGuardLogo';
import PasswordInput from './PasswordInput';
import OTPVerification from './OTPVerification';
import { useToast } from './context/ToastContext';
import MoveModal from './components/MoveModal';
import FolderDetailsModal from './components/FolderDetailsModal';
import DeleteConfirmModal from './components/DeleteConfirmModal';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import PhotosView, { invalidatePhotosCache } from './pages/PhotosView';
import { 
  downloadSingleFileWithProgress, 
  downloadBatchZipWithProgress 
} from './utils/downloadHelper';
import { HeaderDownloadButton, useDownload } from './context/DownloadContext';
import { Folder, FolderInput, X, MoreVertical, Pencil, Info, LayoutGrid, List, Check, Trash2, Image, Play, ChevronLeft, ChevronRight, Download, Clock, UploadCloud, FolderPlus, Menu, Sun, Moon, Loader2 } from 'lucide-react';

import { API_BASE_URL } from "./config";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error) { return { hasError: true }; }
  componentDidCatch(error, errorInfo) { console.error("ErrorBoundary caught an error", error, errorInfo); }
  render() {
    if (this.state.hasError) return <tr className="block md:table-row"><td colSpan="6" className="py-4 text-center text-red-500">Error rendering file item.</td></tr>;
    return this.props.children; 
  }
}

function App() {
  const toast = useToast();
  const { triggerDownload, startDownload } = useDownload();
  const location = useLocation();
  const navigate = useNavigate();
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
  const [isAccountDeleteModalOpen, setIsAccountDeleteModalOpen] = useState(false);

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
    invalidatePhotosCache();
  };

  const [files, setFiles] = useState([]);
  const [sortOrder, setSortOrder] = useState('newest');
  const [fileToDelete, setFileToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedFolderIds, setSelectedFolderIds] = useState([]);
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const totalSelectedCount = selectedFolderIds.length + selectedFileIds.length;
  const isSelectionActive = totalSelectedCount > 0;
  const selectedFiles = selectedFileIds;
  const setSelectedFiles = setSelectedFileIds;
  const selectedFolders = selectedFolderIds;
  const setSelectedFolders = setSelectedFolderIds;
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ percent: 0, text: '' });
  const abortDownloadRef = useRef(null);
  const [itemsToMove, setItemsToMove] = useState([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  
  const [uploadQueue, setUploadQueue] = useState([]);
  const [isUploadDrawerOpen, setIsUploadDrawerOpen] = useState(true);
  const isQueueProcessing = useRef(false);
  const isUploading = uploadQueue.some(item => ['uploading', 'queued', 'analyzing'].includes(item.status));
  const [viewMode, setViewMode] = useState('all');
  const [currentDirectory, setCurrentDirectory] = useState('');
  const fileInputRef = useRef(null);
  const prevUploadRef = useRef({ time: 0, loaded: 0 });
  const abortControllerRef = useRef(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState(null);
  const [activeFolderMenuId, setActiveFolderMenuId] = useState(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const folderParam = searchParams.get('folder');
  const [currentFolderId, setCurrentFolderId] = useState(folderParam || null);
  const [breadcrumbs, setBreadcrumbs] = useState([{ id: null, name: 'Home' }]);
  const [folders, setFolders] = useState([]);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [fileToMove, setFileToMove] = useState(null);
  const [moveFolders, setMoveFolders] = useState([]);
  const [isMoveLoading, setIsMoveLoading] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState(null);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [showRenameFolderModal, setShowRenameFolderModal] = useState(false);
  const [folderToRename, setFolderToRename] = useState(null);
  const [newRenameFolderName, setNewRenameFolderName] = useState('');
  const [folderView, setFolderView] = useState(() => {
    return localStorage.getItem('cloudguard_folder_view') || 'grid';
  });

  const handleSetFolderView = (view) => {
    setFolderView(view);
    localStorage.setItem('cloudguard_folder_view', view);
  };
  const [showRenameFileModal, setShowRenameFileModal] = useState(false);
  const [fileToRename, setFileToRename] = useState(null);
  const [newRenameFileName, setNewRenameFileName] = useState('');
  const [showFolderDetailsModal, setShowFolderDetailsModal] = useState(false);
  const [folderToView, setFolderToView] = useState(null);

  const handleRenameFileSubmit = async (e) => {
    e.preventDefault();
    if (!fileToRename || !newRenameFileName.trim()) return;
    try {
      await axios.patch(`${API_BASE_URL}/api/files/${fileToRename._id || fileToRename.id}/rename`, { newName: newRenameFileName }, { headers: { Authorization: `Bearer ${token}` } });
      setShowRenameFileModal(false);
      setFileToRename(null);
      setNewRenameFileName('');
      addToast('success', 'File renamed successfully');
      fetchFiles();
    } catch (err) {
      addToast('error', 'Failed to rename file');
    }
  };

  const handleRenameFolderSubmit = async (e) => {
    e.preventDefault();
    if (!folderToRename || !newRenameFolderName.trim()) return;
    try {
      await axios.patch(`${API_BASE_URL}/api/folders/${folderToRename._id}/rename`, { newName: newRenameFolderName }, { headers: { Authorization: `Bearer ${token}` } });
      setShowRenameFolderModal(false);
      setFolderToRename(null);
      setNewRenameFolderName('');
      addToast('success', 'Folder renamed successfully');
      fetchFolders(currentFolderId);
    } catch (err) {
      addToast('error', 'Failed to rename folder');
    }
  };

  const confirmFolderDelete = async () => {
    if (!folderToDelete) return;
    setIsDeletingFolder(true);
    try {
      await axios.delete(`${API_BASE_URL}/api/folders/${folderToDelete._id}`, { headers: { Authorization: `Bearer ${token}` } });
      setFolderToDelete(null);
      addToast('success', 'Folder deleted successfully');
      fetchFolders(currentFolderId);
      fetchFiles();
      fetchStorageStats();
    } catch (err) {
      addToast('error', 'Failed to delete folder');
    } finally {
      setIsDeletingFolder(false);
    }
  };

  const toggleFolderSelect = (folderId, e) => {
    e?.stopPropagation();
    const idStr = String(folderId);
    setSelectedFolderIds(prev => 
      prev.includes(idStr) ? prev.filter(id => id !== idStr) : [...prev, idStr]
    );
  };

  const toggleFileSelect = (fileId, e) => {
    e?.stopPropagation();
    const idStr = String(fileId);
    setSelectedFileIds(prev => 
      prev.includes(idStr) ? prev.filter(id => id !== idStr) : [...prev, idStr]
    );
  };

  const handleClearSelection = () => {
    setSelectedFolderIds([]);
    setSelectedFileIds([]);
  };
  const clearSelection = handleClearSelection;

  const handleSelectAllFiles = (e) => {
    e?.stopPropagation();
    const visibleFiles = filteredFiles.filter(f => !f.isFolder);
    if (visibleFiles.length > 0 && selectedFileIds.length === visibleFiles.length) {
      // If all files are currently selected, deselect all files
      setSelectedFileIds([]);
    } else {
      // Select all files ONLY (do NOT touch selectedFolderIds)
      setSelectedFileIds(visibleFiles.map(f => String(f._id || f.id)));
    }
  };

  const openMoveModal = async (items) => {
    const itemsArray = Array.isArray(items) ? items : [items];
    setItemsToMove(itemsArray);
    setFileToMove(itemsArray.length === 1 ? itemsArray[0] : itemsArray);
    setShowMoveModal(true);
    try {
      const res = await axios.get(`${API_BASE_URL}/api/folders?all=true`, { headers: { Authorization: `Bearer ${token}` } });
      setMoveFolders(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to fetch folders for move', err);
      setMoveFolders([]);
    }
  };

  const handleBatchMove = () => {
    const selectedFoldersList = folders
      .filter(f => selectedFolderIds.includes(String(f._id)))
      .map(f => ({ ...f, isFolder: true }));
    const selectedFilesList = files
      .filter(f => selectedFileIds.includes(String(f._id)));
    const allSelected = [...selectedFoldersList, ...selectedFilesList];
    if (allSelected.length === 0) return;
    openMoveModal(allSelected);
  };

  const handleOpenMoveModal = handleBatchMove;
  const handleBatchDelete = () => setShowBulkDeleteModal(true);

  const handleCancelDownload = (e) => {
    e?.stopPropagation();
    if (abortDownloadRef.current) {
      abortDownloadRef.current();
      abortDownloadRef.current = null;
    }
    setIsDownloading(false);
    setDownloadProgress({ percent: 0, text: '' });
    toast.info('Download cancelled');
  };

  const handleBatchDownload = async () => {
    const itemsToDownload = files.filter(f => selectedFileIds.includes(String(f._id || f.id)));
    if (!itemsToDownload || itemsToDownload.length === 0) return;

    try {
      setIsDownloading(true);

      if (itemsToDownload.length === 1) {
        const file = itemsToDownload[0];
        const isLarge = (file.size || 0) >= 1 * 1024 * 1024 * 1024;

        const result = await startDownload(file);

        if (isLarge || result?.mode === 'stream') {
          toast.info(`Download started in browser: ${file.name}`);
        } else {
          toast.success(`Downloaded: ${file.name}`);
        }
      } else {
        const result = await startDownload(itemsToDownload);

        if (result?.mode === 'stream') {
          toast.info(`${itemsToDownload.length} downloads started in browser`);
        } else {
          toast.success(`Downloaded ${itemsToDownload.length} files as ZIP`);
        }
      }

      setSelectedFiles([]);
      setSelectedFolderIds([]);
    } catch (err) {
      if (err.message !== 'DOWNLOAD_CANCELLED') {
        console.error('Download failed:', err);
        toast.error('Download failed. Check your network connection.');
      }
    } finally {
      setIsDownloading(false);
    }
  };

  const handleMoveConfirm = async (targetFolderId) => {
    try {
      setIsMoveLoading(true);
      const items = itemsToMove.length > 0 ? itemsToMove : (Array.isArray(fileToMove) ? fileToMove : [fileToMove]);
      
      const folderIdsToMove = [];
      const fileIdsToMove = [];

      items.forEach(item => {
        if (!item) return;
        if (typeof item === 'string') {
          const isF = folders.some(f => String(f._id) === item);
          if (isF) folderIdsToMove.push(item);
          else fileIdsToMove.push(item);
        } else if (item.isFolder || item.parentId !== undefined) {
          folderIdsToMove.push(String(item._id || item.id));
        } else {
          fileIdsToMove.push(String(item._id || item.id));
        }
      });

      if (folderIdsToMove.length > 0 || fileIdsToMove.length > 1) {
        await axios.put(`${API_BASE_URL}/api/folders/move-batch`, {
          folderIds: folderIdsToMove,
          fileIds: fileIdsToMove,
          targetFolderId
        }, { headers: { Authorization: `Bearer ${token}` } });
      } else if (fileIdsToMove.length === 1) {
        await axios.patch(`${API_BASE_URL}/api/files/${fileIdsToMove[0]}/move`, { targetFolderId }, { headers: { Authorization: `Bearer ${token}` } });
      }

      setShowMoveModal(false);
      setItemsToMove([]);
      setFileToMove(null);
      clearSelection();
      addToast('success', 'Item(s) moved successfully');
      await fetchFiles();
      await fetchFolders(currentFolderId);
    } catch (err) {
      addToast('error', err.response?.data?.message || err.response?.data?.error || 'Failed to move item(s)');
    } finally {
      setIsMoveLoading(false);
    }
  };

  const fetchFolders = useCallback(async () => {
    try {
      const parentId = searchParams.get('folder') || null;
      const url = parentId 
        ? `${API_BASE_URL}/api/folders?parentId=${parentId}` 
        : `${API_BASE_URL}/api/folders`;
      const response = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      setFolders(response.data);
    } catch (error) {
      console.error('Error fetching folders:', error);
    }
  }, [token, searchParams]);

  const handleCreateFolder = async (e) => {
    if (e) e.preventDefault();
    const trimmedName = (newFolderName || '').trim();
    
    if (!trimmedName || isCreatingFolder) return;

    try {
      setIsCreatingFolder(true);

      const response = await axios.post(`${API_BASE_URL}/api/folders`, {
        name: trimmedName,
        parentId: currentFolderId || null
      }, { headers: { Authorization: `Bearer ${token}` } });

      if (response.status === 201) {
        setShowNewFolderModal(false);
        setNewFolderName('');
        toast.success(`Folder "${trimmedName}" created`);
        fetchFolders(currentFolderId);
      }
    } catch (err) {
      console.error('Folder creation error:', err);

      // Handle 409 Duplicate Name Conflict specifically
      if (err.response?.status === 409) {
        toast.error(
          err.response?.data?.error || `A folder named "${trimmedName}" already exists here.`
        );
      } else {
        toast.error(err.response?.data?.error || 'Failed to create folder. Please try again.');
      }
    } finally {
      setIsCreatingFolder(false);
    }
  };

  useEffect(() => {
    const urlFolderId = searchParams.get('folder') || null;
    if (urlFolderId !== currentFolderId) {
      setCurrentFolderId(urlFolderId);
    }

    if (urlFolderId) {
      axios.get(`${API_BASE_URL}/api/folders/${urlFolderId}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => {
          const folderData = res.data;
          setBreadcrumbs(prev => {
            const existingIndex = prev.findIndex(b => b.id === folderData._id);
            if (existingIndex >= 0) {
              return prev.slice(0, existingIndex + 1);
            }
            if (prev.length > 0 && prev[prev.length - 1].id === folderData.parentId) {
              return [...prev, { id: folderData._id, name: folderData.name }];
            }
            return [{ id: null, name: 'Home' }, { id: folderData._id, name: folderData.name }];
          });
        })
        .catch(err => console.error('Failed to fetch breadcrumb folder', err));
    } else {
      setBreadcrumbs([{ id: null, name: 'Home' }]);
    }
  }, [searchParams, token]);

  const handleFolderClick = (folder) => {
    clearSelection();
    setCurrentFolderId(folder._id);
    setSearchParams({ folder: folder._id });
  };

  const handleBreadcrumbClick = (folderId, index) => {
    clearSelection();
    setCurrentFolderId(folderId);
    setSearchParams(folderId ? { folder: folderId } : {});
    setBreadcrumbs(prev => prev.slice(0, index + 1));
  };
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
    setIsAccountDeleteModalOpen(true);
  };

  const fetchFiles = useCallback(async () => {
    try {
      let url = `${API_BASE_URL}/api/files?`;
      const params = new URLSearchParams();
      if (searchQuery) {
        params.append('search', searchQuery);
      } else {
        if (viewMode === 'recent') {
          params.append('recent', 'true');
        } else {
          const folderId = searchParams.get('folder');
          if (folderId) {
            params.append('folderId', folderId);
          }
        }
      }
      url += params.toString();
      
      const response = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
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
  }, [searchParams, viewMode, token, searchQuery]);

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      fetchStorageStats();
      fetchFiles();
      fetchFolders();
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token, fetchStorageStats, fetchFiles, fetchFolders, searchParams, viewMode, searchQuery]);

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
        invalidatePhotosCache();
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
    if (selectedFileIds.length === 0 && selectedFolderIds.length === 0) return;
    setIsBulkDeleting(true);
    try {
      if (selectedFileIds.length > 0) {
        await axios.post(`${API_BASE_URL}/api/files/bulk-delete`, { fileIds: selectedFileIds }, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      if (selectedFolderIds.length > 0) {
        await Promise.all(
          selectedFolderIds.map(fId =>
            axios.delete(`${API_BASE_URL}/api/folders/${fId}`, {
              headers: { Authorization: `Bearer ${token}` }
            })
          )
        );
      }
      addToast('success', 'Selected item(s) deleted successfully.');
      invalidatePhotosCache();
      clearSelection();
      setShowBulkDeleteModal(false);
      await fetchFiles();
      await fetchFolders(currentFolderId);
      await fetchStorageStats();
    } catch (error) {
      if (error.response && error.response.status === 401) {
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = '/';
        return;
      }
      console.error('Error bulk deleting:', error);
      addToast('error', error.response?.data?.error || 'Error deleting selected item(s).');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  useEffect(() => {
    if (token) fetchFiles();
  }, [currentDirectory, token, fetchFiles]);

  const addToast = (type, message) => {
    toast.show(message, type);
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

  useEffect(() => {
    const processNext = async () => {
      const isProcessing = uploadQueue.some(f => f.status === 'uploading' || f.status === 'analyzing');
      if (isProcessing) return;

      const nextItem = uploadQueue.find(f => f.status === 'queued');
      if (!nextItem) return;

      const { id, file, name, size } = nextItem;
      abortControllerRef.current = new AbortController();

      setUploadQueue(prev => prev.map(item => item.id === id ? { ...item, status: 'uploading' } : item));
      prevUploadRef.current = { time: Date.now(), loaded: 0, speed: 0 };

      let finalStatus = 'completed';
      let errorMsg = null;
      let securityThreat = false;
      let currentFileId = null;

      try {
        const s3Axios = axios.create();
        const presignRes = await axios.post(`${API_BASE_URL}/api/presign`, {
          filename: name,
          contentType: file.type || 'application/octet-stream',
          folderId: currentFolderId
        });
        const { signedUrl, fileKey, fileId } = presignRes.data;
        currentFileId = fileId;
        
        await s3Axios.put(signedUrl, file, {
          headers: { 
            'Content-Type': file.type || 'application/octet-stream',
            'x-amz-server-side-encryption': 'AES256',
            'Authorization': undefined
          },
          signal: abortControllerRef.current.signal,
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / size);
            
            const now = Date.now();
            const timeElapsed = now - prevUploadRef.current.time;
            if (timeElapsed >= 500) {
              const bytesLoadedSinceLast = progressEvent.loaded - prevUploadRef.current.loaded;
              const speedBps = (bytesLoadedSinceLast / timeElapsed) * 1000;
              prevUploadRef.current = { time: now, loaded: progressEvent.loaded, speed: speedBps };
            }

            setUploadQueue(prev => prev.map(item => item.id === id ? { 
              ...item, 
              progress: percentCompleted, 
              loadedBytes: progressEvent.loaded, 
              speed: prevUploadRef.current.speed 
            } : item));
          }
        });

        setUploadQueue(prev => prev.map(item => item.id === id ? { ...item, status: 'analyzing' } : item));
        
        const uploadRes = await axios.post(`${API_BASE_URL}/api/upload`, {
          fileKey,
          originalName: name,
          fileSize: size,
          folderId: currentFolderId,
          relativePaths: file.webkitRelativePath || file.customPath || ''
        }, {
          signal: abortControllerRef.current.signal,
          timeout: 0
        });

        const { blockedFiles, error, uploadedFiles } = uploadRes.data;
        if ((blockedFiles && blockedFiles.length > 0) || error === 'File blocked: Malicious content detected') {
          finalStatus = 'threat_detected';
          securityThreat = true;
        } else if (Array.isArray(uploadedFiles) && uploadedFiles.length > 0) {
          setFiles(prevFiles => {
            const safePrevFiles = Array.isArray(prevFiles) ? prevFiles : [];
            const newFiles = uploadedFiles.filter(uf => uf && !safePrevFiles.some(pf => pf?._id === uf?._id));
            return [...newFiles, ...safePrevFiles];
          });
          invalidatePhotosCache();
          uploadedFiles.forEach(newFile => {
            window.dispatchEvent(
              new CustomEvent('cloudguard:media-uploaded', {
                detail: newFile
              })
            );
          });
        }
      } catch (err) {
        if (axios.isCancel(err) || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
          finalStatus = 'failed';
          errorMsg = 'Canceled';
          if (currentFileId) {
             try { await axios.delete(`${API_BASE_URL}/api/files/${currentFileId}`); } catch(e){}
          }
        } else if (err.response?.data?.error === 'File blocked: Malicious content detected') {
          finalStatus = 'threat_detected';
          securityThreat = true;
          errorMsg = 'Malware blocked';
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
        return prev.map(item => item.id === id ? { ...item, status: finalStatus, error: errorMsg } : item);
      });
      
      if (securityThreat) {
         addToast('error', `Security Alert: Malware detected! ${name}`);
      } else if (finalStatus === 'completed') {
         addToast('success', `Uploaded: ${name}`);
         invalidatePhotosCache();
      } else if (finalStatus === 'failed' && errorMsg !== 'Canceled') {
         addToast('error', errorMsg || `Upload failed for ${name}`);
      }

      try {
        await fetchFiles();
        await fetchStorageStats();
      } catch (err) {
        console.error("Failed to fetch updates:", err);
      }
    };

    processNext();
  }, [uploadQueue, fetchFiles, fetchStorageStats]);

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
      loadedBytes: 0,
      speed: 0,
      status: 'queued',
      error: null
    }));

    setUploadQueue(prev => [...prev, ...newItems]);
    setIsUploadDrawerOpen(true);
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
    if (!type || typeof type !== 'string') return 'insert_drive_file';
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
    if (!file.diskName || (file.status !== 'Safe' && file.status !== 'unscanned_too_large')) return;
    
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
    if (file.isFolder || !file.diskName || (file.status !== 'Safe' && file.status !== 'unscanned_too_large')) return;
    try {
      const isLarge = (file.size || 0) >= 1 * 1024 * 1024 * 1024;
      const res = await triggerDownload(file);
      if (isLarge || res?.mode === 'stream') {
        toast.info(`Download started in browser: ${file.name}`);
      } else {
        toast.success(`Downloaded: ${file.name}`);
      }
    } catch (err) {
      if (err.message !== 'DOWNLOAD_CANCELLED') {
        toast.error('Download failed. Check your network connection.');
      }
    }
  };

  const sortedFiles = [...files].sort((a, b) => {
    const timeA = a.mtimeMs || new Date(a.createdAt || a.uploadDate || 0).getTime();
    const timeB = b.mtimeMs || new Date(b.createdAt || b.uploadDate || 0).getTime();
    return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
  });

  const searchFiltered = sortedFiles.filter(file => file.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredFiles = viewMode === 'recent' ? searchFiltered.slice(0, 5) : searchFiltered;
  const selectableFiles = filteredFiles.filter(f => !f.isFolder);
  const isAllFilesSelected = selectableFiles.length > 0 && selectedFileIds.length === selectableFiles.length;
  const isSomeFilesSelected = selectedFileIds.length > 0 && selectedFileIds.length < selectableFiles.length;

  // Calculate total counts across folders + files
  const currentFolders = viewMode === 'recent' ? [] : folders;
  const currentFiles = selectableFiles;
  const totalViewItems = (currentFolders?.length || 0) + (currentFiles?.length || 0);
  const totalSelected = (selectedFolders?.length || 0) + (selectedFiles?.length || 0);
  const isAllSelected = totalViewItems > 0 && totalSelected === totalViewItems;

  // 1. Clear Selection Handler (Fixes broken ✕ button)
  const handleClearAllSelection = () => {
    if (typeof setSelectedFiles === 'function') setSelectedFiles([]);
    if (typeof setSelectedFolders === 'function') setSelectedFolders([]);
    setSelectedFileIds([]);
    setSelectedFolderIds([]);
  };

  // 2. Unified Select All / Deselect All
  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      handleClearAllSelection();
    } else {
      // Select all folders and all files in the current directory
      if (typeof setSelectedFolders === 'function') {
        setSelectedFolders(currentFolders.map((f) => (f._id ? String(f._id) : String(f))));
      }
      if (typeof setSelectedFiles === 'function') {
        setSelectedFiles(currentFiles.map((f) => (f._id ? String(f._id) : String(f))));
      }
    }
  };
  const setIsMoveModalOpen = (val) => {
    if (val) handleOpenMoveModal();
    else setShowMoveModal(false);
  };
  const setIsDeleteModalOpen = (val) => {
    if (val) handleBatchDelete();
    else setShowBulkDeleteModal(false);
  };

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
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />
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
            onClick={() => { setViewMode('all'); setCurrentDirectory(''); setIsSidebarOpen(false); if (location.pathname !== '/dashboard') navigate('/dashboard'); }}
            className={`group relative w-full flex items-center h-12 rounded-full font-bold cursor-pointer active:opacity-80 transition-colors duration-200 ${viewMode === 'all' && location.pathname !== '/dashboard/photos' ? 'text-secondary bg-surface-container-low dark:bg-[#282a2c] dark:text-[#e3e3e3]' : 'text-on-surface-variant dark:text-[#c4c7c5] hover:text-on-surface hover:bg-surface-container-high dark:hover:bg-[#333538] dark:hover:text-[#e3e3e3]'}`}
          >
            <div className="min-w-[3rem] flex justify-center items-center">
              <span className="material-symbols-outlined shrink-0" data-weight={viewMode === 'all' && location.pathname !== '/dashboard/photos' ? "fill" : ""}>folder_open</span>
            </div>
            <span className={`font-semibold font-body-md text-body-md overflow-hidden whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100'}`}>My Files</span>
            {isCollapsed && (
              <div className="absolute left-full ml-4 px-3 py-1 bg-[#1e1f20] border border-zinc-800 text-[#e3e3e3] rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                My Files
              </div>
            )}
          </button>

          <NavLink 
            to="/dashboard/photos"
            onClick={() => { setIsSidebarOpen(false); }}
            className={({ isActive }) =>
              `group relative w-full flex items-center h-12 rounded-full font-bold cursor-pointer active:opacity-80 transition-colors duration-200 text-center ${
                isActive || location.pathname === '/dashboard/photos'
                  ? 'text-secondary bg-surface-container-low dark:bg-[#282a2c] dark:text-[#e3e3e3]'
                  : 'text-on-surface-variant dark:text-[#c4c7c5] hover:text-on-surface hover:bg-surface-container-high dark:hover:bg-[#333538] dark:hover:text-[#e3e3e3]'
              }`
            }
          >
            <div className="min-w-[3rem] flex justify-center items-center">
              <span className="material-symbols-outlined shrink-0" data-weight={location.pathname === '/dashboard/photos' ? "fill" : ""}>photo_library</span>
            </div>
            <span className={`text-center font-semibold font-body-md text-body-md overflow-hidden whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100'}`}>Photos</span>
            {isCollapsed && (
              <div className="absolute left-full ml-4 px-3 py-1 bg-[#1e1f20] border border-zinc-800 text-[#e3e3e3] rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                Photos
              </div>
            )}
          </NavLink>
          
          <button 
            onClick={() => { setViewMode('recent'); setCurrentDirectory(''); setIsSidebarOpen(false); if (location.pathname !== '/dashboard') navigate('/dashboard'); }}
            className={`group relative w-full flex items-center h-12 rounded-full font-bold cursor-pointer active:opacity-80 transition-colors duration-200 ${viewMode === 'recent' && location.pathname !== '/dashboard/photos' ? 'text-secondary bg-surface-container-low dark:bg-[#282a2c] dark:text-[#e3e3e3]' : 'text-on-surface-variant dark:text-[#c4c7c5] hover:text-on-surface hover:bg-surface-container-high dark:hover:bg-[#333538] dark:hover:text-[#e3e3e3]'}`}
          >
            <div className="min-w-[3rem] flex justify-center items-center">
              <span className="material-symbols-outlined shrink-0" data-weight={viewMode === 'recent' && location.pathname !== '/dashboard/photos' ? "fill" : ""}>history</span>
            </div>
            <span className={`font-semibold font-body-md text-body-md overflow-hidden whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100'}`}>Recent</span>
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
            <span className={`font-semibold font-body-md text-body-md overflow-hidden whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100'}`}>Settings</span>
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
      <header className={`bg-white/95 dark:bg-neutral-950/95 backdrop-blur-md fixed top-0 right-0 w-full h-16 border-b border-neutral-200/80 dark:border-neutral-800/80 flex justify-between items-center px-3 sm:px-6 z-30 transition-all duration-300 ease-in-out select-none ${isCollapsed ? 'md:w-[calc(100%-80px)]' : 'md:w-[calc(100%-256px)]'}`}>
        
        {/* 1. Left: Hamburger & Brand Title */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="md:hidden p-1.5 -ml-1 sm:ml-0 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
            aria-label="Toggle navigation menu"
          >
            <Menu className="w-5 h-5"/>
          </button>

          <div className="flex items-center gap-2.5 cursor-pointer select-none shrink-0 md:hidden">
            <CloudGuardLogo className="w-14 h-14 sm:w-14 sm:h-14 shrink-0 transition-transform active:scale-95"/>
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-neutral-900 dark:text-white">
              CloudGuard
            </span>
          </div>
        </div>

        {/* 2. Center: Desktop Search (Hidden on mobile to avoid squeezing the brand or actions) */}
        <div className="hidden md:flex flex-1 max-w-md mx-4">
          <div className="relative w-full focus-within:ring-2 focus-within:ring-secondary rounded-xl transition-all">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm">search</span>
            <input 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-neutral-100 dark:bg-neutral-800/80 text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-700/60 rounded-xl pl-9 pr-9 py-2 text-xs outline-none placeholder-neutral-400 focus:ring-2 focus:ring-blue-500/40 transition-all" 
              placeholder="Search files, folders..." 
              type="text" 
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors cursor-pointer"
              >
                <X size={14} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>

        {/* 3. Right: Header Action Group (Strictly in-flow flex items, zero absolute positioning) */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Header Download Tray */}
          <HeaderDownloadButton/>

          {/* Theme Toggle Button */}
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="relative p-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            {theme === 'dark' ? (
              <Sun className="w-5 h-5 text-amber-400"/>
            ) : (
              <Moon className="w-5 h-5 text-neutral-700 dark:text-neutral-300"/>
            )}
          </button>

          {/* User Profile Avatar with dropdown */}
          <div className="relative">
            <div 
              onClick={(e) => { e.stopPropagation(); setShowProfileMenu(!showProfileMenu); }}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs sm:text-sm font-semibold shadow-sm select-none shrink-0 cursor-pointer"
            >
              {user?.name ? user.name.charAt(0).toUpperCase() : 'S'}
            </div>
            <div className={`absolute right-0 mt-2 w-48 bg-surface-container-lowest dark:bg-[#1e1f20] border border-outline-variant dark:border-zinc-800 shadow-lg rounded-xl overflow-hidden z-50 transition-all duration-200 ease-out origin-top-right ${showProfileMenu ? 'opacity-100 scale-100 visible translate-y-0' : 'opacity-0 scale-95 invisible -translate-y-2 pointer-events-none'}`}>
              <div className="px-4 py-3 border-b border-outline-variant dark:border-zinc-800 bg-surface-container-low dark:bg-[#131314] cursor-default">
                <p className="text-sm font-bold text-on-surface dark:text-[#e3e3e3] truncate">{user?.name || 'User'}</p>
                <p className="text-xs text-on-surface-variant dark:text-[#c4c7c5] truncate">{user?.email || 'user@example.com'}</p>
              </div>
              <button 
                onClick={() => { setViewMode('settings'); setShowProfileMenu(false); }}
                className="w-full text-left px-4 py-3 text-on-surface dark:text-[#e3e3e3] hover:bg-surface-container-high dark:hover:bg-zinc-800/70 text-sm flex items-center gap-2 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">person</span> Profile Settings
              </button>
              <div className="w-full h-px bg-outline-variant dark:bg-zinc-800"></div>
              <button 
                onClick={handleLogout}
                className="w-full text-left px-4 py-3 text-error dark:text-red-400 hover:bg-error/10 dark:hover:bg-red-950/30 text-sm flex items-center gap-2 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">logout</span> Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Canvas */}
      <main 
        onClick={() => { setShowProfileMenu(false); setIsSidebarOpen(false); setActiveMenuId(null); setActiveFolderMenuId(null); }} 
        className={`pt-24 pb-28 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto w-full min-h-screen bg-white dark:bg-[#131314] transition-all duration-300 ease-in-out ${isCollapsed ? 'md:ml-20' : 'md:ml-64'}`}
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
        ) : location.pathname === '/dashboard/photos' ? (
          <PhotosView token={token} />
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
            {/* Desktop Drag-and-Drop Area (Hidden on mobile) */}
            <div 
              onDrop={onDrop} 
              onDragOver={onDragOver} 
              onClick={triggerFileInput}
              className="hidden sm:flex flex-col items-center justify-center p-8 border-2 border-dashed border-neutral-200 dark:border-neutral-800 rounded-2xl bg-neutral-50/50 dark:bg-neutral-900/30 text-center mb-6 cursor-pointer group hover:bg-neutral-100/50 dark:hover:bg-neutral-800/30 transition-colors"
            >
              <div className="p-3 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 mb-3 group-hover:scale-110 transition-transform">
                <UploadCloud className="w-6 h-6"/>
              </div>
              <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                Drag & drop files or folders here
              </p>
              <p className="text-xs text-neutral-400 mt-1 mb-4">
                Securely upload documents, images, and archives. Maximum file size 5GB.
              </p>
              
              <div className="flex items-center gap-3">
                <button 
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-opacity cursor-pointer"
                >
                  Upload
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); setShowNewFolderModal(true); }}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
                >
                  + New Folder
                </button>
              </div>
            </div>

            {/* Mobile Compact Upload Bar (Visible only on mobile) */}
            <div className="flex sm:hidden items-center gap-2 mb-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 text-xs font-semibold shadow-sm hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer"
              >
                <UploadCloud className="w-4 h-4"/>
                <span>Upload Files</span>
              </button>
              <button
                onClick={() => setShowNewFolderModal(true)}
                className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 text-xs font-semibold border border-neutral-200/80 dark:border-neutral-700/60 active:scale-[0.98] transition-transform cursor-pointer"
              >
                <FolderPlus className="w-4 h-4"/>
                <span>New Folder</span>
              </button>
            </div>
          </section>
        )}

        {/* Stacked Dashboard Queue Area */}
        {(() => {
          const activeOrQueuedItems = uploadQueue.filter(i => ['uploading', 'analyzing', 'queued'].includes(i.status));
          if (activeOrQueuedItems.length === 0) return null;
          
          const activeUpload = activeOrQueuedItems.find(f => f.status === 'uploading' || f.status === 'analyzing');
          const queuedItems = activeOrQueuedItems.filter(f => f.status === 'queued');

          return (
            <div className="mb-stack-lg flex flex-col gap-4">
              {activeUpload && (
                <div className="p-4 bg-white dark:bg-[#1e1f20] rounded-xl border border-outline-variant dark:border-zinc-800 shadow-sm">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-sm font-medium text-on-surface dark:text-[#e3e3e3] truncate">
                      {activeUpload.status === 'analyzing' ? `Analyzing ${activeUpload.name}...` : `Uploading ${activeUpload.name}...`}
                    </span>
                    <button 
                      onClick={() => {
                        addToast('info', 'Upload canceled');
                        if (abortControllerRef.current) abortControllerRef.current.abort();
                        setUploadQueue(prev => prev.map(i => i.id === activeUpload.id ? { ...i, status: 'failed', error: 'Canceled' } : i));
                      }}
                      className="text-error dark:text-zinc-400 dark:hover:text-red-400 hover:bg-error/10 p-1 rounded-full transition-colors flex items-center justify-center shrink-0"
                      title="Cancel Upload"
                    >
                      <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                  </div>
                  <div className="w-full bg-neutral-200 dark:bg-neutral-800 rounded-full h-1.5 overflow-hidden mb-2">
                    {activeUpload.status === 'uploading' ? (
                      <div className="bg-gradient-to-r from-indigo-500 via-blue-500 to-cyan-400 relative h-full transition-all duration-300" style={{ width: `${activeUpload.progress}%` }}></div>
                    ) : (
                      <div className="bg-secondary relative h-full animate-pulse w-full"></div>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 font-mono">
                    <span>
                      {activeUpload.status === 'analyzing' ? 'Scanning...' : `${formatBytes(activeUpload.loadedBytes || 0)} / ${formatBytes(activeUpload.size)} (${activeUpload.progress}%)`}
                    </span>
                    <span className="text-right">
                      {activeUpload.status === 'analyzing' ? '' : (activeUpload.speed ? `${formatBytes(activeUpload.speed)}/s` : '-- KB/s')}
                    </span>
                  </div>
                </div>
              )}

              {queuedItems.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h4 className="font-label-md text-on-surface-variant dark:text-zinc-400 ml-1">Up Next ({queuedItems.length})</h4>
                  {queuedItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-white/50 dark:bg-[#1e1f20]/50 border border-outline-variant/50 dark:border-zinc-800/50 rounded-lg">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <span className="material-symbols-outlined text-secondary text-lg">schedule</span>
                        <span className="font-body-sm text-on-surface dark:text-[#e3e3e3] truncate" title={item.name}>{item.name}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-on-surface-variant dark:text-zinc-400 hidden sm:inline">{(item.size / (1024 * 1024)).toFixed(1)} MB</span>
                        <span className="text-xs text-on-surface-variant dark:text-zinc-500 italic">Waiting in queue...</span>
                        <button 
                          onClick={() => { 
                            setUploadQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'failed', error: 'Canceled' } : i));
                          }}
                          className="text-error dark:text-zinc-400 hover:bg-error/10 dark:hover:text-red-400 p-1 rounded-full transition-colors flex items-center justify-center ml-2"
                          title="Cancel"
                        >
                          <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Recent Files Table */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              <h3 className="font-title-lg text-title-lg text-on-surface dark:text-[#e3e3e3] flex items-center gap-2 flex-wrap min-w-0">
                {viewMode === 'recent' ? 'Recent Files' : (
                  breadcrumbs.map((crumb, index) => (
                    <React.Fragment key={crumb.id || 'home'}>
                      <span 
                        className={`cursor-pointer hover:underline truncate ${index === breadcrumbs.length - 1 ? 'font-bold text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}
                        onClick={() => handleBreadcrumbClick(crumb.id, index)}
                      >
                        {crumb.name}
                      </span>
                      {index < breadcrumbs.length - 1 && <span className="text-neutral-400 dark:text-neutral-600 shrink-0">&gt;</span>}
                    </React.Fragment>
                  ))
                )}
              </h3>
            </div>
            <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
              {viewMode !== 'recent' && (
                <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto justify-between sm:justify-end">
                  {/* Grid / List Mode Segmented Toggle (Matches PhotosView) */}
                  <div className="flex items-center bg-neutral-100 dark:bg-neutral-800/80 p-0.5 rounded-lg border border-neutral-200 dark:border-neutral-700/60 select-none">
                    {/* Grid View Button */}
                    <button
                      type="button"
                      onClick={() => handleSetFolderView('grid')}
                      className={`p-1.5 rounded-md transition-all cursor-pointer ${
                        folderView === 'grid'
                          ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm'
                          : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                      }`}
                      title="Grid view"
                      aria-label="Grid view"
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </button>

                    {/* List View Button */}
                    <button
                      type="button"
                      onClick={() => handleSetFolderView('list')}
                      className={`p-1.5 rounded-md transition-all cursor-pointer ${
                        folderView === 'list'
                          ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm'
                          : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                      }`}
                      title="List view"
                      aria-label="List view"
                    >
                      <List className="w-4 h-4" />
                    </button>
                  </div>
                  <button 
                    onClick={toggleSort}
                    className="px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 flex items-center gap-1 text-neutral-800 dark:text-neutral-100 whitespace-nowrap"
                  >
                    <span className="material-symbols-outlined text-sm">sort</span>
                    <span>Sort: {sortOrder === 'newest' ? 'Newest' : 'Oldest'}</span>
                    <span className="hidden sm:inline"> First</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {viewMode !== 'recent' && folders.length > 0 && (
            <div className="mb-6">
              <div className="text-neutral-500 dark:text-neutral-400 text-xs font-semibold uppercase tracking-wider mb-3">
                Folders
              </div>
              {folderView === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {folders.map(folder => {
                    const isSelected = selectedFolderIds.includes(String(folder._id));
                    return (
                      <div 
                        key={folder._id}
                        onClick={() => handleFolderClick(folder)}
                        className={`group relative flex flex-col justify-between p-4 rounded-xl border transition-all duration-150 cursor-pointer select-none min-h-[120px] ${
                          isSelected 
                            ? 'bg-blue-50/80 border-blue-300 dark:bg-blue-950/30 dark:border-blue-700 ring-1 ring-blue-500/30' 
                            : 'bg-white border-neutral-200 hover:bg-neutral-50/90 hover:border-neutral-300 shadow-sm dark:bg-neutral-900/60 dark:border-neutral-800/80 dark:hover:bg-neutral-800/50 dark:hover:border-neutral-700 dark:shadow-none'
                        }`}
                      >
                        {/* Selection Checkbox in top-left corner */}
                        <div 
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFolderSelect(folder._id, e);
                          }}
                          className={`absolute top-3 left-3 z-10 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 cursor-pointer transition-all ${
                            isSelected
                              ? 'opacity-100 bg-white text-black border-white shadow-sm'
                              : isSelectionActive
                                ? 'opacity-50 hover:opacity-100 border-neutral-400 dark:border-neutral-500 bg-neutral-100 dark:bg-neutral-900/80'
                                : 'opacity-0 group-hover:opacity-100 border-neutral-400 dark:border-neutral-500 bg-neutral-100 dark:bg-neutral-900/80 hover:border-neutral-900 dark:hover:border-white shadow-sm'
                          }`}
                          title={isSelected ? "Deselect folder" : "Select folder"}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>

                        {/* Top-Right: Three Dots Action Menu */}
                        <div 
                          onClick={(e) => e.stopPropagation()} 
                          className="absolute top-2.5 right-2.5 shrink-0 z-20"
                        >
                          <button 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setActiveFolderMenuId(activeFolderMenuId === folder._id ? null : folder._id); 
                            }}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 dark:text-neutral-500 dark:hover:text-neutral-200 dark:hover:bg-neutral-800/80 transition-colors flex-shrink-0 cursor-pointer"
                            title="More options"
                          >
                            <MoreVertical size={16} />
                          </button>

                          <div className={`absolute right-0 top-8 w-48 bg-white dark:bg-[#1e1f20] rounded-xl shadow-xl border border-neutral-200 dark:border-zinc-800 z-[60] flex flex-col py-1 transition-all duration-200 ease-out origin-top-right transform ${activeFolderMenuId === folder._id ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto' : 'opacity-0 scale-95 translate-y-[-10px] pointer-events-none'}`}>
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                openMoveModal({ ...folder, isFolder: true });
                                setActiveFolderMenuId(null); 
                              }} 
                              className="w-full text-left px-4 py-2 text-sm text-neutral-700 dark:text-[#e3e3e3] hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2 cursor-pointer"
                            >
                              <FolderInput size={16} strokeWidth={2} /> Move
                            </button>
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setFolderToRename(folder);
                                setNewRenameFolderName(folder.name);
                                setShowRenameFolderModal(true);
                                setActiveFolderMenuId(null); 
                              }} 
                              className="w-full text-left px-4 py-2 text-sm text-neutral-700 dark:text-[#e3e3e3] hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2 cursor-pointer"
                            >
                              <Pencil size={16} strokeWidth={2} /> Rename
                            </button>
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setFolderToView(folder);
                                setShowFolderDetailsModal(true);
                                setActiveFolderMenuId(null); 
                              }} 
                              className="w-full text-left px-4 py-2 text-sm text-neutral-700 dark:text-[#e3e3e3] hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2 cursor-pointer"
                            >
                              <Info size={16} strokeWidth={2} /> Folder Details
                            </button>
                            <div className="border-t border-neutral-200 dark:border-neutral-700 my-1"></div>
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setFolderToDelete(folder); 
                                setActiveFolderMenuId(null); 
                              }} 
                              className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[18px]">delete</span> Delete
                            </button>
                          </div>
                        </div>

                        {/* Card Content: Permanently Visible Folder Icon + Name */}
                        <div className="flex flex-col items-center justify-center flex-1 pt-3 pb-1">
                          <Folder className="w-8 h-8 text-blue-600 fill-blue-500/20 dark:text-blue-400 dark:fill-blue-400/25 shrink-0 transition-transform mb-2" />
                          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200 group-hover:text-black dark:group-hover:text-white truncate max-w-full text-center transition-colors">
                            {folder.name}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col">
                  {folders.map(folder => {
                    const isSelected = selectedFolderIds.includes(String(folder._id));
                    return (
                      <div 
                        key={folder._id}
                        onClick={() => handleFolderClick(folder)}
                        className={`group relative flex items-center justify-between px-4 py-3 rounded-xl border transition-all duration-150 cursor-pointer select-none mb-2 ${
                          isSelected 
                            ? 'bg-blue-50/80 border-blue-300 dark:bg-blue-950/30 dark:border-blue-700 ring-1 ring-blue-500/30' 
                            : 'bg-white border-neutral-200 hover:bg-neutral-50/90 hover:border-neutral-300 shadow-sm dark:bg-neutral-900/60 dark:border-neutral-800/80 dark:hover:bg-neutral-800/50 dark:hover:border-neutral-700 dark:shadow-none'
                        }`}
                      >
                        {/* Left: Checkbox Slot + Permanent Folder Icon + Folder Name */}
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {/* Dedicated Checkbox Slot (Smooth Fade-in on Hover / Visible when Selected) */}
                          <div 
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFolderSelect(folder._id, e);
                            }}
                            className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 cursor-pointer transition-all ${
                              isSelected
                                ? 'opacity-100 bg-white text-black border-white'
                                : isSelectionActive
                                  ? 'opacity-50 hover:opacity-100 border-neutral-400 dark:border-neutral-500 bg-neutral-100 dark:bg-neutral-900/80'
                                  : 'opacity-0 group-hover:opacity-100 border-neutral-400 dark:border-neutral-500 bg-neutral-100 dark:bg-neutral-900/80 hover:border-neutral-900 dark:hover:border-white'
                            }`}
                            title={isSelected ? "Deselect folder" : "Select folder"}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]"/>}
                          </div>

                          {/* Folder Icon: ALWAYS VISIBLE */}
                          <Folder className="w-5 h-5 text-blue-600 fill-blue-500/20 dark:text-blue-400 dark:fill-blue-400/25 shrink-0"/>

                          {/* Folder Name */}
                          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200 group-hover:text-black dark:group-hover:text-white truncate transition-colors">
                            {folder.name}
                          </span>
                        </div>

                        {/* Right: Three Dots Action Menu */}
                        <div 
                          onClick={(e) => e.stopPropagation()} 
                          className="shrink-0 ml-3 flex items-center relative"
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveFolderMenuId(activeFolderMenuId === folder._id ? null : folder._id);
                            }}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 dark:text-neutral-500 dark:hover:text-neutral-200 dark:hover:bg-neutral-800/80 transition-colors cursor-pointer"
                            title="More options"
                          >
                            <MoreVertical size={16}/>
                          </button>

                          <div className={`absolute right-0 top-8 w-48 bg-white dark:bg-[#1e1f20] rounded-xl shadow-xl border border-neutral-200 dark:border-zinc-800 z-[60] flex flex-col py-1 transition-all duration-200 ease-out origin-top-right transform ${activeFolderMenuId === folder._id ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto' : 'opacity-0 scale-95 translate-y-[-10px] pointer-events-none'}`}>
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                openMoveModal({ ...folder, isFolder: true });
                                setActiveFolderMenuId(null); 
                              }} 
                              className="w-full text-left px-4 py-2 text-sm text-neutral-700 dark:text-[#e3e3e3] hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2 cursor-pointer"
                            >
                              <FolderInput size={16} strokeWidth={2} /> Move
                            </button>
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setFolderToRename(folder);
                                setNewRenameFolderName(folder.name);
                                setShowRenameFolderModal(true);
                                setActiveFolderMenuId(null); 
                              }} 
                              className="w-full text-left px-4 py-2 text-sm text-neutral-700 dark:text-[#e3e3e3] hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2 cursor-pointer"
                            >
                              <Pencil size={16} strokeWidth={2} /> Rename
                            </button>
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setFolderToView(folder);
                                setShowFolderDetailsModal(true);
                                setActiveFolderMenuId(null); 
                              }} 
                              className="w-full text-left px-4 py-2 text-sm text-neutral-700 dark:text-[#e3e3e3] hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2 cursor-pointer"
                            >
                              <Info size={16} strokeWidth={2} /> Folder Details
                            </button>
                            <div className="border-t border-neutral-200 dark:border-neutral-700 my-1"></div>
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setFolderToDelete(folder); 
                                setActiveFolderMenuId(null); 
                              }} 
                              className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[18px]">delete</span> Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {viewMode !== 'recent' && folders.length > 0 && (
            <div className="text-neutral-500 dark:text-neutral-400 text-xs font-semibold uppercase tracking-wider mb-3">
              Files
            </div>
          )}

          <div className="bg-white dark:bg-[#1e1f20] rounded-xl border border-neutral-200 dark:border-zinc-800/50 shadow-sm dark:text-zinc-300">
            <div className="md:overflow-x-auto custom-scrollbar w-full pb-32">
              <table className="w-full text-left md:border-collapse block md:table md:min-w-[800px]">
                <thead className="hidden md:table-header-group">
                  <tr className="border-b border-neutral-200 dark:border-zinc-800/50 bg-neutral-50/80 dark:bg-[#1e1f20] text-neutral-500 dark:text-neutral-400 text-xs font-semibold uppercase tracking-wider">
                    <th className="w-12 text-center p-0 align-middle">
                      <div className="flex items-center justify-center w-full h-full">
                        <div 
                          onClick={(e) => handleSelectAllFiles(e)}
                          className={`w-5 h-5 rounded border transition-all flex items-center justify-center cursor-pointer ${
                            isAllFilesSelected
                              ? 'opacity-100 bg-white text-black border-white'
                              : isSomeFilesSelected
                                ? 'opacity-100 border-neutral-300 bg-neutral-900/90 text-white'
                                : isSelectionActive
                                  ? 'opacity-40 hover:opacity-100 border-neutral-500 bg-neutral-900/80 hover:border-white'
                                  : 'opacity-0 hover:opacity-100 border-neutral-500 bg-neutral-900/80 hover:border-white'
                          }`}
                          title={isAllFilesSelected ? "Deselect all files" : "Select all files"}
                        >
                          {isAllFilesSelected && <Check className="w-3.5 h-3.5 stroke-[3] text-black" />}
                          {isSomeFilesSelected && <div className="w-2.5 h-0.5 bg-white rounded-full" />}
                        </div>
                      </div>
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
                    filteredFiles.map((file, index) => (
                    <ErrorBoundary key={file?._id || file?.id || Math.random()}>
                    <tr 
                      onClick={() => file.isFolder ? setCurrentDirectory(file.diskName) : handlePreview(file)}
                      className={`flex flex-wrap md:table-row items-center py-3 px-4 md:p-0 hover:bg-surface-bright dark:hover:bg-zinc-800/70 dark:text-zinc-300 transition-colors group md:h-14 ${
                        selectedFileIds.includes(String(file._id)) ? 'bg-neutral-100 dark:bg-zinc-800/60' : ''
                      } ${file.isFolder || (file.diskName && (file.status === 'Safe' || file.status === 'unscanned_too_large')) ? 'cursor-pointer' : ''}`}
                    >
                      <td className="w-12 text-center p-0 align-middle" onClick={(e) => e.stopPropagation()}>
                        {!file.isFolder && (
                          <div className="flex items-center justify-center w-full h-full">
                            <div 
                              onClick={(e) => toggleFileSelect(file._id, e)}
                              className={`w-5 h-5 rounded border transition-all flex items-center justify-center cursor-pointer ${
                                selectedFileIds.includes(String(file._id))
                                  ? 'opacity-100 bg-white text-black border-white'
                                  : isSelectionActive
                                    ? 'opacity-40 hover:opacity-100 border-neutral-500 bg-neutral-900/80 hover:border-white'
                                    : 'opacity-0 group-hover:opacity-100 border-neutral-500 bg-neutral-900/80 hover:border-white'
                              }`}
                              title={selectedFileIds.includes(String(file._id)) ? "Deselect file" : "Select file"}
                            >
                              {selectedFileIds.includes(String(file._id)) && (
                                <Check className="w-3.5 h-3.5 stroke-[3] text-black" />
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="flex-1 min-w-0 block md:table-cell md:py-3 md:px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded flex items-center justify-center shrink-0 bg-surface-dim text-on-surface-variant">
                            <span className="material-symbols-outlined text-sm">{getIconForType(file.type)}</span>
                          </div>
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="font-medium truncate max-w-full md:max-w-[250px]" title={file.name}>{file.name}</span>
                            <div className="md:hidden flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                              <span>{file.date}</span>
                              <span>•</span>
                              <span>{formatSize(file.size)}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="hidden md:table-cell py-3 px-6 text-on-surface-variant dark:text-[#c4c7c5]">{file.date}</td>
                      <td className="hidden md:table-cell py-3 px-6 text-on-surface-variant dark:text-[#c4c7c5]">{formatSize(file.size)}</td>
                      <td className="block md:table-cell ml-auto md:ml-0 md:py-3 md:px-6 shrink-0">
                        {!file.isFolder && (
                          file.status === 'Safe' ? (
                            <div className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full bg-[#dcfce7] text-[#166534] border border-[#bbf7d0]" title="Safe">
                              <span className="material-symbols-outlined text-[14px]">check_circle</span>
                              <span className="font-label-md text-[11px] hidden sm:inline">Safe</span>
                            </div>
                          ) : file.status === 'unscanned_too_large' ? (
                            <div className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 border border-neutral-300 dark:border-neutral-700" title="Unscanned (Too Large)">
                              <span className="material-symbols-outlined text-[14px]">info</span>
                              <span className="font-label-md text-[11px] hidden sm:inline">Unscanned (Too Large)</span>
                            </div>
                          ) : file.status === 'Malicious' || file.status === 'malware' ? (
                            <div className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full bg-error/10 text-error border border-error/20" title="Malicious">
                              <span className="material-symbols-outlined text-[14px]">warning</span>
                              <span className="font-label-md text-[11px] hidden sm:inline">Malicious</span>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface-variant border border-outline-variant" title={file.status || 'Pending'}>
                              <span className="material-symbols-outlined text-[14px]">hourglass_empty</span>
                              <span className="font-label-md text-[11px] hidden sm:inline">{file.status || 'Pending'}</span>
                            </div>
                          )
                        )}
                      </td>
                      <td className="block md:table-cell ml-2 md:ml-0 md:py-3 md:px-6 md:text-right relative">
                        <div className="flex relative justify-end">
                          <button
                            onClick={(e) => { e.stopPropagation(); setActiveMenuId(activeMenuId === (file._id || file.id) ? null : (file._id || file.id)); }}
                            className="p-1 text-neutral-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-700 rounded transition-colors"
                          >
                            <MoreVertical size={20} />
                          </button>
                          
                          <div className={`absolute right-0 w-44 bg-white dark:bg-[#1e1f20] rounded-xl shadow-xl border border-outline-variant dark:border-zinc-800 z-[60] overflow-hidden flex flex-col py-1 transition-all duration-200 ease-out ${index >= filteredFiles.length - 2 && filteredFiles.length > 3 ? 'bottom-full mb-2 origin-bottom-right' : 'top-full mt-2 origin-top-right'} ${activeMenuId === (file._id || file.id) ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'}`}>
                            {!file.isFolder && (
                              <button onClick={(e) => { e.stopPropagation(); handlePreview(file); setActiveMenuId(null); }} className="w-full text-left px-4 py-2.5 text-sm text-neutral-700 dark:text-[#e3e3e3] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors flex items-center gap-3">
                                <span className="material-symbols-outlined text-[18px]">visibility</span> Preview
                              </button>
                            )}
                            {!file.isFolder && file.diskName && (file.status === 'Safe' || file.status === 'unscanned_too_large') && (
                              <button onClick={(e) => { e.stopPropagation(); setActiveMenuId(null); triggerDownload(file); }} className="w-full text-left px-4 py-2.5 text-sm text-neutral-700 dark:text-[#e3e3e3] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors flex items-center gap-3">
                                <span className="material-symbols-outlined text-[18px]">download</span> Download
                              </button>
                            )}
                            {!file.isFolder && (
                              <button onClick={(e) => { e.stopPropagation(); openMoveModal(file); setActiveMenuId(null); }} className="w-full text-left px-4 py-2.5 text-sm text-neutral-700 dark:text-[#e3e3e3] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors flex items-center gap-3">
                                <FolderInput size={18} strokeWidth={1.5} /> Move
                              </button>
                            )}
                            <button onClick={(e) => { 
                              e.stopPropagation(); 
                              setFileToRename(file); 
                              setNewRenameFileName(file.name); 
                              setShowRenameFileModal(true); 
                              setActiveMenuId(null); 
                            }} className="w-full text-left px-4 py-2.5 text-sm text-neutral-700 dark:text-[#e3e3e3] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors flex items-center gap-3">
                              <Pencil size={18} strokeWidth={1.5} /> Rename
                            </button>
                            <div className="border-t border-neutral-200 dark:border-neutral-700 my-1"></div>
                            <button onClick={(e) => { e.stopPropagation(); setFileToDelete(file); setActiveMenuId(null); }} className="w-full text-left px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors flex items-center gap-3">
                              <span className="material-symbols-outlined text-[18px]">delete</span> Delete
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                    </ErrorBoundary>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </section>
          </>
        )}
      </main>

      {/* Folder Delete Modal */}
      <DeleteConfirmModal
        isOpen={Boolean(folderToDelete)}
        onClose={() => setFolderToDelete(null)}
        onConfirm={confirmFolderDelete}
        title={`Delete "${folderToDelete?.name}"?`}
        description="Are you sure? Deleting this folder will permanently delete all files inside it."
        isDeleting={isDeletingFolder}
        count={1}
      />

      {/* Folder Details Modal */}
      <FolderDetailsModal
        isOpen={showFolderDetailsModal}
        onClose={() => {
          setShowFolderDetailsModal(false);
          setFolderToView(null);
        }}
        folder={folderToView}
        folders={folders}
        files={files}
        token={token}
      />

      {/* Rename Folder Modal */}
      {showRenameFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-[#1e1f20] rounded-2xl w-full max-w-md shadow-2xl p-6 border border-outline-variant dark:border-zinc-800">
            <h3 className="font-title-lg text-title-lg text-gray-900 dark:text-white mb-2">Rename Folder</h3>
            <p className="text-neutral-600 dark:text-neutral-300 text-sm mb-6">Enter a new name for your folder.</p>
            <form onSubmit={handleRenameFolderSubmit}>
              <input 
                autoFocus
                type="text" 
                required 
                className="w-full px-4 py-3 bg-white dark:bg-[#131314] border border-outline-variant dark:border-zinc-700 dark:text-zinc-200 rounded-xl focus:ring-2 focus:ring-secondary outline-none transition-all mb-6 font-body-md"
                placeholder="Folder name" 
                value={newRenameFolderName} 
                onChange={(e) => setNewRenameFolderName(e.target.value)}
              />
              <div className="flex items-center justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => { setShowRenameFolderModal(false); setFolderToRename(null); setNewRenameFolderName(''); }}
                  className="px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-xl transition-colors duration-200"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={!newRenameFolderName.trim()}
                  className={`px-6 py-2 text-sm font-medium bg-primary text-on-primary rounded-xl transition-colors duration-200 ${!newRenameFolderName.trim() ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary/90'}`}
                >
                  Rename
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename File Modal */}
      {showRenameFileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-[#1e1f20] rounded-2xl w-full max-w-md shadow-2xl p-6 border border-outline-variant dark:border-zinc-800">
            <h3 className="font-title-lg text-title-lg text-gray-900 dark:text-white mb-2">Rename File</h3>
            <p className="text-neutral-600 dark:text-neutral-300 text-sm mb-6">Enter a new name for your file.</p>
            <form onSubmit={handleRenameFileSubmit}>
              <input 
                autoFocus
                type="text" 
                required 
                className="w-full px-4 py-3 bg-white dark:bg-[#131314] border border-outline-variant dark:border-zinc-700 dark:text-zinc-200 rounded-xl focus:ring-2 focus:ring-secondary outline-none transition-all mb-6 font-body-md"
                placeholder="File name" 
                value={newRenameFileName} 
                onChange={(e) => setNewRenameFileName(e.target.value)}
              />
              <div className="flex items-center justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => { setShowRenameFileModal(false); setFileToRename(null); setNewRenameFileName(''); }}
                  className="px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-xl transition-colors duration-200"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={!newRenameFileName.trim()}
                  className={`px-6 py-2 text-sm font-medium bg-primary text-on-primary rounded-xl transition-colors duration-200 ${!newRenameFileName.trim() ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary/90'}`}
                >
                  Rename
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Google Drive-Style Hierarchical Move Modal */}
      <MoveModal
        isOpen={showMoveModal}
        onClose={() => {
          setShowMoveModal(false);
          setFileToMove(null);
          setItemsToMove([]);
        }}
        itemsToMove={itemsToMove}
        itemToMove={fileToMove}
        folders={moveFolders}
        currentPath={breadcrumbs}
        onMove={handleMoveConfirm}
        initialFolderId={currentFolderId}
        isMoving={isMoveLoading}
      />

      {/* Preview Modal */}
      {previewFile && (
        ['mp4', 'webm', 'ogg', 'mov', 'mkv'].includes((previewFile.type || '').toLowerCase()) ? (
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
            <div className="flex-1 overflow-hidden flex items-center justify-center p-4 w-full max-w-5xl mx-auto">
              <video
                src={previewUrl || previewFile.s3Url || previewFile.url || previewFile.downloadUrl}
                controls
                autoPlay
                playsInline
                className="max-w-full max-h-[80vh] rounded-lg object-contain shadow-2xl bg-black"
              >
                Your browser does not support the video tag.
              </video>
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
      <DeleteConfirmModal
        isOpen={Boolean(fileToDelete || showBulkDeleteModal)}
        onClose={() => { setFileToDelete(null); setShowBulkDeleteModal(false); }}
        onConfirm={showBulkDeleteModal ? handleBulkDelete : confirmDelete}
        title={
          showBulkDeleteModal
            ? undefined
            : `Delete "${fileToDelete?.name}"?`
        }
        description={
          showBulkDeleteModal
            ? `Are you sure you want to permanently delete the ${selectedFolderIds.length + selectedFileIds.length} selected item${selectedFolderIds.length + selectedFileIds.length === 1 ? '' : 's'}?`
            : `Are you sure you want to permanently delete "${fileToDelete?.name}"? It will be moved to Trash.`
        }
        count={showBulkDeleteModal ? (selectedFolderIds.length + selectedFileIds.length) : 1}
        isDeleting={isDeleting || isBulkDeleting}
      />

      {/* Unified Floating Action Pill (Matches PhotosView) */}
      {totalSelected > 0 && location.pathname !== '/dashboard/photos' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5 rounded-full bg-neutral-900/95 dark:bg-neutral-800/95 backdrop-blur-md border border-neutral-700/60 shadow-2xl text-white select-none max-w-[95vw]">
          
          {/* 1. Counter */}
          <span className="text-xs text-neutral-300 font-medium pl-1 whitespace-nowrap">
            {totalSelected} <span className="hidden sm:inline">selected</span>
          </span>

          {/* Vertical Divider */}
          <div className="h-4 w-[1px] bg-neutral-700 shrink-0" />

          {/* 2. Unified Select All */}
          <button
            onClick={handleToggleSelectAll}
            className="text-xs font-medium px-2 py-1 rounded-md hover:bg-white/10 transition-colors cursor-pointer text-white whitespace-nowrap"
          >
            {isAllSelected ? (
              <>
                <span className="sm:hidden">Deselect</span>
                <span className="hidden sm:inline">Deselect All</span>
              </>
            ) : (
              <>
                <span className="sm:hidden">All</span>
                <span className="hidden sm:inline">Select All ({totalViewItems})</span>
              </>
            )}
          </button>

          {/* 3. Move Action (Supports both folders and files) */}
          <button
            onClick={() => setIsMoveModalOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 sm:px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer text-white shrink-0"
            title="Move"
          >
            <FolderInput className="w-3.5 h-3.5"/>
            <span className="hidden sm:inline">Move</span>
          </button>

          {/* 4. Download Action: STRICTLY HIDDEN IF ANY FOLDER IS SELECTED */}
          {selectedFolders.length === 0 && selectedFiles.length > 0 && (
            <button
              onClick={handleBatchDownload}
              disabled={isDownloading}
              className="flex items-center gap-1.5 text-xs font-medium px-2.5 sm:px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer text-white disabled:opacity-50 shrink-0 whitespace-nowrap"
              title={isDownloading ? 'Downloading...' : 'Download'}
            >
              <Download className={`w-3.5 h-3.5 text-blue-400 ${isDownloading ? 'animate-bounce' : ''}`} />
              <span className="hidden sm:inline">{isDownloading ? 'Downloading...' : 'Download'}</span>
            </button>
          )}

          {/* 5. Delete Action (Supports both folders and files) */}
          <button
            onClick={() => setIsDeleteModalOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 sm:px-3 py-1.5 rounded-md bg-red-600/90 hover:bg-red-600 transition-colors cursor-pointer text-white shrink-0 whitespace-nowrap"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5"/>
            <span className="hidden sm:inline">Delete</span>
          </button>

          {/* 6. Clear Selection: Now calls handleClearAllSelection */}
          <button
            onClick={handleClearAllSelection}
            className="p-1 rounded-full hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer ml-0.5 shrink-0"
            title="Clear selection"
          >
            <X className="w-3.5 h-3.5"/>
          </button>
        </div>
      )}


      {isAccountDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-xl dark:bg-[#1a1a1a] border border-transparent dark:border-[#333]">
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Confirm Delete</h3>
            <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
              Are you sure you want to permanently delete your CloudGuard account? All files will be lost.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsAccountDeleteModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 transition-colors rounded-md dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setIsAccountDeleteModalOpen(false);
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
      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none animate-in fade-in">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-5 shadow-2xl">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-white">
                <FolderPlus className="w-4 h-4 text-blue-500 shrink-0"/>
                <span>New Folder</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isCreatingFolder) {
                    setShowNewFolderModal(false);
                    setNewFolderName('');
                  }
                }}
                disabled={isCreatingFolder}
                className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                title="Close"
              >
                <X className="w-4 h-4"/>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <input
                type="text"
                autoFocus
                disabled={isCreatingFolder}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name"
                className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-60 transition-all"
              />

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={isCreatingFolder}
                  onClick={() => {
                    setShowNewFolderModal(false);
                    setNewFolderName('');
                  }}
                  className="px-4 py-2 text-xs font-medium rounded-lg text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                
                <button
                  type="submit"
                  disabled={isCreatingFolder || !newFolderName.trim()}
                  className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:opacity-90 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed min-w-[84px]"
                >
                  {isCreatingFolder ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0"/>
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={dashboardContent} />
      <Route path="/dashboard/photos" element={dashboardContent} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;
