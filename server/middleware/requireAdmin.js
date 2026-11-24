const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Direct fallback parser on raw cookie header for cg_auth_token
 */
const parseTokenFromRawCookie = (rawCookie) => {
  if (typeof rawCookie !== 'string' || !rawCookie.includes('cg_auth_token=')) {
    return null;
  }
  const match = rawCookie.match(/(?:^|;\s*)cg_auth_token=([^;]+)/);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1].trim());
    } catch {
      return match[1].trim();
    }
  }
  return null;
};

/**
 * Extracts and validates Bearer token, ignoring invalid literal placeholders
 */
const parseTokenFromAuthHeader = (authHeader) => {
  if (typeof authHeader !== 'string') return null;
  const parts = authHeader.split(' ');
  if (parts.length >= 2 && /^bearer$/i.test(parts[0])) {
    const val = parts.slice(1).join(' ').trim();
    if (val && val !== 'null' && val !== 'undefined' && val !== 'cookie-session' && val !== '[object Object]') {
      return val;
    }
  }
  return null;
};

/**
 * Checks if an email is present in the comma-separated ADMIN_EMAILS environment variable.
 */
function isAdminEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const allowed = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

/**
 * Cloaked Admin Authorization Middleware
 * Returns 404 for unauthenticated, invalid, or non-admin requests so the route remains invisible.
 */
async function requireAdmin(req, res, next) {
  try {
    let userId = req.user?.id || req.user?._id || req.user?.userId;

    if (!userId) {
      let token = req.cookies?.cg_auth_token || parseTokenFromRawCookie(req.headers?.cookie);
      if (!token) {
        token = parseTokenFromAuthHeader(req.headers?.authorization || req.headers?.Authorization);
      }
      if (!token && req.query?.token) {
        const qToken = String(req.query.token).trim();
        if (qToken && qToken !== 'null' && qToken !== 'undefined' && qToken !== 'cookie-session') {
          token = qToken;
        }
      }

      if (!token) {
        return res.status(404).json({ error: 'Not found' });
      }

      const secret = process.env.JWT_SECRET || 'cloudguard_fallback_secret';

      try {
        const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
        req.user = decoded;
        userId = req.user?.id || req.user?._id || req.user?.userId;
      } catch (jwtErr) {
        return res.status(404).json({ error: 'Not found' });
      }
    }

    // If req.user.email is already present on the verified JWT payload and matches ADMIN_EMAILS, allow immediately
    if (req.user?.email && isAdminEmail(req.user.email)) {
      return next();
    }

    if (!userId) {
      return res.status(404).json({ error: 'Not found' });
    }

    const user = await User.findById(userId).select('email').lean();
    if (!user || !user.email || !isAdminEmail(user.email)) {
      return res.status(404).json({ error: 'Not found' });
    }

    req.user = { ...req.user, ...user, id: user._id };
    next();
  } catch (err) {
    return res.status(404).json({ error: 'Not found' });
  }
}

module.exports = requireAdmin;
module.exports.requireAdmin = requireAdmin;
module.exports.isAdminEmail = isAdminEmail;
