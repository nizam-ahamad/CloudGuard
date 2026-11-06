const mongoose = require('mongoose');
const { buildTenantQuery } = require('../utils/tenantQuery');

/**
 * Middleware factory to ensure the requested document exists AND belongs to the authenticated user.
 * Returns 404 (not 403) to avoid leaking the existence of other users' resources.
 */
function verifyOwnership(Model, idParamName = 'id') {
  return async (req, res, next) => {
    try {
      const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
      const resourceId = req.params[idParamName];

      if (!resourceId || !mongoose.Types.ObjectId.isValid(resourceId)) {
        return res.status(400).json({ error: 'Invalid resource ID' });
      }

      const query = buildTenantQuery(rawUserId, {
        _id: new mongoose.Types.ObjectId(resourceId),
        isTrash: { $ne: true },
      });

      const document = await Model.findOne(query);
      if (!document) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      // Attach verified document to request for controller use
      req.verifiedResource = document;
      next();
    } catch (err) {
      console.error('Ownership verification error:', err.message);
      return res.status(500).json({ error: 'Authorization check failed' });
    }
  };
}

module.exports = { verifyOwnership };

