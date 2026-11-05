const mongoose = require('mongoose');

// Folder Metadata Schema
const FolderSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  userId: { type: mongoose.Schema.Types.Mixed, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
  parentFolder: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
  isTrash: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Compound indexes to eliminate collection scans
FolderSchema.index({ user: 1, parentFolder: 1, isTrash: 1 });
FolderSchema.index({ userId: 1, parentId: 1, isTrash: 1 });
FolderSchema.index({ userId: 1, parentId: 1 });

module.exports = mongoose.models.Folder || mongoose.model('Folder', FolderSchema);

