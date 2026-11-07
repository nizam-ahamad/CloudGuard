// Native browser Web Crypto SHA-256 generator
export async function computeFileSHA256(file) {
  try {
    if (!file) return null;
    // Files <= 50MB: hash the entire ArrayBuffer
    if (file.size <= 50 * 1024 * 1024) {
      const arrayBuffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
    // Files > 50MB: fingerprint the first 10MB slice for rapid header analysis
    const slice = file.slice(0, 10 * 1024 * 1024);
    const arrayBuffer = await slice.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (err) {
    console.warn('[CloudGuard Security] Client SHA-256 calculation fallback:', err.message);
    return null;
  }
}

export const computeSHA256 = computeFileSHA256;
