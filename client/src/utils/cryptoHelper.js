// client/src/utils/cryptoHelper.js
export async function computeFileSHA256(file) {
  try {
    if (!file || !file.size || file.size === 0) return null;
    // On memory-constrained mobile/Safari browsers, reading files > 50 MB into RAM
    // causes memory exhaustion and drops temporary Photo Library file handles
    if (file.size > 50 * 1024 * 1024) {
      return null;
    }
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    console.warn('[CloudGuard Security] Client SHA-256 calculation fallback:', err.message);
    return null;
  }
}

export const computeSHA256 = computeFileSHA256;
