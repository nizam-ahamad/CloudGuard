const mongoose = require('mongoose');

const shareSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    recipientEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    itemType: {
      type: String,
      enum: ['file', 'folder'],
      required: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    permission: {
      type: String,
      enum: ['viewer'],
      default: 'viewer',
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

shareSchema.index(
  { ownerId: 1, recipientId: 1, itemType: 1, itemId: 1 },
  { unique: true }
);

module.exports = mongoose.models.Share || mongoose.model('Share', shareSchema);
