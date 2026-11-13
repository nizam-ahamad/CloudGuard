const jwt = require('jsonwebtoken');
const User = require('../models/User');

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
    let userId = req.user?.id || req.user?._id;

    if (!userId) {
      const token = req.headers.authorization?.split(' ')[1] || req.query?.token;
      if (!token) {
        return res.status(404).json({ error: 'Not found' });
      }

      const secret = process.env.JWT_SECRET;
      if (!secret) {
        return res.status(404).json({ error: 'Not found' });
      }

      try {
        const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
        req.user = decoded;
        userId = decoded?.id || decoded?._id || decoded?.userId;
      } catch (jwtErr) {
        return res.status(404).json({ error: 'Not found' });
      }
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
