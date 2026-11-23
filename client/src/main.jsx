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

// Ensure cross-origin Set-Cookie (cg_vault_session) from api.cloudguard.site is sent & received on all API requests
axios.defaults.withCredentials = true;

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
