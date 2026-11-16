const mongoose = require('mongoose');

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

module.exports = mongoose.model('DeletedAccountLog', deletedAccountLogSchema);
