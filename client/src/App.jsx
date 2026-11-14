import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Routes, Route, Navigate, useSearchParams, useLocation, useNavigate, NavLink, Link } from 'react-router-dom';
import axios from 'axios';
import ResetPassword from './ResetPassword';
import CloudGuardLogo from './CloudGuardLogo';
import PasswordInput from './PasswordInput';
import OTPVerification from './OTPVerification';
import { useToast } from './context/ToastContext';
import MoveModal from './components/MoveModal';
import FolderDetailsModal from './components/FolderDetailsModal';
import DeleteConfirmModal from './components/DeleteConfirmModal';
import ProfileSettings from './components/ProfileSettings';
import CookieConsent from './components/CookieConsent';
import QuotaUpgradeModal from './components/QuotaUpgradeModal';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import Pricing from './pages/Pricing';
import RefundPolicy from './pages/RefundPolicy';
import ContactUs from './pages/ContactUs';
import AdminMonitor from './pages/AdminMonitor';
import PhotosView, { invalidatePhotosCache } from './pages/PhotosView';
import SubscriptionAlertBanner from './components/SubscriptionAlertBanner';
import { computeSHA256 } from './pages/Dashboard';
import { generateMediaThumbnail } from './utils/thumbnailHelper';
import { 
  downloadSingleFileWithProgress, 
  downloadBatchZipWithProgress 
} from './utils/downloadHelper';
import { HeaderDownloadButton, useDownload } from './context/DownloadContext';
import { HeaderUploadButton, useUpload, UploadProvider } from './context/UploadContext';
import { getCachedAccessUrl, fetchAccessUrl, prefetchAccessUrl } from './utils/accessUrlCache';
import { Folder, FolderInput, X, Search, MoreVertical, Pencil, Info, LayoutGrid, List, Check, Trash2, Image, Play, ChevronLeft, ChevronRight, Download, Clock, UploadCloud, FolderPlus, Menu, Sun, Moon, Loader2, FileText, ChevronDown, FileUp, FolderUp, ArrowUp, ArrowDown, ShieldCheck } from 'lucide-react';
import { extractDroppedItems, createFolderHierarchy } from './utils/folderUpload';

import { API_BASE_URL } from "./config";

// Module-level storage cache to persist storage meter state across tab navigation
let globalStorageStatsCache = null;

// Global 401 Interceptor to Stop Request Spam & Redirect
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error.config?.url || '';
    const isAuthRoute = requestUrl.includes('/api/auth/');

    // Never force redirect to /login if the error originated from an auth route
    if (error.response?.status === 401 && !isAuthRoute) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login' && window.location.pathname !== '/login/') {
        window.location.href = '/login?expired=true';
      }
    }

    return Promise.reject(error);
  }
);

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
  const [searchParams, setSearchParams] = useSearchParams();
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

  // Dynamic token verification helper:
  const getActiveToken = () => {
    return localStorage.getItem('token') || sessionStorage.getItem('token') || null;
  };

  // Listen for cross-component auth changes
  useEffect(() => {
    const syncAuth = () => {
      const activeToken = getActiveToken();
      const storedUser = localStorage.getItem('user') || sessionStorage.getItem('user');
      setToken(activeToken);
      setUser(storedUser ? JSON.parse(storedUser) : null);
    };

    window.addEventListener('cloudguard:auth-changed', syncAuth);
    window.addEventListener('auth-change', syncAuth);
    window.addEventListener('storage', syncAuth);
    syncAuth();

    return () => {
      window.removeEventListener('cloudguard:auth-changed', syncAuth);
      window.removeEventListener('auth-change', syncAuth);
      window.removeEventListener('storage', syncAuth);
    };
  }, [location.pathname]);

  const [isAdmin, setIsAdmin] = useState(null);
  const fetchedAdminTokenRef = useRef(null);
  const adminCheckPromiseRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const activeToken = getActiveToken();
    if (!activeToken) {
      fetchedAdminTokenRef.current = null;
      adminCheckPromiseRef.current = null;
      setIsAdmin(false);
      return;
    }

    if (fetchedAdminTokenRef.current === activeToken) {
      return;
    }

    // Reset isAdmin to null whenever token changes before /api/admin/me resolves
    setIsAdmin(null);

    if (!adminCheckPromiseRef.current || adminCheckPromiseRef.current.token !== activeToken) {
      adminCheckPromiseRef.current = {
        token: activeToken,
        promise: axios.get(`${API_BASE_URL}/api/admin/me`, {
          headers: { Authorization: `Bearer ${activeToken}` }
        })
      };
    }

    adminCheckPromiseRef.current.promise
      .then((res) => {
        if (!cancelled) {
          fetchedAdminTokenRef.current = activeToken;
          setIsAdmin(Boolean(res.data?.isAdmin));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsAdmin(false);
          adminCheckPromiseRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const refreshUser = async () => {
    try {
      const activeToken = getActiveToken();
      if (!activeToken) return;
      const res = await axios.get(`${API_BASE_URL}/api/payments/subscription-status`, {
        headers: { Authorization: `Bearer ${activeToken}` }
      });
      if (res.data?.success) {
        setUser((prev) => {
          const updated = {
            ...(prev || {}),
            ...res.data,
            plan: res.data.plan || res.data.subscription?.planId || prev?.plan || 'free',
            subscription: res.data.subscription || prev?.subscription,
            storageLimit: res.data.storageLimit || prev?.storageLimit
          };
          if (localStorage.getItem('token')) {
            localStorage.setItem('user', JSON.stringify(updated));
          } else {
            sessionStorage.setItem('user', JSON.stringify(updated));
          }
          return updated;
        });
      }
    } catch (err) {
      console.error('Failed to refresh user subscription status:', err);
    }
  };

  // Clear ?expired=true from address bar on /login without full reload
  useEffect(() => {
    if (window.location.pathname === '/login' && window.location.search.includes('expired=true')) {
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }, [location.pathname, location.search]);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '', remember: false });
  const [authError, setAuthError] = useState('');
  const [isUnverified, setIsUnverified] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isSignOutModalOpen, setIsSignOutModalOpen] = useState(false);
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
  const defaultStorageLimit = 5368709120; // 5 GB default
  const [storageStats, setStorageStats] = useState(() => globalStorageStatsCache || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewText, setPreviewText] = useState("");

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

  // Automatically close mobile search on navigation or Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsMobileSearchOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    setIsMobileSearchOpen(false);
  }, [location.pathname, searchParams]);

  const closePreview = () => {
    setPreviewFile(null);
    setPreviewUrl("");
    setPreviewText("");
  };

  const formatBytes = (bytes, decimals = 1) => {
    const numericBytes = Number(bytes);
    if (!numericBytes || isNaN(numericBytes) || numericBytes <= 0) {
      return '0 B';
    }

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(numericBytes) / Math.log(k));
    const safeIndex = Math.min(i, sizes.length - 1);

    return `${parseFloat((numericBytes / Math.pow(k, safeIndex)).toFixed(dm))} ${sizes[safeIndex]}`;
  };

  const formatSize = (bytes) => {
    if (bytes === '--') return '--';
    if (bytes === 0) return '0 B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const fetchStorageStats = useCallback(async () => {
    try {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      if (!token) return;

      const res = await axios.get(`${API_BASE_URL}/api/storage-stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.data) {
        globalStorageStatsCache = res.data;
        setStorageStats(res.data);
      }
    } catch (err) {
      if (err.response?.status !== 401) {
        console.error('Failed to sync storage stats:', err);
      }
    }
  }, []);

// Storage stats fetched in coordinated batch below


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
    globalStorageStatsCache = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setIsAdmin(false);
    fetchedAdminTokenRef.current = null;
    adminCheckPromiseRef.current = null;
    setShowProfileMenu(false);
    invalidatePhotosCache();
  };

  const [files, setFiles] = useState([]);
  const [recentSkip, setRecentSkip] = useState(0);
  const [hasMoreRecent, setHasMoreRecent] = useState(false);
  const [isLoadingMoreRecent, setIsLoadingMoreRecent] = useState(false);
  const RECENT_PAGE_SIZE = 10;
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const sortDropdownRef = useRef(null);
  const [upgradeWelcomeData, setUpgradeWelcomeData] = useState(null);
  const [fileToDelete, setFileToDelete] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [itemsToDelete, setItemsToDelete] = useState([]);
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
  
  const { enqueueFiles, quotaUpgradeState, resumePausedUpload, cancelPausedUpload } = useUpload();
  const [uploadQueue, setUploadQueue] = useState([]);
  const [isUploadDrawerOpen, setIsUploadDrawerOpen] = useState(true);
  const isQueueProcessing = useRef(false);
  const isUploading = uploadQueue.some(item => ['uploading', 'queued', 'analyzing'].includes(item.status));
  const [viewMode, setViewMode] = useState('all');
  const [currentDirectory, setCurrentDirectory] = useState('');
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
  const [pendingFolderUpload, setPendingFolderUpload] = useState(null);
  const desktopUploadMenuRef = useRef(null);
  const mobileUploadMenuRef = useRef(null);

  useEffect(() => {
    if (!isUploadMenuOpen) return;

    const handleOutsideClick = (e) => {
      const clickedDesktop = desktopUploadMenuRef.current && desktopUploadMenuRef.current.contains(e.target);
      const clickedMobile = mobileUploadMenuRef.current && mobileUploadMenuRef.current.contains(e.target);
      if (!clickedDesktop && !clickedMobile) {
        setIsUploadMenuOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsUploadMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isUploadMenuOpen]);

  useEffect(() => {
    if (!isSortMenuOpen) return;

    const handleOutsideClick = (e) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target)) {
        setIsSortMenuOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsSortMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSortMenuOpen]);
  const prevUploadRef = useRef({ time: 0, loaded: 0 });
  const abortControllerRef = useRef(null);
  const activeFolderIdRef = useRef(null);
  const lastFetchedFolderIdRef = useRef(undefined);
  const isNavigatingRef = useRef(false);
  const filesInFlightRef = useRef(false);
  const activeFetchingFolderRef = useRef(undefined);
  const isRefreshingRef = useRef(false);
  const [isFilesLoading, setIsFilesLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState(null);
  const [activeFolderMenuId, setActiveFolderMenuId] = useState(null);

  const isSettingsOpen = searchParams.get('view') === 'settings' && location.pathname === '/dashboard';
  const isFilesActive = location.pathname === '/dashboard' && !searchParams.get('view') && searchParams.get('tab') !== 'recent' && viewMode === 'all';
  const isRecentActive = location.pathname === '/dashboard' && !searchParams.get('view') && (searchParams.get('tab') === 'recent' || viewMode === 'recent');
  const isPhotosActive = location.pathname === '/dashboard/photos';

  // Automatically synchronize viewMode with route and query params
  useEffect(() => {
    if (searchParams.get('view') === 'settings') {
      setViewMode('settings');
    } else if (searchParams.get('tab') === 'recent') {
      setViewMode('recent');
    } else if (viewMode === 'settings') {
      setViewMode('all');
    }
  }, [location.pathname, searchParams]);
  const folderParam = searchParams.get('folder');
  const [currentFolderId, setCurrentFolderId] = useState(folderParam || null);
  const [isContentLoading, setIsContentLoading] = useState(false);
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
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);
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
    if (e) e.preventDefault();
    const trimmed = (newRenameFolderName || '').trim();
    if (!folderToRename || !trimmed || isRenamingFolder) return;
    try {
      setIsRenamingFolder(true);
      await axios.patch(`${API_BASE_URL}/api/folders/${folderToRename._id}/rename`, { 
        newName: trimmed,
        name: trimmed 
      }, { headers: { Authorization: `Bearer ${token}` } });
      setShowRenameFolderModal(false);
      setFolderToRename(null);
      setNewRenameFolderName('');
      toast.success('Folder renamed successfully');
      fetchFolders(currentFolderId);
    } catch (err) {
      console.error('Rename failed:', err);
      if (err.response?.status === 409) {
        toast.error(
          err.response?.data?.error || `A folder named "${trimmed}" already exists here.`
        );
      } else {
        toast.error(err.response?.data?.error || 'Failed to rename folder');
      }
    } finally {
      setIsRenamingFolder(false);
    }
  };

// confirmFolderDelete replaced by handleConfirmPermanentDelete below

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

  const fetchFolders = useCallback(async (targetFolderId) => {
    const pathname = window.location.pathname;
    if (pathname !== '/dashboard' && pathname !== '/dashboard/') {
      return;
    }
    try {
      const parentId = targetFolderId !== undefined ? (targetFolderId || null) : (searchParams.get('folder') || null);
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

  // 1. Clean Home Breadcrumb Handler: Only clears folder and resets URL
  const handleNavigateHome = () => {
    // If already at root /dashboard with no folder and no query, do nothing
    if (
      window.location.pathname === '/dashboard' &&
      !window.location.search &&
      !currentFolderId
    ) {
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    clearSelection();
    setCurrentFolderId(null);
    setBreadcrumbs([{ id: null, name: 'Home' }]);

    navigate('/dashboard');
    // DO NOT call fetchFolders(null) or fetchFiles(null) here!
  };

  // 2. Clean Folder Click Handler: Only updates state and URL
  const handleFolderClick = (folder) => {
    const folderId = folder?._id || folder;
    if (!folderId || currentFolderId === folderId) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    clearSelection();
    setCurrentFolderId(folderId);
    setBreadcrumbs(prev => {
      const existingIndex = prev.findIndex(b => b.id === folderId);
      if (existingIndex >= 0) {
        return prev.slice(0, existingIndex + 1);
      }
      return [...prev, { id: folderId, name: folder.name || 'Folder' }];
    });

    navigate(`/dashboard?folder=${folderId}`);
    // DO NOT call fetchFolders(folderId) or fetchFiles(folderId) here!
    // The URL listener useEffect will execute the fetch cleanly once.
  };

  const handleBreadcrumbClick = (folderId, index) => {
    const targetId = folderId || null;
    if (currentFolderId === targetId) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    clearSelection();
    setCurrentFolderId(targetId);
    setBreadcrumbs(prev => prev.slice(0, index + 1));

    navigate(targetId ? `/dashboard?folder=${targetId}` : '/dashboard');
  };

  const handleCloseSettings = () => {
    setViewMode('all');
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('view');
    setSearchParams(newParams);
  };

  const handleNavClick = (tab) => {
    setCurrentDirectory('');
    setIsSidebarOpen(false);

    // 1. Immediately dismiss settings in query string
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('view');

    // 2. Navigate cleanly to the target view and update viewMode
    if (tab === 'files') {
      newParams.delete('tab');
      newParams.delete('folder');
      setViewMode('all');
      handleNavigateHome();
      return;
    } else if (tab === 'recent') {
      newParams.set('tab', 'recent');
      setViewMode('recent');
      setSearchParams(newParams);
      if (location.pathname !== '/dashboard') {
        navigate('/dashboard?tab=recent');
      }
    } else if (tab === 'photos') {
      newParams.delete('tab');
      setViewMode('all');
      setSearchParams(newParams);
      navigate('/dashboard/photos');
    }
  };

  const handleNavigateHomeRoot = (e) => {
    if (e) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }

    setIsSidebarOpen(false);
    setCurrentDirectory('');
    setViewMode('all');

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (typeof clearSelection === 'function') {
      clearSelection();
    }

    setCurrentFolderId(null);
    setBreadcrumbs([{ id: null, name: 'Home' }]);

    const newParams = new URLSearchParams(searchParams);
    newParams.delete('view');
    newParams.delete('tab');
    newParams.delete('folder');
    setSearchParams(newParams);

    navigate('/dashboard');
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


  const fetchFiles = useCallback(async (folderId = undefined, force = false) => {
    const targetId = folderId !== undefined
      ? (folderId || null)
      : (searchParams.get('folder') || null);

    // Prevent duplicate back-to-back trigger for identical folder
    if (!force && lastFetchedFolderIdRef.current === targetId && files.length > 0) {
      return;
    }
    lastFetchedFolderIdRef.current = targetId;

    // ROUTE GUARD: Never fetch files if user is in Photos, Trash, or Settings
    const currentPath = window.location.pathname;
    if (currentPath !== '/dashboard' && currentPath !== '/dashboard/') {
      return;
    }

    // DUPLICATE GUARD: Do not abort if the exact same folder is already fetching
    if (filesInFlightRef.current && activeFetchingFolderRef.current === targetId) {
      return;
    }

    activeFolderIdRef.current = targetId;

    // 1. Abort any previous in-flight file requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    filesInFlightRef.current = true;
    activeFetchingFolderRef.current = targetId;

    try {
      setIsFilesLoading(true);
      setIsContentLoading(true);

      const authToken = token || localStorage.getItem('token') || sessionStorage.getItem('token');
      const isRecentTab = searchParams.get('tab') === 'recent' || viewMode === 'recent' || new URLSearchParams(window.location.search).get('tab') === 'recent';
      
      const queryParams = {};
      if (searchQuery) {
        queryParams.search = searchQuery;
      } else if (isRecentTab) {
        queryParams.recent = 'true';
        queryParams.limit = RECENT_PAGE_SIZE;
        queryParams.skip = 0;
      } else if (targetId) {
        queryParams.folderId = targetId;
      }

      const res = await axios.get(`${API_BASE_URL}/api/files`, {
        params: queryParams,
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        signal: abortControllerRef.current.signal,
      });

      // 2. CRITICAL RACE CONDITION GUARD:
      // If user clicked away to another folder while this request was traveling, discard it!
      if (activeFolderIdRef.current !== targetId) {
        return;
      }

      if (isRecentTab && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
        setFiles(res.data.files || []);
        setHasMoreRecent(Boolean(res.data.hasMore));
      } else {
        const fileList = Array.isArray(res.data) ? res.data : (res.data?.files || []);
        setFiles(fileList);
        setHasMoreRecent(false);
      }
    } catch (err) {
      // Ignore canceled requests from AbortController
      if (axios.isCancel(err) || err.name === 'CanceledError' || err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
        return;
      }
      if (err.response && err.response.status === 401) {
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = '/';
        return;
      }
      console.error('Error fetching files:', err);
    } finally {
      filesInFlightRef.current = false;
      // Only turn off skeleton if we are still on the requested folder
      if (activeFolderIdRef.current === targetId) {
        setIsFilesLoading(false);
        setIsContentLoading(false);
      }
    }
  }, [searchParams, viewMode, token, searchQuery, files.length]);

  const handleLoadMoreRecent = async () => {
    if (isLoadingMoreRecent || !hasMoreRecent) return;
    setIsLoadingMoreRecent(true);

    try {
      const nextSkip = files.length;
      const authToken = token || localStorage.getItem('token') || sessionStorage.getItem('token');
      const res = await axios.get(`${API_BASE_URL}/api/files`, {
        params: { recent: 'true', limit: RECENT_PAGE_SIZE, skip: nextSkip },
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });

      const newItems = res.data?.files || (Array.isArray(res.data) ? res.data : []);
      const hasMore = res.data?.hasMore !== undefined 
        ? Boolean(res.data.hasMore) 
        : newItems.length === RECENT_PAGE_SIZE;

      setFiles((prev) => {
        const existingIds = new Set(prev.map(f => String(f._id || f.id)));
        const uniqueNew = newItems.filter(f => !existingIds.has(String(f._id || f.id)));
        return [...prev, ...uniqueNew];
      });
      setRecentSkip(nextSkip);
      setHasMoreRecent(hasMore);
    } catch (err) {
      console.error('Failed to load more recent files:', err);
    } finally {
      setIsLoadingMoreRecent(false);
    }
  };

  const fetchContents = useCallback(async (targetFolderId) => {
    setIsContentLoading(true);
    setIsFilesLoading(true);
    try {
      await Promise.all([
        fetchFiles(targetFolderId),
        fetchFolders(targetFolderId)
      ]);
    } catch (err) {
      console.error('Error fetching folder contents:', err);
    } finally {
      setIsContentLoading(false);
      setIsFilesLoading(false);
    }
  }, [fetchFiles, fetchFolders]);

  const refreshCurrentView = useCallback(() => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;

    const activeId = currentFolderId || null;
    lastFetchedFolderIdRef.current = undefined;
    fetchFolders(activeId);
    fetchFiles(activeId, true);

    setTimeout(() => {
      isRefreshingRef.current = false;
    }, 300);
  }, [currentFolderId, fetchFolders, fetchFiles]);

  // Helper to build Google Drive style move messages
  const getMoveSuccessMessage = (items, destinationName) => {
    const dest = destinationName || 'Home';
    if (!items || items.length === 0) return `Moved to ${dest}`;
    if (items.length === 1) {
      const name = items[0].name || items[0].fileName || 'Item';
      return `"${name}" moved to ${dest}`;
    }
    return `${items.length} items moved to ${dest}`;
  };

  // Universal CloudGuard Native Toast Formatter (Theme-Aware, Full-Width, Non-clamping, Safe Mobile View)
  const showPillToast = ({
    message,
    actionText = null,
    onAction = null,
    duration = 6000,
  }) => {
    toast.custom(
      (t) => (
        <div
          className={`${
            t.visible ? 'animate-in fade-in slide-in-from-bottom-3 duration-200' : 'animate-out fade-out slide-out-to-bottom-2 duration-150'
          } pointer-events-auto flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl shadow-xl border backdrop-blur-md transition-all select-none
          w-full max-w-[calc(100vw-2rem)] sm:max-w-md mx-auto
          bg-white/95 text-neutral-900 border-neutral-200/90 shadow-neutral-900/10
          dark:bg-neutral-900/95 dark:text-neutral-100 dark:border-neutral-800/90 dark:shadow-black/50`}
        >
          {/* Status Dot */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>

            <p className="text-xs sm:text-sm font-medium truncate leading-tight">
              <span className="font-semibold text-neutral-900 dark:text-white" title={typeof message === 'string' ? message : undefined}>
                {message}
              </span>
            </p>
          </div>

          {/* Right: Divider, Optional Action (Undo) & Dismiss Icon */}
          <div className="flex items-center gap-2 shrink-0">
            {actionText && onAction && (
              <>
                <div className="h-4 w-[1px] bg-neutral-200 dark:bg-neutral-800" />
                <button
                  onClick={() => {
                    toast.dismiss(t.id);
                    onAction();
                  }}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 active:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/30 transition-all cursor-pointer whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                >
                  {actionText}
                </button>
              </>
            )}

            <button
              onClick={() => toast.dismiss(t.id)}
              className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 transition-colors cursor-pointer"
              title="Dismiss"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5 stroke-[2]"/>
            </button>
          </div>
        </div>
      ),
      {
        duration,
        position: 'bottom-center',
      }
    );
  };

  // Undo Move Function
  const handleUndoMove = async (movedItems, sourceFolderId) => {
    try {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');

      const folderIds = movedItems
        .filter((i) => i.type === 'folder' || i.isFolder || i.parentId !== undefined)
        .map((i) => i._id || i.id || i);
      const fileIds = movedItems
        .filter((i) => i.type !== 'folder' && !i.isFolder && i.parentId === undefined)
        .map((i) => i._id || i.id || i);

      // 1. AWAIT completion of backend reverse move FIRST
      await axios.post(
        `${API_BASE_URL}/api/folders/move-batch`,
        {
          destinationId: sourceFolderId || null,
          targetFolderId: sourceFolderId || null,
          parentId: sourceFolderId || null,
          folderIds,
          fileIds,
          items: movedItems,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // 2. Clear selections & invalidate caching ref
      setSelectedFolderIds([]);
      setSelectedFileIds([]);
      lastFetchedFolderIdRef.current = undefined;

      // 3. Determine current directory from URL
      const params = new URLSearchParams(window.location.search);
      const activeFolder = params.get('folder') || null;

      // 4. Synchronously flush files state to avoid lingering artifacts
      setFiles([]);

      // 5. Sequential atomic reload
      await fetchFolders(activeFolder);
      await fetchFiles(activeFolder);
      fetchStorageStats();

      showPillToast({ message: 'Move undone', duration: 3000 });
    } catch (err) {
      console.error('Failed to undo move:', err);
      toast.error('Could not undo move');
    }
  };

  const handleMoveConfirm = async (targetFolderId, customItems, destinationFolderObj) => {
    try {
      setIsMoveLoading(true);
      const items = (customItems && customItems.length > 0)
        ? customItems
        : (itemsToMove.length > 0 ? itemsToMove : (Array.isArray(fileToMove) ? fileToMove : (fileToMove ? [fileToMove] : [])));
      if (!items || items.length === 0) return;

      const destinationId = (!targetFolderId || targetFolderId === 'null' || targetFolderId === 'root' || targetFolderId === 'undefined') ? null : targetFolderId;
      const destinationName = destinationFolderObj?.name || (destinationId ? (moveFolders.find(f => String(f._id) === String(destinationId))?.name || 'Folder') : 'Home');
      const sourceFolderId = currentFolderId || null;

      const authToken = token || localStorage.getItem('token') || sessionStorage.getItem('token');

      // Separate into folder and file IDs
      const folderIds = [];
      const fileIds = [];

      items.forEach((item) => {
        if (!item) return;
        const isF = item.isFolder || item.type === 'folder' || item.parentId !== undefined || (!item.s3Key && !item.mimeType && !item.size);
        const id = String(item._id || item.id || item);
        if (isF) folderIds.push(id);
        else fileIds.push(id);
      });

      // 1. Execute Move API call
      if (items.length === 1) {
        const item = items[0];
        const isFolder = item.isFolder || item.type === 'folder' || item.parentId !== undefined || (!item.s3Key && !item.mimeType && !item.size);
        const itemId = item._id || item.id;

        if (isFolder) {
          if (String(itemId) === String(destinationId)) {
            addToast('error', 'Cannot move a folder into itself');
            setIsMoveLoading(false);
            return;
          }
          await axios.put(
            `${API_BASE_URL}/api/folders/${itemId}/move`,
            { parentId: destinationId, targetFolderId: destinationId, destinationId },
            { headers: { Authorization: `Bearer ${authToken}` } }
          );
        } else {
          await axios.put(
            `${API_BASE_URL}/api/files/${itemId}/move`,
            { folderId: destinationId, targetFolderId: destinationId, destinationId },
            { headers: { Authorization: `Bearer ${authToken}` } }
          );
        }
      } else {
        const payload = {
          destinationId,
          targetFolderId: destinationId,
          parentId: destinationId,
          folderIds,
          fileIds,
          items,
        };

        await axios.post(`${API_BASE_URL}/api/folders/move-batch`, payload, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
      }

      // 2. Close modal & clear selection FIRST to prevent double-render re-fetches
      setShowMoveModal(false);
      setItemsToMove([]);
      setFileToMove(null);
      clearSelection();

      // Ensure setFiles and setFolders remove the moved items whether destinationId is an ObjectId OR null (Home)
      const movedFileIdSet = new Set(fileIds);
      const movedFolderIdSet = new Set(folderIds);

      setFiles((prevFiles) => prevFiles.filter((file) => !movedFileIdSet.has(String(file._id || file.id))));
      setFolders((prevFolders) => prevFolders.filter((folder) => !movedFolderIdSet.has(String(folder._id || folder.id))));

      // 3. Invalidate duplicate cache ref & trigger background re-sync
      lastFetchedFolderIdRef.current = undefined;
      if (typeof fetchFiles === 'function') fetchFiles(sourceFolderId, true);
      if (typeof fetchFolders === 'function') fetchFolders(sourceFolderId);
      if (typeof fetchStorageStats === 'function') fetchStorageStats();

      // 4. Render Google Drive Toast with Undo in Native CloudGuard Pill Style
      const toastMessage = getMoveSuccessMessage(items, destinationName);

      showPillToast({
        message: toastMessage,
        actionText: 'Undo',
        onAction: () => handleUndoMove(items, sourceFolderId),
        duration: 6000,
      });
    } catch (err) {
      console.error('Batch move error:', err);
      addToast('error', err.response?.data?.error || err.response?.data?.message || 'Failed to move items');
    } finally {
      setIsMoveLoading(false);
    }
  };

  const handleExecuteBatchMove = handleMoveConfirm;

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  // Navigation & route listener effect (Single Source of Truth for Folder Navigation):
  useEffect(() => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    if (!token) return;

    // Strict route guard: Only run on the main dashboard view
    const pathname = window.location.pathname;
    if (pathname !== '/dashboard' && pathname !== '/dashboard/') {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const activeFolderId = searchParams.get('folder') || null;

    // Skip duplicate execution if already fetching or loaded for this exact folder
    if (lastFetchedFolderIdRef.current === activeFolderId) {
      return;
    }
    lastFetchedFolderIdRef.current = activeFolderId;

    // Trigger single coordinated fetch
    fetchFolders(activeFolderId);
    fetchFiles(activeFolderId, true);
    fetchStorageStats();
  }, [location.search, location.pathname, window.location.search, window.location.pathname]);

  // Real-time listener for live upload completion events across the app
  useEffect(() => {
    const handleRefresh = () => {
      globalStorageStatsCache = null;
      lastFetchedFolderIdRef.current = undefined;
      const params = new URLSearchParams(window.location.search);
      const activeFolderId = currentFolderId || params.get('folder') || null;
      if (typeof fetchFiles === 'function') fetchFiles(activeFolderId, true);
      if (typeof fetchStorageStats === 'function') fetchStorageStats();
      if (typeof fetchFolders === 'function') fetchFolders(activeFolderId);
    };

    window.addEventListener('cloudguard:files-updated', handleRefresh);
    window.addEventListener('cloudguard:storage-updated', handleRefresh);
    window.addEventListener('cloudguard:all-uploads-completed', handleRefresh);
    return () => {
      window.removeEventListener('cloudguard:files-updated', handleRefresh);
      window.removeEventListener('cloudguard:storage-updated', handleRefresh);
      window.removeEventListener('cloudguard:all-uploads-completed', handleRefresh);
    };
  }, [fetchFiles, fetchStorageStats, fetchFolders, currentFolderId]);

  // Upgrade Welcome Modal listener: detects ?upgraded=true or sessionStorage payload
  useEffect(() => {
    const isDashboard = location.pathname === '/dashboard' || location.pathname === '/dashboard/';
    if (!isDashboard) return;

    const isUpgraded = searchParams.get('upgraded') === 'true';
    let welcomePayload = null;
    try {
      const raw = sessionStorage.getItem('cloudguard_upgrade_welcome');
      if (raw) {
        welcomePayload = JSON.parse(raw);
        sessionStorage.removeItem('cloudguard_upgrade_welcome');
      }
    } catch (e) {
      console.error('Failed to parse upgrade welcome payload:', e);
    }

    if (isUpgraded || welcomePayload) {
      // 1. Remove ?upgraded=true from address bar
      if (isUpgraded) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('upgraded');
        const qs = nextParams.toString();
        navigate(qs ? `/dashboard?${qs}` : '/dashboard', { replace: true });
      }

      // 2. Trigger fresh storage and user profile fetch
      globalStorageStatsCache = null;
      if (typeof fetchStorageStats === 'function') fetchStorageStats();
      if (typeof refreshUser === 'function') refreshUser();

      // 3. Open welcome modal
      setUpgradeWelcomeData({
        planName: welcomePayload?.planName || 'CloudGuard Vault',
        storageGB: welcomePayload?.storageGB || (user?.subscription?.planId === 'tier_200gb' ? 200 : user?.subscription?.planId === 'tier_100gb' ? 100 : 50),
        billingCycle: welcomePayload?.billingCycle || 'annual',
        expiresAt: welcomePayload?.expiresAt || null,
      });
    }
  }, [location.pathname, searchParams]);

  // Separate trigger ONLY for search query or viewMode changes (never on folder navigation)
  useEffect(() => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    if (!token) return;

    const currentPath = window.location.pathname;
    if (currentPath !== '/dashboard' && currentPath !== '/dashboard/') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const activeFolderId = params.get('folder') || null;
    fetchFiles(activeFolderId, true);
  }, [viewMode, searchQuery]);

  const handleSortByName = () => {
    if (sortBy === 'name') {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy('name');
      setSortOrder('asc');
    }
  };

  const handleSortByDate = () => {
    if (sortBy === 'date') {
      setSortOrder(prev => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy('date');
      setSortOrder('desc');
    }
  };

  // Dynamic delete success message helper
  const getDeleteSuccessMessage = (items) => {
    if (!items || items.length === 0) return 'Permanently deleted item';
    if (items.length === 1) {
      const name = items[0].name || items[0].fileName || 'Item';
      return `Permanently deleted "${name}"`;
    }
    return `Permanently deleted ${items.length} items`;
  };

  // Bulletproof folder detector: checks item properties AND cross-references folders state
  const checkIsFolder = (item) => {
    if (!item) return false;
    if (item.isFolder === true || item.type === 'folder') return true;
    const idStr = String(item._id || item.id || '');
    if (Array.isArray(folders) && folders.some((f) => String(f._id || f.id) === idStr)) {
      return true;
    }
    // Folders never have size (or size is undefined), mimeType, or originalName
    if (item.size === undefined && !item.mimeType && !item.originalName && item.name) {
      return true;
    }
    return false;
  };

  // Dedicated Undo Delete Handler
  const handleUndoDelete = async (itemsToRestore) => {
    try {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };

      const folderIds = (itemsToRestore || []).filter(checkIsFolder).map((i) => i._id || i.id);
      const fileIds = (itemsToRestore || []).filter((i) => !checkIsFolder(i)).map((i) => i._id || i.id);

      await axios.post(
        `${API_BASE_URL}/api/files/restore-batch`,
        { fileIds, folderIds },
        { headers }
      );

      showPillToast({ message: 'Deletion undone', duration: 3000 });
      lastFetchedFolderIdRef.current = undefined;
      const activeFolderId = currentFolderId || new URLSearchParams(window.location.search).get('folder') || null;
      if (typeof fetchFiles === 'function') {
        await fetchFiles(activeFolderId, true);
      }
      if (typeof fetchFolders === 'function') {
        await fetchFolders(activeFolderId);
      }
      if (typeof fetchStorageStats === 'function') {
        fetchStorageStats();
      }
      invalidatePhotosCache();
    } catch (e) {
      console.error('Failed to undo deletion:', e);
      toast.error('Could not undo deletion');
    }
  };

  // Dynamic message formatting with single-line truncation
  const getDeleteToastContent = (items) => {
    if (!items || items.length === 0) return { action: 'Deleted', target: 'Item' };
    if (items.length === 1) {
      return {
        action: 'Deleted',
        target: items[0].name || items[0].fileName || 'Item',
      };
    }
    return {
      action: 'Deleted',
      target: `${items.length} items`,
    };
  };

  const triggerDeleteToast = (itemsToRestore) => {
    const toastData = getDeleteToastContent(itemsToRestore);

    // Trigger toast using full theme-aware classes:
    toast.custom(
      (t) => (
        <div
          className={`${
            t.visible ? 'animate-in fade-in slide-in-from-bottom-3 duration-200' : 'animate-out fade-out slide-out-to-bottom-2 duration-150'
          } pointer-events-auto flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl shadow-xl border backdrop-blur-md transition-all select-none
          w-full max-w-[calc(100vw-2rem)] sm:max-w-md mx-auto
          bg-white/95 text-neutral-900 border-neutral-200/90 shadow-neutral-900/10
          dark:bg-neutral-900/95 dark:text-neutral-100 dark:border-neutral-800/90 dark:shadow-black/50`}
        >
          {/* Left: Status Dot & Truncated Filename */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>

            <p className="text-xs sm:text-sm font-medium truncate leading-tight">
              <span className="text-neutral-500 dark:text-neutral-400 font-normal mr-1">
                {toastData.action}
              </span>
              <span className="font-semibold text-neutral-900 dark:text-white" title={toastData.target}>
                "{toastData.target}"
              </span>
            </p>
          </div>

          {/* Right: Divider, Undo Pill Button & Close Icon */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Subtle Vertical Divider */}
            <div className="h-4 w-[1px] bg-neutral-200 dark:bg-neutral-800" />

            {/* Polished Interactive Undo Button */}
            <button
              onClick={() => {
                toast.dismiss(t.id);
                handleUndoDelete(itemsToRestore);
              }}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 active:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/30 transition-all cursor-pointer whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            >
              Undo
            </button>

            {/* Clean Dismiss Button */}
            <button
              onClick={() => toast.dismiss(t.id)}
              className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 transition-colors cursor-pointer"
              title="Dismiss"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5 stroke-[2]"/>
            </button>
          </div>
        </div>
      ),
      {
        duration: 6000,
        position: 'bottom-center',
      }
    );
  };

  // Confirm Deletion Handler
  const handleConfirmPermanentDelete = async (customTarget) => {
    const target = itemToDelete || (customTarget && !Array.isArray(customTarget) ? customTarget : (Array.isArray(customTarget) && customTarget.length === 1 ? customTarget[0] : null)) || folderToDelete || fileToDelete;

    let bulkTargets = (itemsToDelete && itemsToDelete.length > 0) ? itemsToDelete : (Array.isArray(customTarget) && customTarget.length > 1 ? customTarget : null);
    if (!target && !bulkTargets && showBulkDeleteModal) {
      const selectedFoldersList = folders
        .filter((f) => selectedFolderIds.includes(String(f._id || f.id)))
        .map((f) => ({ ...f, isFolder: true }));
      const selectedFilesList = files
        .filter((f) => selectedFileIds.includes(String(f._id || f.id)));
      bulkTargets = [...selectedFoldersList, ...selectedFilesList];
    }

    setIsDeleteModalOpen(false);
    setFolderToDelete(null);
    setFileToDelete(null);
    setShowBulkDeleteModal(false);

    // CASE A: Single Item Deletion (from three dots menu)
    if (target && !bulkTargets) {
      const targetId = String(target._id || target.id);
      const isFolder = checkIsFolder(target);

      setItemToDelete(null);

      // 1. Optimistic UI update: remove immediately from state
      if (isFolder) {
        setFolders((prev) => prev.filter((f) => String(f._id || f.id) !== targetId));
      } else {
        setFiles((prev) => prev.filter((f) => String(f._id || f.id) !== targetId));
      }

      try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const headers = { Authorization: `Bearer ${token}` };

        // 2. Call dedicated folder or file delete endpoint
        if (isFolder) {
          await axios.delete(`${API_BASE_URL}/api/folders/${targetId}`, { headers });
        } else {
          await axios.delete(`${API_BASE_URL}/api/files/${targetId}`, { headers });
        }

        fetchStorageStats();
        invalidatePhotosCache();

        // 3. Trigger toast with working interactive Undo callback
        const itemsToRestore = [target];
        triggerDeleteToast(itemsToRestore);
      } catch (err) {
        console.error('Delete failed:', err);
        toast.error('Failed to delete item');
        const activeFolderId = currentFolderId || new URLSearchParams(window.location.search).get('folder') || null;
        lastFetchedFolderIdRef.current = undefined;
        fetchFolders(activeFolderId);
        fetchFiles(activeFolderId, true);
      }
      return;
    }

    // CASE B: Bulk Deletion (from Floating Bar)
    if (bulkTargets && bulkTargets.length > 0) {
      const folderIds = bulkTargets.filter(checkIsFolder).map((i) => i._id || i.id);
      const fileIds = bulkTargets.filter((i) => !checkIsFolder(i)).map((i) => i._id || i.id);

      setItemsToDelete([]);
      setSelectedFolderIds([]);
      setSelectedFileIds([]);
      clearSelection();

      if (folderIds.length > 0) {
        setFolders((prev) => prev.filter((f) => !folderIds.map(String).includes(String(f._id || f.id))));
      }
      if (fileIds.length > 0) {
        setFiles((prev) => prev.filter((f) => !fileIds.map(String).includes(String(f._id || f.id))));
      }

      try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const headers = { Authorization: `Bearer ${token}` };

        await axios.post(
          `${API_BASE_URL}/api/files/delete-batch`,
          { fileIds, folderIds },
          { headers }
        );

        fetchStorageStats();
        invalidatePhotosCache();

        // 3. Trigger toast with working interactive Undo callback
        const itemsToRestore = [...bulkTargets];
        triggerDeleteToast(itemsToRestore);
      } catch (err) {
        console.error('Bulk delete failed:', err);
        toast.error('Failed to delete items');
        const activeFolderId = currentFolderId || new URLSearchParams(window.location.search).get('folder') || null;
        lastFetchedFolderIdRef.current = undefined;
        fetchFolders(activeFolderId);
        fetchFiles(activeFolderId, true);
      }
    }
  };

  const confirmFolderDelete = () => handleConfirmPermanentDelete(folderToDelete);
  const confirmDelete = () => handleConfirmPermanentDelete(fileToDelete);
  const handleBulkDelete = () => handleConfirmPermanentDelete();

  const addToast = (type, message) => {
    toast.show(message, type);
  };

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
        // Ensure actual File reference is resolved whether nextItem is a File or an Object wrapper
        const fileObj = nextItem.file instanceof File ? nextItem.file : (nextItem instanceof File ? nextItem : nextItem.file || nextItem);

        const payload = {
          fileName: fileObj.name || name,
          name: fileObj.name || name,
          fileSize: fileObj.size !== undefined ? fileObj.size : size,
          size: fileObj.size !== undefined ? fileObj.size : size,
          mimeType: fileObj.type || 'application/octet-stream',
          type: fileObj.type || 'application/octet-stream',
          folderId: currentFolderId || null,
          folder: currentFolderId || null,
        };

        // 1. Request presigned direct S3 upload ticket with quota enforcement
        const presignRes = await axios.post(`${API_BASE_URL}/api/files/presigned-url`, payload, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || token}` },
        });
        const presignedUrl = presignRes.data.presignedUrl || presignRes.data.signedUrl;
        const fileId = presignRes.data.fileId;
        currentFileId = fileId;

        // 2. Direct S3 Upload with native progress tracking (without server proxying)
        const s3Axios = axios.create();
        delete s3Axios.defaults.headers.common['Authorization'];
        const [thumbnailData] = await Promise.all([
          generateMediaThumbnail(fileObj).catch(() => null),
          s3Axios.put(presignedUrl, fileObj, {
            headers: {
              'Content-Type': fileObj.type || 'application/octet-stream'
            },
            transformRequest: [(data, headers) => {
              if (headers) {
                delete headers.Authorization;
                delete headers.authorization;
              }
              return data;
            }],
            signal: abortControllerRef.current.signal,
            onUploadProgress: (progressEvent) => {
              const totalBytes = fileObj.size !== undefined ? fileObj.size : size;
              const percentCompleted = totalBytes > 0 ? Math.round((progressEvent.loaded * 100) / totalBytes) : 100;
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
          }),
        ]);

        // 3. Status update to analyzing
        setUploadQueue(prev => prev.map(item => item.id === id ? { ...item, status: 'analyzing' } : item));

        // Compute client-side SHA-256 using Web Crypto API
        const computedSha256 = nextItem.fileHash || await computeSHA256(fileObj);

        // 4. Finalize & graceful scan execution (auto-purged on threat)
        const finalizeRes = await axios.post(`${API_BASE_URL}/api/files/finalize-upload`, {
          fileId: currentFileId,
          sha256: computedSha256 || undefined,
          thumbnail: thumbnailData || undefined,
        }, {
          signal: abortControllerRef.current.signal
        });

        if (finalizeRes.data && finalizeRes.data.isMalicious) {
          finalStatus = 'threat_detected';
          securityThreat = true;
        } else if (finalizeRes.data && finalizeRes.data.file) {
          finalStatus = 'completed';
          const uploadedFile = finalizeRes.data.file;
          setFiles(prevFiles => {
            const safePrevFiles = Array.isArray(prevFiles) ? prevFiles : [];
            if (safePrevFiles.some(pf => pf?._id === uploadedFile?._id)) return safePrevFiles;
            return [uploadedFile, ...safePrevFiles];
          });
          invalidatePhotosCache();
          window.dispatchEvent(
            new CustomEvent('cloudguard:media-uploaded', {
              detail: uploadedFile
            })
          );
        }
      } catch (err) {
        if (axios.isCancel(err) || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
          finalStatus = 'failed';
          errorMsg = 'Canceled';
          if (currentFileId) {
            try { await axios.delete(`${API_BASE_URL}/api/files/${currentFileId}`); } catch(e){}
          }
        } else if (err.response?.data?.isMalicious || err.response?.data?.error === 'File blocked: Malicious content detected') {
          finalStatus = 'threat_detected';
          securityThreat = true;
          errorMsg = 'Security threat intercepted';
        } else {
          finalStatus = 'failed';
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
        addToast('error', `Threat detected: "${name}" was automatically purged from storage.`);
      } else if (finalStatus === 'completed') {
        addToast('success', `"${name}" uploaded & verified clean.`);
        invalidatePhotosCache();
      } else if (finalStatus === 'failed' && errorMsg !== 'Canceled') {
        addToast('error', errorMsg || `Upload failed for ${name}`);
      }

      // Single Batch Refresh: Only call fetchFiles() and fetchStorageStats() once when the ENTIRE queue finishes
      const remainingQueued = uploadQueue.filter(
        item => item.id !== id && ['queued', 'uploading', 'analyzing'].includes(item.status)
      ).length;

      if (remainingQueued === 0) {
        try {
          lastFetchedFolderIdRef.current = undefined;
          await fetchFiles(currentFolderId || null, true);
          await fetchStorageStats();
        } catch (err) {
          console.error("Failed to fetch updates:", err);
        }
      }
    };

    processNext();
  }, [uploadQueue, fetchFiles, fetchStorageStats, currentFolderId, addToast]);


  const handleFileUpload = async (filesToUpload) => {
    if (!filesToUpload || filesToUpload.length === 0) return;

    const totalUploadSize = Array.from(filesToUpload).reduce((sum, file) => sum + file.size, 0);
    const availableBytes = (storageStats?.storageLimit || storageStats?.totalLimitBytes || defaultStorageLimit) - (storageStats?.storageUsed || storageStats?.usedBytes || 0);
    
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

  const handleFolderSelect = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;

    const items = files.map((file) => ({
      file,
      relativePath: (file.webkitRelativePath || file.name).replace(/\\/g, '/'),
    }));

    processFolderUpload(items);
  };

  const handleUploadFolderClick = (e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setIsUploadMenuOpen(false);
    folderInputRef.current?.click();
  };

  const processFolderUpload = async (itemsWithPaths) => {
    if (!itemsWithPaths || itemsWithPaths.length === 0) return;
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');

    // 1. Pre-flight quota check: storageUsed + totalBatchBytes > storageLimit
    const totalBatchBytes = itemsWithPaths.reduce((sum, item) => sum + (item.file?.size || 0), 0);
    const storageUsed = storageStats?.storageUsed || storageStats?.usedBytes || storageStats?.used || 0;
    const storageLimit = storageStats?.storageLimit || storageStats?.totalLimitBytes || storageStats?.limit || defaultStorageLimit || 5368709120;

    if (storageUsed + totalBatchBytes > storageLimit) {
      if (toast && typeof toast.error === 'function') {
        toast.error('Storage quota exceeded. Not enough space in your vault for this folder.');
      }
      return;
    }

    const activeFolderId = currentFolderId || new URLSearchParams(window.location.search).get('folder') || null;

    const hasDirectory = itemsWithPaths.some((item) => {
      const rawPath = item.relativePath || item.file?.name || '';
      return rawPath.replace(/\\/g, '/').includes('/');
    });

    // If a mobile browser returns flat files with no webkitRelativePath folder prefix
    if (!hasDirectory) {
      const flatFiles = itemsWithPaths.map((item) => item.file).filter(Boolean);
      if (flatFiles.length > 0) {
        if (typeof enqueueFiles === 'function') {
          enqueueFiles(flatFiles, activeFolderId);
        } else {
          await handleFileUpload(flatFiles);
        }
      }
      return;
    }

    try {
      // 2. Create directory tree in MongoDB
      const folderMap = await createFolderHierarchy(itemsWithPaths, activeFolderId, token);

      // 3. Map each file to resolved targetFolderId and pass batch to enqueueFiles(...)
      const filesToEnqueue = itemsWithPaths.map((item) => {
        let targetFolderId = activeFolderId;
        const rawPath = item.relativePath || item.file?.name || '';
        const relPath = rawPath.replace(/\\/g, '/');
        if (relPath.includes('/')) {
          const dirPath = relPath.substring(0, relPath.lastIndexOf('/'));
          targetFolderId = folderMap.get(dirPath) || activeFolderId;
        }
        return {
          file: item.file,
          targetFolderId,
        };
      });

      if (typeof enqueueFiles === 'function') {
        enqueueFiles(filesToEnqueue, activeFolderId);
      } else {
        await handleFileUpload(filesToEnqueue);
      }

      // 4. Dispatch files-updated event so new folder appears immediately
      window.dispatchEvent(
        new CustomEvent('cloudguard:files-updated', { detail: { folderId: activeFolderId } })
      );
    } catch (err) {
      console.error('Folder upload processing error:', err);
      if (toast && typeof toast.error === 'function') {
        toast.error(err.message || 'Failed to process folder upload');
      }
    }
  };

  const onDrop = async (e) => {
    e.preventDefault();
    try {
      const items = e.dataTransfer?.items;
      const extracted = await extractDroppedItems(items);
      if (extracted && extracted.length > 0) {
        const hasDirectory = extracted.some((item) => {
          const rawPath = item.relativePath || item.file?.name || '';
          return rawPath.replace(/\\/g, '/').includes('/');
        });

        if (hasDirectory) {
          const totalBytes = extracted.reduce((sum, item) => sum + (item.file?.size || 0), 0);
          const firstDirItem = extracted.find((item) => (item.relativePath || '').replace(/\\/g, '/').includes('/'));
          const folderName = firstDirItem
            ? firstDirItem.relativePath.replace(/\\/g, '/').split('/')[0]
            : 'Folder';

          setPendingFolderUpload({
            folderName,
            fileCount: extracted.length,
            totalBytes,
            items: extracted,
          });
          return;
        }

        await processFolderUpload(extracted);
      } else if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        const flatFiles = Array.from(e.dataTransfer.files).map((file) => ({
          file,
          relativePath: file.name,
        }));
        await processFolderUpload(flatFiles);
      }
    } catch (err) {
      console.error('Drop error:', err);
    }
  };

  const onDragOver = (e) => {
    e.preventDefault();
  };

  const onFileInputChange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const allFiles = Array.from(e.target.files);
      if (typeof enqueueFiles === 'function') {
        enqueueFiles(allFiles, currentFolderId);
      } else {
        await handleFileUpload(allFiles);
      }
      e.target.value = null; // Clear input to allow re-uploading same file name
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
      const type = (file.type || '').toLowerCase();
      const cachedUrl = getCachedAccessUrl(file._id);

      if (cachedUrl) {
        setPreviewUrl(cachedUrl);
        setPreviewFile(file);

        if (type === 'txt' || type === 'md') {
          const textResponse = await fetch(cachedUrl);
          if (!textResponse.ok) throw new Error("Failed to fetch file content");
          const text = await textResponse.text();
          setPreviewText(text);
        }
        return;
      }

      setPreviewText('Loading...');
      const url = await fetchAccessUrl(file._id, token);
      if (!url) throw new Error("Could not fetch secure access URL");
      setPreviewUrl(url);
      setPreviewFile(file);

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

  const sortedFolders = useMemo(() => {
    return [...folders].sort((a, b) => {
      if (sortBy === 'name') {
        const cmp = String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true });
        return sortOrder === 'asc' ? cmp : -cmp;
      }
      const timeA = new Date(a.updatedAt || a.uploadedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.uploadedAt || b.createdAt || 0).getTime();
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
    });
  }, [folders, sortBy, sortOrder]);

  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      if (sortBy === 'name') {
        const cmp = String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true });
        return sortOrder === 'asc' ? cmp : -cmp;
      }
      const timeA = a.mtimeMs || new Date(a.updatedAt || a.uploadedAt || a.createdAt || a.uploadDate || 0).getTime();
      const timeB = b.mtimeMs || new Date(b.updatedAt || b.uploadedAt || b.createdAt || b.uploadDate || 0).getTime();
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
    });
  }, [files, sortBy, sortOrder]);

  const searchFiltered = sortedFiles.filter(file => file.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredFiles = searchFiltered;
  const selectableFiles = filteredFiles.filter(f => !f.isFolder);
  const isAllFilesSelected = selectableFiles.length > 0 && selectedFileIds.length === selectableFiles.length;
  const isSomeFilesSelected = selectedFileIds.length > 0 && selectedFileIds.length < selectableFiles.length;

  // Calculate total counts across folders + files
  const currentFolders = viewMode === 'recent' ? [] : sortedFolders;
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

  const activeToken = token || localStorage.getItem('token') || sessionStorage.getItem('token');
  if (!activeToken) {
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
      <>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<AuthPage />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/privacy-policy" element={<Navigate to="/privacy" replace />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/terms-and-conditions" element={<Navigate to="/terms" replace />} />
          <Route path="/refund-policy" element={<RefundPolicy />} />
          <Route path="/refund" element={<Navigate to="/refund-policy" replace />} />
          <Route path="/contact" element={<ContactUs />} />
          <Route path="/reset-password/:token" element={authContent} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        <CookieConsent />
      </>
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
        <div 
          onClick={handleNavigateHomeRoot}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleNavigateHomeRoot(e);
            }
          }}
          role="button"
          tabIndex={0}
          className="h-16 mb-6 flex items-center gap-2 px-4 cursor-pointer select-none"
        >
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
            type="button"
            onClick={() => handleNavClick('files')}
            className={`group relative w-full flex items-center h-12 rounded-full font-bold cursor-pointer active:opacity-80 transition-colors duration-200 ${isFilesActive ? 'text-secondary bg-surface-container-low dark:bg-[#282a2c] dark:text-[#e3e3e3]' : 'text-on-surface-variant dark:text-[#c4c7c5] hover:text-on-surface hover:bg-surface-container-high dark:hover:bg-[#333538] dark:hover:text-[#e3e3e3]'}`}
          >
            <div className="min-w-[3rem] flex justify-center items-center">
              <span className="material-symbols-outlined shrink-0" data-weight={isFilesActive ? "fill" : ""}>folder_open</span>
            </div>
            <span className={`font-semibold font-body-md text-body-md overflow-hidden whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100'}`}>My Files</span>
            {isCollapsed && (
              <div className="absolute left-full ml-4 px-3 py-1 bg-[#1e1f20] border border-zinc-800 text-[#e3e3e3] rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                My Files
              </div>
            )}
          </button>

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
              <span className="material-symbols-outlined shrink-0" data-weight={isPhotosActive ? "fill" : ""}>photo_library</span>
            </div>
            <span className={`text-center font-semibold font-body-md text-body-md overflow-hidden whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100'}`}>Photos</span>
            {isCollapsed && (
              <div className="absolute left-full ml-4 px-3 py-1 bg-[#1e1f20] border border-zinc-800 text-[#e3e3e3] rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                Photos
              </div>
            )}
          </button>
          
          <button 
            type="button"
            onClick={() => handleNavClick('recent')}
            className={`group relative w-full flex items-center h-12 rounded-full font-bold cursor-pointer active:opacity-80 transition-colors duration-200 ${isRecentActive ? 'text-secondary bg-surface-container-low dark:bg-[#282a2c] dark:text-[#e3e3e3]' : 'text-on-surface-variant dark:text-[#c4c7c5] hover:text-on-surface hover:bg-surface-container-high dark:hover:bg-[#333538] dark:hover:text-[#e3e3e3]'}`}
          >
            <div className="min-w-[3rem] flex justify-center items-center">
              <span className="material-symbols-outlined shrink-0" data-weight={isRecentActive ? "fill" : ""}>history</span>
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
          {isAdmin && (
            <button 
              type="button"
              onClick={() => { 
                setIsSidebarOpen(false); 
                navigate('/monitor');
              }}
              className={`group relative w-full flex items-center h-12 rounded-full font-bold cursor-pointer active:opacity-80 transition-colors duration-200 ${location.pathname === '/monitor' ? 'bg-surface-container-low dark:bg-[#282a2c] text-neutral-900 dark:text-white font-semibold' : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 hover:text-neutral-900 dark:hover:text-white'}`}
            >
              <div className="min-w-[3rem] flex justify-center items-center">
                <span className="material-symbols-outlined shrink-0" data-weight={location.pathname === '/monitor' ? "fill" : ""}>monitoring</span>
              </div>
              <span className={`font-semibold font-body-md text-body-md overflow-hidden whitespace-nowrap transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100'}`}>Monitor</span>
              {isCollapsed && (
                <div className="absolute left-full ml-4 px-3 py-1 bg-[#1e1f20] border border-zinc-800 text-[#e3e3e3] rounded-md shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                  Monitor
                </div>
              )}
            </button>
          )}
          <button 
            type="button"
            onClick={() => { 
              setViewMode('settings'); 
              setIsSidebarOpen(false); 
              navigate('/dashboard?view=settings');
            }}
            className={`group relative w-full flex items-center h-12 rounded-full font-bold cursor-pointer active:opacity-80 transition-colors duration-200 ${isSettingsOpen ? 'bg-surface-container-low dark:bg-[#282a2c] text-neutral-900 dark:text-white font-semibold' : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 hover:text-neutral-900 dark:hover:text-white'}`}
          >
            <div className="min-w-[3rem] flex justify-center items-center">
              <span className="material-symbols-outlined shrink-0" data-weight={isSettingsOpen ? "fill" : ""}>settings</span>
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
      <header className={`fixed top-0 right-0 w-full z-30 transition-all duration-300 ease-in-out select-none ${isCollapsed ? 'md:w-[calc(100%-80px)]' : 'md:w-[calc(100%-256px)]'}`}>
        <div className="bg-white/95 dark:bg-neutral-950/95 backdrop-blur-md h-16 border-b border-neutral-200/80 dark:border-neutral-800/80 flex justify-between items-center px-3 sm:px-6">
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

            <div 
              onClick={handleNavigateHomeRoot}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleNavigateHomeRoot(e);
                }
              }}
              role="button"
              tabIndex={0}
              className="flex items-center gap-2 sm:gap-2.5 cursor-pointer select-none shrink-0 md:hidden"
            >
              <CloudGuardLogo className="w-12 h-12 sm:w-12 sm:h-12 shrink-0 transition-transform active:scale-95"/>
              <span className="text-lg sm:text-xl font-bold tracking-tight text-neutral-900 dark:text-white">
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
            {/* Mobile Search Toggle Button */}
            <button
              type="button"
              onClick={() => setIsMobileSearchOpen((prev) => !prev)}
              className="md:hidden p-2 rounded-xl text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:text-white dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              aria-label="Toggle Search"
              title="Search files and folders"
            >
              {isMobileSearchOpen ? (
                <X className="w-5 h-5 text-neutral-700 dark:text-neutral-300"/>
              ) : (
                <Search className="w-5 h-5 text-neutral-700 dark:text-neutral-300"/>
              )}
            </button>

            {/* Header Upload Tray */}
            <HeaderUploadButton />

            {/* Header Download Tray */}
            <HeaderDownloadButton />

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
                  <p className="text-xs text-on-surface-variant dark:text-[#c4c7c5] truncate">{user?.email || ''}</p>
                </div>
                <button 
                  type="button"
                  onClick={() => { 
                    setShowProfileMenu(false); 
                    setViewMode('settings'); 
                    navigate('/dashboard?view=settings');
                  }}
                  className="w-full text-left px-4 py-3 text-on-surface dark:text-[#e3e3e3] hover:bg-surface-container-high dark:hover:bg-zinc-800/70 text-sm flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">person</span> Profile Settings
                </button>
                <div className="w-full h-px bg-outline-variant dark:bg-zinc-800"></div>
                <button 
                  type="button"
                  onClick={() => {
                    setShowProfileMenu(false);
                    setIsSignOutModalOpen(true);
                  }}
                  className="w-full text-left px-4 py-3 text-error dark:text-red-400 hover:bg-error/10 dark:hover:bg-red-950/30 text-sm flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">logout</span> Sign out
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Collapsible Mobile Search Sub-Bar */}
        {isMobileSearchOpen && (
          <div className="md:hidden w-full px-4 py-2.5 bg-white/95 dark:bg-black/95 border-b border-neutral-200 dark:border-neutral-800/80 backdrop-blur-md transition-colors duration-200">
            <div className="relative flex items-center w-full">
              <Search className="absolute left-3.5 w-4 h-4 text-neutral-400 dark:text-neutral-400 pointer-events-none"/>
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search files, folders..."
                className="w-full pl-10 pr-10 py-2 text-sm bg-neutral-100 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 border border-neutral-200 dark:border-neutral-800 rounded-xl focus:outline-none focus:border-blue-500/80 focus:ring-1 focus:ring-blue-500/80 transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 p-1 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-white transition-colors"
                >
                  <X className="w-3.5 h-3.5"/>
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Content Canvas */}
      <main 
        onClick={() => { setShowProfileMenu(false); setIsSidebarOpen(false); setActiveMenuId(null); setActiveFolderMenuId(null); }} 
        className={`pt-24 pb-28 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto w-full min-h-screen bg-white dark:bg-[#131314] transition-all duration-300 ease-in-out ${isCollapsed ? 'md:ml-20' : 'md:ml-64'}`}
      >
        <SubscriptionAlertBanner />
        {isSettingsOpen ? (
          <div className="max-w-3xl mx-auto space-y-6">
            <h2 className="font-headline-md text-headline-md font-bold text-on-surface dark:text-[#e3e3e3] mb-8">Profile Settings</h2>
            
            <ProfileSettings 
              user={user} 
              setUser={setUser} 
              addToast={addToast} 
              onClose={handleCloseSettings} 
            />
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
                <path className="text-secondary" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeDasharray={`${storageStats ? Math.min(((storageStats.storageUsed || storageStats.usedBytes || storageStats.used || 0) / (storageStats.storageLimit || storageStats.totalLimitBytes || storageStats.limit || defaultStorageLimit)) * 100, 100) : 0}, 100`} strokeWidth="3"></path>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center font-label-md text-[10px] font-bold text-on-surface dark:text-[#c4c7c5]">
                {storageStats
                  ? `${Math.min(100, Math.round(((storageStats.storageUsed || storageStats.usedBytes || storageStats.used || 0) / (storageStats.storageLimit || storageStats.totalLimitBytes || storageStats.limit || defaultStorageLimit)) * 100))}%`
                  : '...'}
              </div>
            </div>
            <div>
              <p className="font-label-md text-label-md text-on-surface-variant dark:text-[#c4c7c5] uppercase tracking-wider">Storage Used</p>
              <p className="font-body-md text-body-md font-medium dark:text-[#e3e3e3]">
                {storageStats
                  ? `${formatBytes(storageStats.storageUsed || storageStats.usedBytes || storageStats.used || 0)} / ${formatBytes(storageStats.storageLimit || storageStats.totalLimitBytes || storageStats.limit || defaultStorageLimit, 0)}`
                  : 'Loading...'}
              </p>
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
            <input
              ref={folderInputRef}
              type="file"
              webkitdirectory=""
              directory=""
              multiple
              className="hidden"
              onChange={handleFolderSelect}
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
                {/* Desktop Upload ▾ Dropdown */}
                <div ref={desktopUploadMenuRef} className="relative inline-block">
                  <button 
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsUploadMenuOpen((prev) => !prev);
                    }}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5"
                  >
                    <span>Upload</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${isUploadMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isUploadMenuOpen && (
                    <div 
                      className="absolute left-0 sm:left-1/2 sm:-translate-x-1/2 top-full mt-2 w-48 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl p-1.5 z-40 text-left"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsUploadMenuOpen(false);
                          fileInputRef.current?.click();
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                      >
                        <FileUp className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                        <span>Upload Files</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleUploadFolderClick}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                      >
                        <FolderUp className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                        <span>Upload Folder</span>
                      </button>
                    </div>
                  )}
                </div>

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
              <div ref={mobileUploadMenuRef} className="relative inline-block flex-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsUploadMenuOpen((prev) => !prev);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 text-xs font-semibold shadow-sm hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <UploadCloud className="w-4 h-4"/>
                  <span>Upload Files</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${isUploadMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {isUploadMenuOpen && (
                  <div 
                    className="absolute left-0 sm:left-1/2 sm:-translate-x-1/2 top-full mt-2 w-48 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl p-1.5 z-40 text-left"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsUploadMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                    >
                      <FileUp className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                      <span>Upload Files</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleUploadFolderClick}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                    >
                      <FolderUp className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                      <span>Upload Folder</span>
                    </button>
                  </div>
                )}
              </div>

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
                  <div className="relative inline-block" ref={sortDropdownRef}>
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsSortMenuOpen(prev => !prev);
                      }}
                      className="px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700 flex items-center gap-1 text-neutral-800 dark:text-neutral-100 whitespace-nowrap cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">sort</span>
                      <span className="hidden sm:inline">Sort: </span>
                      <span>{sortBy === 'name' ? 'Name' : 'Date'}</span>
                      {sortOrder === 'asc' ? (
                        <ArrowUp className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {isSortMenuOpen && (
                      <div className="absolute right-0 top-full mt-2 w-48 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl p-1.5 z-40 text-left select-none">
                        <div className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                          Sort by
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (sortBy !== 'name') {
                              setSortBy('name');
                              setSortOrder('asc');
                            }
                            setIsSortMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs sm:text-sm rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer"
                        >
                          <span>Name</span>
                          {sortBy === 'name' && <Check className="w-3.5 h-3.5 text-blue-500" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (sortBy !== 'date') {
                              setSortBy('date');
                              setSortOrder('desc');
                            }
                            setIsSortMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs sm:text-sm rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer"
                        >
                          <span>Date</span>
                          {sortBy === 'date' && <Check className="w-3.5 h-3.5 text-blue-500" />}
                        </button>

                        <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />

                        <div className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                          Sort direction
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const target = sortBy === 'name' ? 'asc' : 'desc';
                            setSortOrder(target);
                            setIsSortMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs sm:text-sm rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer"
                        >
                          <span>{sortBy === 'name' ? 'A to Z' : 'New to old'}</span>
                          {sortOrder === (sortBy === 'name' ? 'asc' : 'desc') && (
                            <Check className="w-3.5 h-3.5 text-blue-500" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const target = sortBy === 'name' ? 'desc' : 'asc';
                            setSortOrder(target);
                            setIsSortMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs sm:text-sm rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer"
                        >
                          <span>{sortBy === 'name' ? 'Z to A' : 'Old to new'}</span>
                          {sortOrder === (sortBy === 'name' ? 'desc' : 'asc') && (
                            <Check className="w-3.5 h-3.5 text-blue-500" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {(isContentLoading || isFilesLoading) ? (
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
          ) : (
            <>
          {viewMode !== 'recent' && sortedFolders.length > 0 && (
            <div className="mb-6">
              <div className="text-neutral-500 dark:text-neutral-400 text-xs font-semibold uppercase tracking-wider mb-3">
                Folders
              </div>
              {folderView === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {sortedFolders.map((folder, index) => {
                    const isSelected = selectedFolderIds.includes(String(folder._id));
                    const isRightColumn = index % 2 === 1;
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

                          {activeFolderMenuId === folder._id && (
                            <div
                              className={`absolute top-full mt-1.5 w-44 sm:w-48 rounded-xl bg-white/95 dark:bg-[#18181b]/95 backdrop-blur-md border border-neutral-200 dark:border-neutral-800 shadow-2xl p-1.5 z-50 transform transition-all duration-150 ease-out ${
                                isRightColumn 
                                  ? 'right-0 sm:right-0 sm:left-auto origin-top-right' 
                                  : 'left-0 sm:left-auto sm:right-0 origin-top-left'
                              } animate-in fade-in zoom-in-95`}
                            >
                              <button 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  openMoveModal({ ...folder, isFolder: true });
                                  setActiveFolderMenuId(null); 
                                }} 
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-zinc-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer text-left"
                              >
                                <FolderInput className="w-4 h-4 text-neutral-400 dark:text-zinc-400 shrink-0" />
                                <span>Move</span>
                              </button>
                              <button 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setFolderToRename(folder);
                                  setNewRenameFolderName(folder.name);
                                  setShowRenameFolderModal(true);
                                  setActiveFolderMenuId(null); 
                                }} 
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-zinc-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer text-left"
                              >
                                <Pencil className="w-4 h-4 text-neutral-400 dark:text-zinc-400 shrink-0" />
                                <span>Rename</span>
                              </button>
                              <button 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setFolderToView(folder);
                                  setShowFolderDetailsModal(true);
                                  setActiveFolderMenuId(null); 
                                }} 
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-zinc-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer text-left"
                              >
                                <Info className="w-4 h-4 text-neutral-400 dark:text-zinc-400 shrink-0" />
                                <span>Folder Details</span>
                              </button>
                              <div className="h-[1px] bg-neutral-200 dark:bg-neutral-800 my-1" />
                              <button 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setFolderToDelete(folder); 
                                  setActiveFolderMenuId(null); 
                                }} 
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer text-left"
                              >
                                <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                                <span>Delete</span>
                              </button>
                            </div>
                          )}
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
                  {sortedFolders.map(folder => {
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

                          {activeFolderMenuId === folder._id && (
                            <div className="absolute right-0 top-full mt-1.5 w-44 sm:w-48 rounded-xl bg-white/95 dark:bg-[#18181b]/95 backdrop-blur-md border border-neutral-200 dark:border-neutral-800 shadow-2xl p-1.5 z-50 transform transition-all duration-150 ease-out origin-top-right animate-in fade-in zoom-in-95">
                              <button 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  openMoveModal({ ...folder, isFolder: true });
                                  setActiveFolderMenuId(null); 
                                }} 
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-zinc-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer text-left"
                              >
                                <FolderInput className="w-4 h-4 text-neutral-400 dark:text-zinc-400 shrink-0" />
                                <span>Move</span>
                              </button>
                              <button 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setFolderToRename(folder);
                                  setNewRenameFolderName(folder.name);
                                  setShowRenameFolderModal(true);
                                  setActiveFolderMenuId(null); 
                                }} 
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-zinc-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer text-left"
                              >
                                <Pencil className="w-4 h-4 text-neutral-400 dark:text-zinc-400 shrink-0" />
                                <span>Rename</span>
                              </button>
                              <button 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setFolderToView(folder);
                                  setShowFolderDetailsModal(true);
                                  setActiveFolderMenuId(null); 
                                }} 
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-zinc-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer text-left"
                              >
                                <Info className="w-4 h-4 text-neutral-400 dark:text-zinc-400 shrink-0" />
                                <span>Folder Details</span>
                              </button>
                              <div className="h-[1px] bg-neutral-200 dark:bg-neutral-800 my-1" />
                              <button 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setFolderToDelete(folder); 
                                  setActiveFolderMenuId(null); 
                                }} 
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer text-left"
                              >
                                <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                                <span>Delete</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {viewMode !== 'recent' && sortedFolders.length > 0 && (
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
                    <th className="py-4 px-6 font-medium">
                      <button
                        type="button"
                        onClick={handleSortByName}
                        className="cursor-pointer select-none inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-white transition-colors"
                      >
                        <span>File Name</span>
                        {sortBy === 'name' && (
                          sortOrder === 'asc' ? (
                            <ArrowUp className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <ArrowDown className="w-3.5 h-3.5 shrink-0" />
                          )
                        )}
                      </button>
                    </th>
                    <th className="py-4 px-6 font-medium">
                      <button
                        type="button"
                        onClick={handleSortByDate}
                        className="cursor-pointer select-none inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-white transition-colors"
                      >
                        <span>Date Modified</span>
                        {sortBy === 'date' && (
                          sortOrder === 'desc' ? (
                            <ArrowDown className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <ArrowUp className="w-3.5 h-3.5 shrink-0" />
                          )
                        )}
                      </button>
                    </th>
                    <th className="py-4 px-6 font-medium">Size</th>
                    <th className="py-4 px-6 font-medium">Security Status</th>
                    <th className="py-4 px-6 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="block md:table-row-group font-body-md text-body-md text-on-surface dark:text-zinc-300 divide-y divide-outline-variant/50 dark:divide-zinc-800/50">
                  {filteredFiles.length === 0 ? (
                    <tr className="block md:table-row">
                      <td colSpan="6" className="py-8 text-center block md:table-cell">
                        {files.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-16 text-center select-none">
                            <div className="w-12 h-12 rounded-2xl bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200/60 dark:border-neutral-700/40 flex items-center justify-center text-neutral-400 dark:text-neutral-500 mb-3">
                              <FileText className="w-6 h-6 stroke-[1.5]"/>
                            </div>
                            <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
                              No files uploaded yet
                            </p>
                            <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 max-w-xs">
                              Upload files or drag and drop documents into this folder to get started.
                            </p>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-16 text-center select-none">
                            <div className="w-12 h-12 rounded-2xl bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200/60 dark:border-neutral-700/40 flex items-center justify-center text-neutral-400 dark:text-neutral-500 mb-3">
                              <Search className="w-6 h-6 stroke-[1.5]"/>
                            </div>
                            <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
                              No files match your search
                            </p>
                            <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 max-w-xs">
                              Try searching for a different keyword or file extension.
                            </p>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : 
                    filteredFiles.map((file, index) => (
                    <ErrorBoundary key={file?._id || file?.id || Math.random()}>
                    <tr 
                      onClick={() => file.isFolder ? setCurrentDirectory(file.diskName) : handlePreview(file)}
                      onMouseEnter={() => !file.isFolder && prefetchAccessUrl(file._id, token)}
                      onTouchStart={() => !file.isFolder && prefetchAccessUrl(file._id, token)}
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
                              <button 
                                onClick={(e) => { e.stopPropagation(); handlePreview(file); setActiveMenuId(null); }} 
                                onMouseEnter={() => prefetchAccessUrl(file._id, token)}
                                onTouchStart={() => prefetchAccessUrl(file._id, token)}
                                className="w-full text-left px-4 py-2.5 text-sm text-neutral-700 dark:text-[#e3e3e3] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors flex items-center gap-3"
                              >
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

          {/* Load More Button Container */}
          {(viewMode === 'recent' || new URLSearchParams(window.location.search).get('tab') === 'recent') && hasMoreRecent && (
            <div className="flex justify-center items-center py-6">
              <button
                type="button"
                onClick={handleLoadMoreRecent}
                disabled={isLoadingMoreRecent}
                className="flex items-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                {isLoadingMoreRecent ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                    <span>Loading more files...</span>
                  </>
                ) : (
                  <span>Load More</span>
                )}
              </button>
            </div>
          )}
            </>
          )}
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
                disabled={isRenamingFolder}
                className="w-full px-4 py-3 bg-white dark:bg-[#131314] border border-outline-variant dark:border-zinc-700 dark:text-zinc-200 rounded-xl focus:ring-2 focus:ring-secondary outline-none transition-all mb-6 font-body-md disabled:opacity-60"
                placeholder="Folder name" 
                value={newRenameFolderName} 
                onChange={(e) => setNewRenameFolderName(e.target.value)}
              />
              <div className="flex items-center justify-end gap-3">
                <button 
                  type="button" 
                  disabled={isRenamingFolder}
                  onClick={() => { 
                    if (!isRenamingFolder) {
                      setShowRenameFolderModal(false); 
                      setFolderToRename(null); 
                      setNewRenameFolderName(''); 
                    }
                  }}
                  className="px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-xl transition-colors duration-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isRenamingFolder || !newRenameFolderName.trim()}
                  className={`flex items-center justify-center gap-2 px-6 py-2 text-sm font-medium bg-primary text-on-primary rounded-xl transition-colors duration-200 min-w-[100px] ${(!newRenameFolderName.trim() || isRenamingFolder) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary/90'}`}
                >
                  {isRenamingFolder ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0"/>
                      <span>Renaming...</span>
                    </>
                  ) : (
                    <span>Rename</span>
                  )}
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
        onFolderCreated={(newFolder) => {
          if (newFolder) {
            setMoveFolders(prev => {
              if (prev.some(f => (f._id || f.id) === (newFolder._id || newFolder.id))) return prev;
              return [...prev, newFolder];
            });
          }
        }}
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
                preload="auto"
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
            ? `Permanently delete ${selectedFolderIds.length + selectedFileIds.length} items?`
            : `Delete "${fileToDelete?.name}"?`
        }
        description={
          showBulkDeleteModal
            ? `Are you sure you want to permanently delete these ${selectedFolderIds.length + selectedFileIds.length} items? This action cannot be undone and will immediately free up your storage.`
            : 'Are you sure you want to permanently delete this file? This action cannot be undone and will immediately free up your storage.'
        }
        confirmText="Permanently delete"
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
      {/* Branded Sign-Out Confirmation Modal */}
      {isSignOutModalOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none animate-in fade-in"
          onClick={() => setIsSignOutModalOpen(false)}
        >
          <div 
            className="rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl p-6 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="signout-modal-title"
          >
            <div className="flex items-start gap-3.5 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 dark:bg-red-500/20 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[22px]">logout</span>
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h3 id="signout-modal-title" className="text-base font-semibold text-neutral-900 dark:text-white">
                  Sign out of CloudGuard?
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
                  You will need to sign in again to access your vault. Any active uploads or downloads in this tab will be interrupted.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setIsSignOutModalOpen(false)}
                className="px-4 py-2 text-xs font-medium rounded-xl text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  handleLogout();
                  setIsSignOutModalOpen(false);
                  navigate('/login');
                }}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-red-600 hover:bg-red-500 active:scale-95 text-white transition-all shadow-sm cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Branded Folder Upload Confirmation Modal */}
      {pendingFolderUpload && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150 select-none"
          onClick={() => setPendingFolderUpload(null)}
        >
          <div 
            className="w-full max-w-md rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-5 sm:p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="folder-upload-modal-title"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 sm:gap-4">
              <div className="flex items-start gap-3 sm:gap-4 min-w-0">
                <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-500 flex items-center justify-center shrink-0">
                  <FolderUp className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <h3 id="folder-upload-modal-title" className="text-base sm:text-lg font-bold text-neutral-900 dark:text-white leading-tight">
                    Upload Folder to Vault?
                  </h3>
                  <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 truncate mt-0.5">
                    {pendingFolderUpload.folderName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingFolderUpload(null)}
                className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-white transition-colors cursor-pointer shrink-0"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Summary Box */}
            <div className="bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/60 rounded-xl p-3.5 text-xs space-y-1.5 text-neutral-700 dark:text-neutral-300">
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-500 dark:text-neutral-400">Folder</span>
                <span className="font-semibold text-neutral-900 dark:text-white truncate max-w-[220px]">
                  {pendingFolderUpload.folderName}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-neutral-500 dark:text-neutral-400">Contents</span>
                <span className="font-semibold text-neutral-900 dark:text-white">
                  {pendingFolderUpload.fileCount} {pendingFolderUpload.fileCount === 1 ? 'file' : 'files'}{' '}
                  <span className="font-normal text-neutral-500 dark:text-neutral-400">
                    ({formatBytes(pendingFolderUpload.totalBytes)})
                  </span>
                </span>
              </div>
              <div className="pt-2 border-t border-neutral-200/80 dark:border-neutral-700/60 text-[11px] text-neutral-500 dark:text-neutral-400">
                Security: All files will be encrypted and scanned for threats before storage.
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setPendingFolderUpload(null)}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs sm:text-sm font-medium cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const itemsToUpload = pendingFolderUpload.items;
                  setPendingFolderUpload(null);
                  processFolderUpload(itemsToUpload);
                }}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 text-xs sm:text-sm font-semibold shadow-sm cursor-pointer transition-opacity"
              >
                Start Upload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={dashboardContent} />
        <Route path="/dashboard/photos" element={dashboardContent} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/privacy-policy" element={<Navigate to="/privacy" replace />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/terms-and-conditions" element={<Navigate to="/terms" replace />} />
        <Route path="/refund-policy" element={<RefundPolicy />} />
        <Route path="/refund" element={<Navigate to="/refund-policy" replace />} />
        <Route path="/contact" element={<ContactUs />} />
        <Route 
          path="/monitor" 
          element={
            !token ? (
              <Navigate to="/login" replace />
            ) : isAdmin === null ? (
              <div className="min-h-screen bg-black" />
            ) : isAdmin === false ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <AdminMonitor />
            )
          } 
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <CookieConsent />
      <QuotaUpgradeModal
        quotaData={quotaUpgradeState}
        onResume={resumePausedUpload}
        onCancel={cancelPausedUpload}
        user={user}
        refreshUser={refreshUser}
      />

      {/* Upgrade Welcome Modal */}
      {upgradeWelcomeData && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setUpgradeWelcomeData(null)}
        >
          <div 
            className="w-full max-w-md rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-5 sm:p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header: Emerald Check/Shield Badge + Title + Subtitle */}
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold text-neutral-900 dark:text-white leading-tight">
                  Welcome to {upgradeWelcomeData.planName}
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-normal">
                  Your encrypted vault capacity has been upgraded and activated.
                </p>
              </div>
            </div>

            {/* Summary Box */}
            <div className="bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/60 rounded-xl p-3.5 text-xs space-y-2 text-neutral-700 dark:text-neutral-300">
              <div className="flex items-center justify-between">
                <span className="text-neutral-500 dark:text-neutral-400">Storage Quota:</span>
                <span className="font-semibold text-neutral-900 dark:text-white">{upgradeWelcomeData.storageGB} GB</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-500 dark:text-neutral-400">Billing Cycle:</span>
                <span className="font-semibold text-neutral-900 dark:text-white">
                  {upgradeWelcomeData.billingCycle === 'annual' ? 'Annual' : 'Monthly'}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-neutral-200/60 dark:border-neutral-700/40">
                <span className="text-neutral-500 dark:text-neutral-400">Security:</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400 text-[11px] text-right">
                  Zero-trust encryption & real-time malware defense active
                </span>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  setUpgradeWelcomeData(null);
                  setViewMode('settings');
                  navigate('/dashboard?view=settings');
                }}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs sm:text-sm font-medium cursor-pointer transition-colors text-center"
              >
                View Invoice & Plan
              </button>
              <button
                type="button"
                onClick={() => setUpgradeWelcomeData(null)}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 text-xs sm:text-sm font-semibold shadow-sm cursor-pointer transition-opacity text-center"
              >
                Start Using Vault
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
