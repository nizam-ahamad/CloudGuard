const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
  const token = req.cookies?.cg_auth_token || req.headers?.authorization?.split(' ')[1] || req.query?.token;
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
