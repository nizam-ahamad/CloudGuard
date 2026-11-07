import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import './index.css'
import App from './App.jsx'
import { ToastProvider } from './context/ToastContext'
import { DownloadProvider } from './context/DownloadContext'
import { UploadProvider } from './context/UploadContext'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

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
