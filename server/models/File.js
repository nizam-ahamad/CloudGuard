const mongoose = require('mongoose');

// File Metadata Schema
const FileSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
  name: { type: String, required: true },
  originalName: { type: String },
  s3Key: { type: String, required: true },
  location: { type: String },
  relativePath: { type: String },
  size: { type: Number },
  mimetype: { type: String },
  mimeType: { type: String },
  status: { type: String, default: 'safe' },
  securityStatus: { type: String, default: 'Safe' },
  isTrash: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  uploadedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

// Compound indexes for ultra-fast index-only scan on active files and media
FileSchema.index({ userId: 1, isTrash: 1, isDeleted: 1, uploadedAt: -1 });
FileSchema.index({ user: 1, isTrash: 1, isDeleted: 1, createdAt: -1 });
FileSchema.index({ userId: 1, folderId: 1 });
FileSchema.index({ user: 1, folder: 1, isTrash: 1 });
FileSchema.index({ user: 1, folderId: 1, isTrash: 1 });
FileSchema.index({ userId: 1, folderId: 1, isTrash: 1 });
FileSchema.index({ user: 1, createdAt: -1 });
FileSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.models.File || mongoose.model('File', FileSchema);
