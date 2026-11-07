// Native browser Web Crypto SHA-256 generator
export async function computeFileSHA256(file) {
  try {
    if (!file) return null;
    // Hash the entire file so the signature matches PowerShell, whitelists, and threat databases
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
