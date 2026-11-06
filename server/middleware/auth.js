const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  if (req.user) return next();
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Access denied. Please log in.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'cloudguard-super-secret-jwt-key-2024');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

module.exports = authMiddleware;

