const envApiUrl = import.meta.env.VITE_API_URL
  ? String(import.meta.env.VITE_API_URL).trim().replace(/\/+$/, '')
  : '';

export const API_BASE_URL = envApiUrl || (
  import.meta.env.PROD 
    ? 'https://api.cloudguard.site' 
    : (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' 
        ? '' 
        : 'http://localhost:5000')
);

