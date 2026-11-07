const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    originalName: { type: String },
    sanitizedName: { type: String },
    diskName: { type: String },
    size: { type: Number, required: true },
    mimetype: { type: String },
    mimeType: { type: String },
    s3Key: { type: String, required: true },
    location: { type: String },
    relativePath: { type: String },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    folder: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
    folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
    isTrash: { type: Boolean, default: false },
    trashedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    isMalicious: { type: Boolean, default: false },
    status: { type: String, default: 'safe' },
    securityStatus: { type: String, default: 'clean' },
    uploadedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  {
    versionKey: false, // Disables __v to save document storage space
    timestamps: false,
  }
);

// High-speed compound indexes matching exact queries
fileSchema.index({ userId: 1, folder: 1, isTrash: 1 });
fileSchema.index({ userId: 1, folderId: 1, isTrash: 1 });
fileSchema.index({ userId: 1, uploadedAt: -1 });

module.exports = mongoose.models.File || mongoose.model('File', fileSchema);
