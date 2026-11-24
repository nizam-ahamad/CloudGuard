import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import axios from 'axios'
import './index.css'
import App from './App.jsx'
import { ToastProvider } from './context/ToastContext'
import { DownloadProvider } from './context/DownloadContext'
import { UploadProvider } from './context/UploadContext'
import { API_BASE_URL } from './config'

// Ensure cross-origin Set-Cookie (cg_vault_session, cg_auth_token) from api.cloudguard.site is sent & received on all API requests
axios.defaults.withCredentials = true;

// Ensure credentials on every request and strip invalid or placeholder Authorization headers
axios.interceptors.request.use((config) => {
  config.withCredentials = true;

  const authHeader = config.headers?.Authorization || config.headers?.authorization;
  if (typeof authHeader === 'string') {
    const trimmed = authHeader.trim();
    if (
      trimmed === 'Bearer' ||
      trimmed === 'Bearer null' ||
      trimmed === 'Bearer undefined' ||
      trimmed === 'Bearer cookie-session' ||
      trimmed.includes('cookie-session')
    ) {
      if (config.headers?.Authorization) delete config.headers.Authorization;
      if (config.headers?.authorization) delete config.headers.authorization;
    }
  }
  return config;
});

// Wrap native window.fetch to guarantee credentials: 'include' on all cross-subdomain API & file requests
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  const isApiCall =
    url.includes('/api/') ||
    url.startsWith('/api') ||
    url.includes('/api') ||
    url.includes('api.cloudguard.site') ||
    url.includes('cloudguard.site') ||
    url.includes('localhost:5000') ||
    (API_BASE_URL && url.startsWith(API_BASE_URL));

  if (!isApiCall) return originalFetch(input, init);

  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  const authVal = headers.get('Authorization') || headers.get('authorization') || '';
  if (/^Bearer\s+(null|undefined|cookie-session|\[object Object\]|)$/i.test(authVal.trim())) {
    headers.delete('Authorization');
    headers.delete('authorization');
  }

  return originalFetch(input, {
    ...init,
    credentials: init.credentials || 'include',
    headers,
  });
};

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Global PWA BeforeInstallPrompt Capture
window.__deferredPwaPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__deferredPwaPrompt = e;
  window.dispatchEvent(new CustomEvent('cloudguard:pwa-prompt-ready'));
});

window.addEventListener('appinstalled', () => {
  window.__deferredPwaPrompt = null;
  window.dispatchEvent(new CustomEvent('cloudguard:pwa-installed'));
});

// Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('PWA Service Worker registration skipped:', err);
    });
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <BrowserRouter>
        <ToastProvider>
          <DownloadProvider>
            <UploadProvider>
              <App />
            </UploadProvider>
          </DownloadProvider>
        </ToastProvider>
      </BrowserRouter>
    </GoogleOAuthProvider>
  </StrictMode>,
)
