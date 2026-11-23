const crypto = require('crypto');
const { applyCdnToUrl } = require('./cdnHelper');

/**
 * Generates an HMAC-SHA256 signed payload for CDN edge validation.
 * Format: ${userId}.${exp}.${hmacHex}
 */
function signEdgePayload(userId, ttlSeconds = 86400) {
  const uid = String(userId || '');
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${uid}.${exp}`;
  const secret = process.env.CDN_EDGE_SECRET || process.env.JWT_SECRET || 'cloudguard_edge_secret';
  const hmacHex = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${hmacHex}`;
}

/**
 * Attaches the HttpOnly cg_vault_session edge cookie for files.cloudguard.site access.
 */
function attachVaultEdgeCookie(res, userId) {
  if (!res || !userId) return;
  const token = signEdgePayload(userId, 86400);
  const isProd = process.env.NODE_ENV === 'production';
  const cookieOptions = isProd
    ? { httpOnly: true, secure: true, sameSite: 'none', domain: '.cloudguard.site', path: '/', maxAge: 86400 * 1000 }
    : { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 86400 * 1000 };
  res.cookie('cg_vault_session', token, cookieOptions);
}

/**
 * Clears the cg_vault_session edge cookie across production and local domains.
 */
function clearVaultEdgeCookie(res) {
  if (!res) return;
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    res.clearCookie('cg_vault_session', { domain: '.cloudguard.site', path: '/', secure: true, sameSite: 'none' });
  }
  res.clearCookie('cg_vault_session', { path: '/' });
}

/**
 * Rewrites S3 presigned URL to CDN download domain and appends _cgt for localhost:5173.
 */
function formatCdnDownloadUrl(rawUrl, req, userId) {
  let url = applyCdnToUrl(rawUrl);
  if (!url) return url;
  const origin = req?.headers?.origin || (typeof req?.get === 'function' ? req.get('origin') : '') || '';
  if (origin === 'http://localhost:5173' && userId) {
    const edgeToken = signEdgePayload(userId, 120);
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}_cgt=${encodeURIComponent(edgeToken)}`;
  }
  return url;
}

module.exports = {
  signEdgePayload,
  attachVaultEdgeCookie,
  clearVaultEdgeCookie,
  formatCdnDownloadUrl,
};
