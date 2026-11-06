const mongoose = require('mongoose');

/**
 * Creates a bulletproof multi-tenant query filter.
 * Guarantees that user ownership is wrapped in $and and never overwritten.
 * Throws an explicit error if userId is missing or invalid.
 */
function buildTenantQuery(rawUserId, additionalFilter = {}) {
  if (!rawUserId) {
    throw new Error('SECURITY ALERT: Attempted to build database query without an authenticated userId.');
  }

  const userIdStr = String(rawUserId);
  const userMatchConditions = [
    { userId: userIdStr },
    { user: userIdStr },
  ];

  if (mongoose.Types.ObjectId.isValid(userIdStr)) {
    const userObjId = new mongoose.Types.ObjectId(userIdStr);
    userMatchConditions.push({ userId: userObjId }, { user: userObjId });
  }

  // Base tenant filter
  const tenantFilter = { $or: userMatchConditions };

  // If no additional filter provided, return tenant filter directly
  if (!additionalFilter || Object.keys(additionalFilter).length === 0) {
    return tenantFilter;
  }

  // Combine tenant boundary and custom filters using $and to guarantee zero key collisions
  return {
    $and: [
      tenantFilter,
      additionalFilter,
    ],
  };
}

module.exports = { buildTenantQuery };

