import axios from 'axios';
import { API_BASE_URL } from '../config';

const ACCESS_URL_TTL = 25 * 60 * 1000; // 25 minutes TTL
const accessCache = new Map(); // fileId -> { url: string, expiresAt: number }
const inFlightPrefetches = new Map(); // fileId -> Promise<string | null>

/**
 * Returns cached access URL if still valid (< 25 minutes old).
 */
export const getCachedAccessUrl = (fileId) => {
  if (!fileId) return null;
  const idStr = String(fileId);
  const entry = accessCache.get(idStr);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.url;
  }
  if (entry) {
    accessCache.delete(idStr);
  }
  return null;
};

/**
 * Stores an access URL in the client-side cache.
 */
export const setCachedAccessUrl = (fileId, url) => {
  if (!fileId || !url) return;
  accessCache.set(String(fileId), {
    url,
    expiresAt: Date.now() + ACCESS_URL_TTL,
  });
};

/**
 * Fetches the secure access URL for a file, reusing cache or in-flight requests.
 */
export const fetchAccessUrl = async (fileId, token) => {
  if (!fileId) return null;
  const idStr = String(fileId);

  const cached = getCachedAccessUrl(idStr);
  if (cached) return cached;

  // Deduplicate concurrent requests for the exact same file
  if (inFlightPrefetches.has(idStr)) {
    return inFlightPrefetches.get(idStr);
  }

  const fetchPromise = (async () => {
    try {
      const authToken = token || (typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null);
      const res = await axios.get(`${API_BASE_URL}/api/files/${idStr}/access`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      const url = res.data?.accessUrl || res.data?.url || res.data?.downloadUrl;
      if (url) {
        setCachedAccessUrl(idStr, url);
      }
      return url || null;
    } catch (err) {
      console.warn(`[accessUrlCache] Failed to fetch access URL for ${idStr}:`, err?.message || err);
      return null;
    } finally {
      inFlightPrefetches.delete(idStr);
    }
  })();

  inFlightPrefetches.set(idStr, fetchPromise);
  return fetchPromise;
};

/**
 * Silent, non-blocking hover prefetch for file rows / cards.
 * Triggers once per file within TTL, deduplicating concurrent hovers.
 */
export const prefetchAccessUrl = (fileId, token) => {
  if (!fileId) return;
  const idStr = String(fileId);
  if (getCachedAccessUrl(idStr) || inFlightPrefetches.has(idStr)) return;

  fetchAccessUrl(idStr, token).catch(() => {});
};

