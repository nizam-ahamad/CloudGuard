const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Folder = require('../models/Folder');
const File = require('../models/File');
const User = require('../models/User');
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
// 3. UNIVERSAL BATCH MOVE ROUTE (POST & PUT on /move-batch & /batch-move)
// -------------------------------------------------------------
const handleBatchMove = async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id || req.user.userId;
    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    const userQuery = {
      $or: [
        { userId: userIdObj },
        { user: userIdObj },
        { userId: String(rawUserId) },
        { user: String(rawUserId) },
      ],
    };

    // 1. Defensively parse destination folder (null = Home / Root)
    const rawDest =
      req.body.destinationId !== undefined
        ? req.body.destinationId
        : req.body.targetFolderId !== undefined
        ? req.body.targetFolderId
        : req.body.parentId !== undefined
        ? req.body.parentId
        : req.body.folderId !== undefined
        ? req.body.folderId
        : req.body.destinationFolderId;

    const targetDestinationId =
      !rawDest || rawDest === 'null' || rawDest === 'undefined' || rawDest === 'root' ? null : String(rawDest);

    // If destination is a folder, verify it exists and belongs to the user
    if (targetDestinationId) {
      const destFolder = await Folder.findOne({
        _id: targetDestinationId,
        isTrash: { $ne: true },
        ...userQuery,
      });
      if (!destFolder) {
        return res.status(404).json({ error: 'Destination folder not found or unauthorized' });
      }
    }

    // 2. Extract item IDs from any payload structure
    let folderIds = [];
    let fileIds = [];

    // Case A: Explicit folderIds and fileIds arrays
    if (Array.isArray(req.body.folderIds)) folderIds.push(...req.body.folderIds);
    if (Array.isArray(req.body.fileIds)) fileIds.push(...req.body.fileIds);

    // Case B: Generic items or itemIds array (strings or objects with .type / .isFolder)
    const rawItems = req.body.items || req.body.itemIds || req.body.selectedItems || [];
    if (Array.isArray(rawItems)) {
      for (const item of rawItems) {
        if (!item) continue;
        if (typeof item === 'string') {
          // Check if ID matches a folder first, otherwise treat as file
          const isFolder = await Folder.exists({ _id: item, ...userQuery });
          if (isFolder) folderIds.push(item);
          else fileIds.push(item);
        } else if (typeof item === 'object') {
          const id = item._id || item.id;
          if (!id) continue;
          if (item.type === 'folder' || item.isFolder) {
            folderIds.push(id);
          } else {
            fileIds.push(id);
          }
        }
      }
    }

    // Deduplicate IDs
    folderIds = [...new Set(folderIds.map(String))];
    fileIds = [...new Set(fileIds.map(String))];

    // Prevent circular moving: cannot move destination into itself
    if (targetDestinationId && folderIds.includes(targetDestinationId)) {
      return res.status(400).json({ error: 'Cannot move a folder into itself' });
    }

    let movedFoldersCount = 0;
    let movedFilesCount = 0;

    // 3. Execute Folder Updates
    if (folderIds.length > 0) {
      const folderRes = await Folder.updateMany(
        {
          _id: { $in: folderIds },
          isTrash: { $ne: true },
          ...userQuery,
        },
        {
          $set: {
            parentId: targetDestinationId,
            parentFolder: targetDestinationId,
          },
        }
      );
      movedFoldersCount = folderRes.modifiedCount || 0;
    }

    // 4. Execute File Updates
    if (fileIds.length > 0) {
      const fileRes = await File.updateMany(
        {
          _id: { $in: fileIds },
          isTrash: { $ne: true },
          ...userQuery,
        },
        {
          $set: {
            folder: targetDestinationId,
            folderId: targetDestinationId,
          },
        }
      );
      movedFilesCount = fileRes.modifiedCount || 0;
    }

    return res.status(200).json({
      success: true,
      message: `Successfully moved ${movedFoldersCount} folder(s) and ${movedFilesCount} file(s).`,
      movedFoldersCount,
      movedFilesCount,
    });
  } catch (err) {
    console.error('Batch move error:', err);
    return res.status(500).json({ error: err.message || 'Failed to complete batch move' });
  }
};

// Mount across all possible URL variants to prevent 404/500 routing mismatches
router.post('/move-batch', authMiddleware, handleBatchMove);
router.put('/move-batch', authMiddleware, handleBatchMove);
router.post('/batch-move', authMiddleware, handleBatchMove);
router.put('/batch-move', authMiddleware, handleBatchMove);


// -------------------------------------------------------------
// 4. SOFT-DELETE FOLDER
// -------------------------------------------------------------
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id || req.user.userId;
    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    const userMatch = {
      $or: [
        { userId: userIdObj },
        { user: userIdObj },
        { userId: String(rawUserId) },
        { user: String(rawUserId) },
      ],
    };

    const folder = await Folder.findOne({
      _id: req.params.id,
      ...userMatch,
    });

    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    folder.isTrash = true;
    folder.trashedAt = new Date();
    await folder.save();

    // Mark children files as trashed
    const folderIdObj = mongoose.Types.ObjectId.isValid(folder._id)
      ? new mongoose.Types.ObjectId(folder._id)
      : folder._id;

    await File.updateMany(
      {
        $or: [
          { folder: folderIdObj },
          { folderId: folderIdObj },
          { folder: String(folder._id) },
          { folderId: String(folder._id) },
        ],
        ...userMatch,
      },
      { $set: { isTrash: true, trashedAt: new Date() } }
    );

    // Recalculate user storage quota
    const stats = await File.aggregate([
      {
        $match: {
          isTrash: { $ne: true },
          securityStatus: { $ne: 'threat_purged' },
          ...userMatch,
        },
      },
      {
        $group: {
          _id: null,
          actualUsedBytes: { $sum: { $ifNull: ['$size', 0] } },
        },
      },
    ]);
    const actualStorageUsed = stats[0]?.actualUsedBytes || 0;
    await User.findByIdAndUpdate(rawUserId, { storageUsed: actualStorageUsed });

    return res.status(200).json({ success: true, message: 'Folder deleted' });
  } catch (err) {
    console.error('Delete folder error:', err);
    return res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// -------------------------------------------------------------
// 5. BATCH DELETE & RESTORE (COMPATIBILITY)
// -------------------------------------------------------------
router.post('/delete-batch', authMiddleware, (req, res, next) => require('./files').handleBatchDelete(req, res, next));
router.post('/batch-delete', authMiddleware, (req, res, next) => require('./files').handleBatchDelete(req, res, next));
router.post('/restore-batch', authMiddleware, (req, res, next) => require('./files').handleBatchRestore(req, res, next));
router.post('/batch-restore', authMiddleware, (req, res, next) => require('./files').handleBatchRestore(req, res, next));

// -------------------------------------------------------------
// 6. FOLDER DETAILS AGGREGATION
// -------------------------------------------------------------
const handleFolderDetails = async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id || req.user.userId;
    const folderId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      return res.status(400).json({ error: 'Invalid folder ID' });
    }

    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    const userMatch = {
      $or: [
        { userId: userIdObj },
        { user: userIdObj },
        { userId: String(rawUserId) },
        { user: String(rawUserId) },
      ],
    };

    const folder = await Folder.findOne({
      _id: folderId,
      isTrash: { $ne: true },
      ...userMatch,
    }).lean();

    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const folderObjectId = new mongoose.Types.ObjectId(folderId);

    // 1. Count actual child subfolders inside this directory
    const subfolderCount = await Folder.countDocuments({
      isTrash: { $ne: true },
      ...userMatch,
      $or: [
        { parentId: folderObjectId },
        { parentFolder: folderObjectId },
        { parentId: folderId },
        { parentFolder: folderId },
      ],
    });

    // 2. Aggregate all active files inside this directory (robust size casting)
    const fileStats = await File.aggregate([
      {
        $match: {
          isTrash: { $ne: true },
          securityStatus: { $ne: 'threat_purged' },
          $and: [
            userMatch,
            {
              $or: [
                { folder: folderObjectId },
                { folderId: folderObjectId },
                { folder: folderId },
                { folderId: folderId },
              ],
            },
          ],
        },
      },
      {
        $group: {
          _id: null,
          totalFiles: { $sum: 1 },
          totalBytes: {
            $sum: {
              $convert: {
                input: '$size',
                to: 'double',
                onError: 0,
                onNull: 0,
              },
            },
          },
        },
      },
    ]);

    const totalFiles = fileStats[0]?.totalFiles || 0;
    const totalBytes = fileStats[0]?.totalBytes || 0;

    return res.status(200).json({
      success: true,
      folder: {
        ...folder,
        fileCount: totalFiles,
        folderCount: subfolderCount,
        totalFiles,
        totalFolders: subfolderCount,
        subfolderCount,
        totalSize: totalBytes,
        size: totalBytes,
      },
      fileCount: totalFiles,
      folderCount: subfolderCount,
      totalFiles,
      totalFolders: subfolderCount,
      subfolderCount,
      totalSize: totalBytes,
      size: totalBytes,
    });
  } catch (err) {
    console.error('Error fetching folder details:', err);
    return res.status(500).json({ error: 'Failed to calculate folder details' });
  }
};

// GET /api/folders - Strictly exclude trashed folders
router.get('/', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    const parent = req.query.parentId || req.query.folderId || null;

    const parentId =
      parent && parent !== 'null' && mongoose.Types.ObjectId.isValid(parent)
        ? new mongoose.Types.ObjectId(parent)
        : null;

    const userMatch = {
      $or: [
        { userId: rawUserId },
        { user: rawUserId },
      ],
    };

    const filter = {
      ...userMatch,
      isTrash: { $ne: true },
    };

    if (req.query.all !== 'true') {
      filter.parentId = parentId || null;
    }

    // STRICT: Only return folders that are NOT trashed
    const folders = await Folder.find(filter)
      .sort({ name: 1 })
      .lean();

    return res.status(200).json(folders);
  } catch (err) {
    console.error('Error fetching folders:', err);
    return res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

// DELETE /api/folders/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    const folderId = req.params.id;

    // Strict validation: reject non-ObjectIds immediately
    if (!folderId || !mongoose.Types.ObjectId.isValid(folderId)) {
      return res.status(400).json({ error: 'Invalid folder ID' });
    }

    const folderObjectId = new mongoose.Types.ObjectId(folderId);
    const userMatch = { $or: [{ userId: rawUserId }, { user: rawUserId }] };

    // 1. Delete or trash the targeted folder
    const folder = await Folder.findOne({ _id: folderObjectId, ...userMatch });
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    // Mark folder as trashed
    folder.isTrash = true;
    folder.trashedAt = new Date();
    await folder.save();

    // 2. Cascade ONLY to children of THIS SPECIFIC folder (guarded with valid ObjectId)
    await File.updateMany(
      {
        $or: [{ folder: folderObjectId }, { folderId: folderObjectId }],
        ...userMatch,
      },
      { $set: { isTrash: true, trashedAt: new Date() } }
    );

    await Folder.updateMany(
      {
        $or: [{ parentId: folderObjectId }, { parentFolder: folderObjectId }],
        ...userMatch,
      },
      { $set: { isTrash: true, trashedAt: new Date() } }
    );

    return res.status(200).json({
      success: true,
      message: 'Folder and contents deleted successfully',
      folderId: folder._id,
    });
  } catch (err) {
    console.error('Delete folder error:', err);
    return res.status(500).json({ error: 'Failed to delete folder' });
  }
});

router.get('/:id/details', authMiddleware, handleFolderDetails);
router.get('/:id/stats', authMiddleware, handleFolderDetails);

module.exports = router;
module.exports.handleBatchMove = handleBatchMove;
