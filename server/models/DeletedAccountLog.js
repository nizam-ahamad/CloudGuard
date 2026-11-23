const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Computes a salted HMAC-SHA256 digest of normalized email for DPDP-compliant deletion audit log.
 * Stores zero plaintext PII while permanently preventing repeat trial & refund abuse.
 */
function hashDeletedEmail(email) {
  const normalized = String(email || '').toLowerCase().trim();
  const salt = process.env.JWT_SECRET || 'cloudguard_dpdp_salt';
  return crypto.createHmac('sha256', salt).update(normalized).digest('hex');
}

const deletedAccountLogSchema = new mongoose.Schema(
  {
    emailHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    hadTrial: {
      type: Boolean,
      default: true,
    },
    claimedRefund: {
      type: Boolean,
      default: false,
    },
    refundCount: {
      type: Number,
      default: 0,
    },
    deletedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false }
);

const DeletedAccountLog =
  mongoose.models.DeletedAccountLog || mongoose.model('DeletedAccountLog', deletedAccountLogSchema);

DeletedAccountLog.hashDeletedEmail = hashDeletedEmail;

module.exports = DeletedAccountLog;
module.exports.hashDeletedEmail = hashDeletedEmail;

