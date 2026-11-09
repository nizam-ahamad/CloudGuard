const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  if (req.user) return next();
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Access denied. Please log in.' });

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('FATAL: JWT_SECRET environment variable is not defined.');
    return res.status(500).json({ success: false, error: 'Authentication configuration error.' });
  }

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

module.exports = authMiddleware;

