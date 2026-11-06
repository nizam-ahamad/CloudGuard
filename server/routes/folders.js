const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Folder = require('../models/Folder');
const authMiddleware = require('../middleware/auth');

// -------------------------------------------------------------
// 1. DEDICATED MOVE ROUTE (PUT & PATCH /:id/move)
// -------------------------------------------------------------
const handleMoveFolder = async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id;
    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    const folderId = req.params.id;
    const { parentId, parentFolder, destinationId, targetFolderId } = req.body;

    // Resolve target destination (null = Home / Root)
    const rawTarget = parentId !== undefined ? parentId : (parentFolder !== undefined ? parentFolder : (destinationId !== undefined ? destinationId : targetFolderId));
    const targetParentId = !rawTarget || rawTarget === 'null' || rawTarget === 'undefined' || rawTarget === 'root' ? null : rawTarget;

    // 1. Guard against circular moving (cannot move a folder into itself)
    if (folderId === targetParentId) {
      return res.status(400).json({ error: 'Cannot move a folder into itself' });
    }

    const userQuery = [
      { userId: userIdObj },
      { user: userIdObj },
      { userId: String(rawUserId) },
      { user: String(rawUserId) },
    ];

    // 2. Query folder matching either `user` or `userId` and ensuring not in trash
    const folder = await Folder.findOne({
      _id: folderId,
      isTrash: { $ne: true },
      $or: userQuery,
    });

    if (!folder) {
      return res.status(404).json({ error: 'Folder not found or unauthorized' });
    }

    // 3. If moving into another folder, verify the destination folder exists and belongs to the user
    if (targetParentId) {
      const destinationFolder = await Folder.findOne({
        _id: targetParentId,
        isTrash: { $ne: true },
        $or: userQuery,
      });

      if (!destinationFolder) {
        return res.status(404).json({ error: 'Destination folder not found' });
      }

      // Guard against moving a folder into its own subfolder
      let currentCheck = targetParentId;
      const visited = new Set();
      while (currentCheck && !visited.has(String(currentCheck))) {
        if (String(currentCheck) === String(folderId)) {
          return res.status(400).json({ error: 'Cannot move a folder into its own subfolder' });
        }
        visited.add(String(currentCheck));
        const pFolder = await Folder.findOne({
          _id: currentCheck,
          isTrash: { $ne: true },
          $or: userQuery,
        }).lean();
        currentCheck = pFolder ? (pFolder.parentId || pFolder.parentFolder) : null;
      }
    }

    // 4. Update both pointer variants for universal compatibility
    folder.parentId = targetParentId;
    folder.parentFolder = targetParentId;
    await folder.save();

    return res.status(200).json({
      success: true,
      message: 'Folder moved successfully',
      folder,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'A folder with this name already exists in the destination' });
    }
    console.error('Error moving folder:', err);
    return res.status(500).json({ error: 'Failed to move folder' });
  }
};

router.put('/:id/move', authMiddleware, handleMoveFolder);
router.patch('/:id/move', authMiddleware, handleMoveFolder);

// -------------------------------------------------------------
// 2. GENERAL UPDATE / RENAME (Name is optional; handles move if name omitted)
// -------------------------------------------------------------
const handleFolderUpdate = async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id;
    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    const userQuery = [
      { userId: userIdObj },
      { user: userIdObj },
      { userId: String(rawUserId) },
      { user: String(rawUserId) },
    ];

    const { name, newName, parentId, parentFolder, destinationId, targetFolderId } = req.body;
    const trimmedName = (name || newName || '').trim();

    // If no name is provided, but a move destination is provided, execute move
    if (!trimmedName && (parentId !== undefined || parentFolder !== undefined || destinationId !== undefined || targetFolderId !== undefined)) {
      return handleMoveFolder(req, res);
    }

    if (!trimmedName) {
      return res.status(400).json({ error: 'Folder name cannot be empty' });
    }

    const folder = await Folder.findOne({
      _id: req.params.id,
      isTrash: { $ne: true },
      $or: userQuery,
    });

    if (!folder) {
      return res.status(404).json({ error: 'Folder not found or unauthorized' });
    }

    if (folder.name === trimmedName) {
      return res.json({ success: true, folder });
    }

    // Check for duplicate in the same parent directory
    const existingDuplicate = await Folder.findOne({
      _id: { $ne: req.params.id },
      parentId: folder.parentId || null,
      name: trimmedName,
      isTrash: { $ne: true },
      $or: userQuery,
    });

    if (existingDuplicate) {
      return res.status(409).json({
        error: `A folder named "${trimmedName}" already exists in this directory.`,
      });
    }

    folder.name = trimmedName;
    await folder.save();

    return res.json({ success: true, folder });
  } catch (err) {
    console.error('Folder update error:', err);
    return res.status(500).json({ error: 'Failed to update folder' });
  }
};

router.put('/:id/rename', authMiddleware, handleFolderUpdate);
router.patch('/:id/rename', authMiddleware, handleFolderUpdate);
router.put('/:id', authMiddleware, handleFolderUpdate);
router.patch('/:id', authMiddleware, handleFolderUpdate);

// -------------------------------------------------------------
// 3. BATCH MOVE ROUTE (PUT /move-batch & POST /move-batch)
// -------------------------------------------------------------
router.put('/move-batch', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id;
    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    const userQuery = [
      { userId: userIdObj },
      { user: userIdObj },
      { userId: String(rawUserId) },
      { user: String(rawUserId) },
    ];

    const { folderIds = [], fileIds = [], targetFolderId = null } = req.body;
    const dest = targetFolderId === 'null' || targetFolderId === 'root' || !targetFolderId ? null : targetFolderId;

    const File = require('../models/File');

    if (fileIds.length > 0) {
      await File.updateMany(
        { _id: { $in: fileIds }, $or: userQuery },
        { $set: { folder: dest, folderId: dest } }
      );
    }

    if (folderIds.length > 0) {
      await Folder.updateMany(
        { _id: { $in: folderIds }, $or: userQuery },
        { $set: { parentId: dest, parentFolder: dest } }
      );
    }

    return res.json({ success: true, message: 'Items moved successfully' });
  } catch (err) {
    console.error('Batch move error:', err);
    return res.status(500).json({ error: 'Failed to move items' });
  }
});

module.exports = router;
