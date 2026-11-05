const mongoose = require('mongoose');

const folderSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
    parentFolder: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
    isTrash: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    versionKey: false, // Disables __v to save document storage space
    timestamps: false,
  }
);

// High-speed directory tree index & duplicate folder name prevention
folderSchema.index({ userId: 1, parentId: 1, isTrash: 1 });
folderSchema.index({ userId: 1, parentId: 1, name: 1 }, { unique: true });

module.exports = mongoose.models.Folder || mongoose.model('Folder', folderSchema);
