export const API_BASE_URL = import.meta.env.PROD 
  ? '' 
  : (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' 
      ? '' 
      : 'http://localhost:5000');
