const envApiUrl = import.meta.env.VITE_API_URL
  ? String(import.meta.env.VITE_API_URL).trim().replace(/\/+$/, '')
  : '';

export const API_BASE_URL = envApiUrl || (
  (typeof window !== 'undefined' && window.location.hostname.endsWith('cloudguard.site')) || import.meta.env.PROD 
    ? 'https://api.cloudguard.site' 
    : 'http://localhost:5000'
);

