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
    // Explicitly ignore invalid literal values
    if (
      val &&
      val !== 'null' &&
      val !== 'undefined' &&
      val !== 'cookie-session' &&
      val !== '[object Object]'
    ) {
      return val;
    }
  }
  return null;
};

const authMiddleware = async (req, res, next) => {
  // 1. Prioritize HttpOnly cookie (parsed by cookie middleware or raw header fallback)
  let token = req.cookies?.cg_auth_token || parseTokenFromRawCookie(req.headers?.cookie);

  // 2. Fall back to Authorization Bearer header if valid
  if (!token) {
    token = parseTokenFromAuthHeader(req.headers?.authorization || req.headers?.Authorization);
  }

  // 3. Fall back to query parameter token if valid
  if (!token && req.query?.token) {
    const qToken = String(req.query.token).trim();
    if (qToken && qToken !== 'null' && qToken !== 'undefined' && qToken !== 'cookie-session') {
      token = qToken;
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Access denied. Please log in.', message: 'Access denied. Please log in.' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('FATAL: JWT_SECRET environment variable is not defined.');
    return res.status(500).json({ success: false, error: 'Authentication configuration error.' });
  }

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    const userId = decoded.userId || decoded.id || decoded._id;

    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload.', message: 'Invalid token payload.' });
    }

    const dbUser = await User.findById(userId)
      .select('_id email name role isAdmin plan storageLimit storageUsed isVerified tokenVersion subscription')
      .lean();

    if (!dbUser) {
      return res.status(401).json({
        error: 'Account no longer exists. Session invalidated.',
        message: 'Account no longer exists. Session invalidated.'
      });
    }

    if (dbUser.isVerified === false) {
      return res.status(401).json({
        error: 'Account not verified.',
        message: 'Account not verified.'
      });
    }

    const tokenVer = decoded.tokenVersion ?? 0;
    const dbVer = dbUser.tokenVersion ?? 0;

    if (tokenVer !== dbVer) {
      return res.status(401).json({
        error: 'Session expired or logged out. Please sign in again.',
        message: 'Session expired or logged out. Please sign in again.'
      });
    }

    req.user = {
      ...decoded,
      _id: dbUser._id,
      id: dbUser._id.toString(),
      userId: dbUser._id.toString(),
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role,
      isAdmin: Boolean(dbUser.isAdmin),
      plan: dbUser.plan,
      storageLimit: dbUser.storageLimit,
      storageUsed: dbUser.storageUsed,
      isVerified: dbUser.isVerified,
      tokenVersion: dbVer,
      subscription: dbUser.subscription
    };

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.', message: 'Invalid or expired token.' });
  }
};

module.exports = authMiddleware;
