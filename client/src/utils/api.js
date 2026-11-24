import axios from 'axios';
import { API_BASE_URL } from '../config';

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  if (token && token !== 'null' && token !== 'undefined' && token !== 'cookie-session') {
    config.headers.Authorization = `Bearer ${token}`;
  } else if (config.headers?.Authorization) {
    delete config.headers.Authorization;
  }
  config.withCredentials = true;
  return config;
});

export default api;

