const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { S3Client, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const Folder = require('../models/Folder');
const File = require('../models/File');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const { buildTenantQuery } = require('../utils/tenantQuery');
const { permanentlyDeleteS3Keys } = require('../utils/s3Delete');
const { validateVaultItemName } = require('../middleware/sanitize');

const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-central-003',
  ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// -------------------------------------------------------------
// 0. FOLDER CREATION (POST /)
// -------------------------------------------------------------
router.post('/', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(String(rawUserId))) {
      return res.status(401).json({ error: 'Unauthorized: Valid session required' });
    }

    // Write-lock enforcement
    const user = await User.findById(rawUserId).select('plan trialExpiresAt subscription').lean();
    if (user) {
      const now = new Date();
      if ((user.plan === 'trial' || user.subscription?.planId === 'trial') && user.trialExpiresAt && new Date(user.trialExpiresAt) <= now) {
        return res.status(403).json({
          error: 'Your 14-day evaluation trial has ended. Select a plan to restore write privileges.',
          code: 'TRIAL_EXPIRED',
        });
      }
      if (user.subscription?.status === 'past_due') {
        return res.status(403).json({
          error: 'Your vault is in a read-only grace period. Renew or upgrade your plan to resume folder modifications.',
          code: 'SUBSCRIPTION_PAST_DUE',
        });
      }
      if (user.subscription?.status === 'expired') {
        return res.status(403).json({
          error: 'Your subscription has expired. Select a plan on the Pricing page to resume folder modifications.',
          code: 'SUBSCRIPTION_EXPIRED',
        });
      }
    }

    const { name, parentId } = req.body;
    const validation = validateVaultItemName(name);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error, message: validation.error });
    }
    const trimmedName = validation.sanitized;
    if (trimmedName.length > 60) {
      return res.status(400).json({ error: 'Folder name must be between 1 and 60 characters', message: 'Folder name must be between 1 and 60 characters' });
    }

    const parent =
      parentId && parentId !== 'null' && parentId !== 'undefined' && parentId !== 'root' && mongoose.Types.ObjectId.isValid(parentId)
        ? new mongoose.Types.ObjectId(parentId)
        : null;

    if (parent) {
      const parentFolder = await Folder.findOne(
        buildTenantQuery(rawUserId, { _id: parent, isTrash: { $ne: true } })
      );
      if (!parentFolder) {
        return res.status(404).json({ success: false, error: 'Target parent folder not found or unauthorized' });
      }
    }

    // Query strictly for ACTIVE (non-trashed) folders with the same name in this directory
    const duplicateQuery = buildTenantQuery(rawUserId, {
      parentId: parent || null,
      name: trimmedName,
      isTrash: { $ne: true },
    });

    const existingFolder = await Folder.findOne(duplicateQuery);
    if (existingFolder) {
      return res.status(409).json({ error: 'A folder with this name already exists here' });
    }

    const userIdObj = new mongoose.Types.ObjectId(String(rawUserId));
    const newFolder = new Folder({
      name: trimmedName,
      userId: userIdObj,
      user: userIdObj,
      parentId: parent || null,
      parentFolder: parent || null,
      isTrash: false,
    });
    await newFolder.save();
    return res.status(201).json(newFolder);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A folder with this name already exists here' });
    }
    console.error('Error creating folder:', err);
    return res.status(500).json({ error: 'Failed to create folder' });
  }
});

// -------------------------------------------------------------
// 1. DEDICATED MOVE ROUTE (PUT & PATCH /:id/move)
// -------------------------------------------------------------
const handleMoveFolder = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(String(rawUserId))) {
      return res.status(401).json({ error: 'Unauthorized: Valid session required' });
    }
    const userIdObj = new mongoose.Types.ObjectId(String(rawUserId));

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
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(String(rawUserId))) {
      return res.status(401).json({ error: 'Unauthorized: Valid session required' });
    }
    const userIdObj = new mongoose.Types.ObjectId(String(rawUserId));

    const userQuery = [
      { userId: userIdObj },
      { user: userIdObj },
      { userId: String(rawUserId) },
      { user: String(rawUserId) },
    ];

    const { name, newName, parentId, parentFolder, destinationId, targetFolderId } = req.body;
    const rawName = (name || newName || '').trim();

    // If no name is provided, but a move destination is provided, execute move
    if (!rawName && (parentId !== undefined || parentFolder !== undefined || destinationId !== undefined || targetFolderId !== undefined)) {
      return handleMoveFolder(req, res);
    }

    const validation = validateVaultItemName(rawName);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error, message: validation.error });
    }
    const trimmedName = validation.sanitized;
    if (trimmedName.length > 60) {
      return res.status(400).json({ error: 'Folder name must be between 1 and 60 characters', message: 'Folder name must be between 1 and 60 characters' });
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

    // Check for duplicate in the same parent directory (ignoring trashed folders)
    const duplicateQuery = buildTenantQuery(rawUserId, {
      _id: { $ne: req.params.id },
      parentId: folder.parentId || null,
      name: trimmedName,
      isTrash: { $ne: true },
    });

    const existingDuplicate = await Folder.findOne(duplicateQuery);

    if (existingDuplicate) {
      return res.status(409).json({
        error: 'A folder with this name already exists here',
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
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(String(rawUserId))) {
      return res.status(401).json({ error: 'Unauthorized: Valid session required' });
    }
    const userIdObj = new mongoose.Types.ObjectId(String(rawUserId));

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
// 4. BATCH DELETE & RESTORE (COMPATIBILITY)
// -------------------------------------------------------------
router.post('/delete-batch', authMiddleware, (req, res, next) => require('./files').handleBatchDelete(req, res, next));
router.post('/batch-delete', authMiddleware, (req, res, next) => require('./files').handleBatchDelete(req, res, next));
router.post('/restore-batch', authMiddleware, (req, res, next) => require('./files').handleBatchRestore(req, res, next));
router.post('/batch-restore', authMiddleware, (req, res, next) => require('./files').handleBatchRestore(req, res, next));

// -------------------------------------------------------------
// 6. FOLDER DETAILS AGGREGATION & RECURSIVE DESCENDANTS
// -------------------------------------------------------------
// Helper to recursively collect all descendant subfolder IDs
async function getDescendantFolderIds(folderId, userMatch) {
  const visited = new Set([String(folderId)]);
  let currentLevelIds = [folderId];
  const allDescendants = [];

  while (currentLevelIds.length > 0) {
    const objectIds = currentLevelIds
      .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
      .map((id) => new mongoose.Types.ObjectId(String(id)));
    const stringIds = currentLevelIds.map((id) => String(id));

    const children = await Folder.find({
      $and: [
        userMatch,
        {
          isTrash: { $ne: true },
          $or: [
            { parentId: { $in: objectIds } },
            { parentFolder: { $in: objectIds } },
            { parentId: { $in: stringIds } },
            { parentFolder: { $in: stringIds } },
          ],
        },
      ],
    })
      .select('_id')
      .lean();

    const nextLevelIds = [];
    for (const child of children) {
      const childIdStr = String(child._id);
      if (!visited.has(childIdStr)) {
        visited.add(childIdStr);
        allDescendants.push(child._id);
        nextLevelIds.push(child._id);
      }
    }
    currentLevelIds = nextLevelIds;
  }

  return allDescendants;
}

/**
 * Cycle-safe upward traversal of folder ancestors up to maxDepth (default 20).
 * Returns ordered array of ancestors from top-level down to the current folder:
 * [{ _id, id, name }, ...]
 */
async function getFolderAncestors(folderId, userMatch, maxDepth = 20) {
  if (!folderId || !mongoose.Types.ObjectId.isValid(String(folderId))) {
    return [];
  }

  const ancestors = [];
  const visited = new Set();
  let currentId = String(folderId);

  while (currentId && ancestors.length < maxDepth) {
    if (visited.has(currentId)) {
      console.warn(`[getFolderAncestors] Cycle detected at folder ${currentId}`);
      break;
    }
    visited.add(currentId);

    const folder = await Folder.findOne({
      _id: new mongoose.Types.ObjectId(currentId),
      isTrash: { $ne: true },
      ...userMatch,
    })
      .select('_id name parentId parentFolder')
      .lean();

    if (!folder) break;

    ancestors.unshift({
      _id: folder._id,
      id: folder._id,
      name: folder.name,
    });

    const nextParent = folder.parentId || folder.parentFolder;
    currentId = nextParent && mongoose.Types.ObjectId.isValid(String(nextParent))
      ? String(nextParent)
      : null;
  }

  return ancestors;
}

const handleGetSingleFolder = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(String(rawUserId))) {
      return res.status(401).json({ error: 'Unauthorized: Valid session required' });
    }
    const folderId = req.params.id;

    if (!folderId || !mongoose.Types.ObjectId.isValid(folderId)) {
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
      _id: new mongoose.Types.ObjectId(folderId),
      isTrash: { $ne: true },
      ...userMatch,
    }).lean();

    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const ancestors = await getFolderAncestors(folderId, userMatch);

    return res.status(200).json({
      ...folder,
      ancestors,
    });
  } catch (err) {
    console.error('Error fetching single folder with ancestors:', err);
    return res.status(500).json({ error: 'Failed to fetch folder' });
  }
};

const handleFolderDetails = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(String(rawUserId))) {
      return res.status(401).json({ error: 'Unauthorized: Valid session required' });
    }
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

    // 1. Direct Immediate Subfolder Count (Only 1 level down)
    const directFolderCount = await Folder.countDocuments({
      $and: [
        userMatch,
        {
          isTrash: { $ne: true },
          $or: [
            { parentId: folderObjectId },
            { parentFolder: folderObjectId },
            { parentId: folderId },
            { parentFolder: folderId },
          ],
        },
      ],
    });

    // 2. Direct Immediate Files Count (Only files directly in this folder)
    const directFilesCount = await File.countDocuments({
      isTrash: false,
      securityStatus: { $in: ['clean', 'unverified'] },
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
    });

    // 3. Recursive Total Size (Cumulative size across this folder and all sub-branches)
    const descendantFolderIds = await getDescendantFolderIds(folderId, userMatch);
    const allFolderIds = [folder._id, ...descendantFolderIds];
    const allFolderObjectIds = allFolderIds
      .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
      .map((id) => new mongoose.Types.ObjectId(String(id)));
    const allFolderStringIds = allFolderIds.map((id) => String(id));

    const sizeStats = await File.aggregate([
      {
        $match: {
          isTrash: false,
          securityStatus: { $in: ['clean', 'unverified'] },
          $and: [
            userMatch,
            {
              $or: [
                { folder: { $in: allFolderObjectIds } },
                { folderId: { $in: allFolderObjectIds } },
                { folder: { $in: allFolderStringIds } },
                { folderId: { $in: allFolderStringIds } },
              ],
            },
          ],
        },
      },
      {
        $group: {
          _id: null,
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

    const totalBytes = sizeStats[0]?.totalBytes || 0;
    const ancestors = await getFolderAncestors(folderId, userMatch);

    return res.status(200).json({
      success: true,
      folder: {
        ...folder,
        ancestors,
        // CONTAINS displays direct immediate children only
        fileCount: directFilesCount,
        folderCount: directFolderCount,
        totalFiles: directFilesCount,
        totalFolders: directFolderCount,
        // SIZE displays cumulative disk usage
        totalSize: totalBytes,
        size: totalBytes,
      },
      ancestors,
      fileCount: directFilesCount,
      folderCount: directFolderCount,
      totalFiles: directFilesCount,
      totalFolders: directFolderCount,
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
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(String(rawUserId))) {
      return res.status(401).json({ error: 'Unauthorized: Valid session required' });
    }
    const parent = req.query.parentId || req.query.folderId || null;

    const parentId =
      parent && parent !== 'null' && mongoose.Types.ObjectId.isValid(parent)
        ? new mongoose.Types.ObjectId(parent)
        : null;

    const filter = {
      isTrash: { $ne: true },
    };

    const searchQuery = (req.query.search || req.query.q || '').trim().slice(0, 100);
    if (searchQuery) {
      filter.name = { $regex: escapeRegex(searchQuery), $options: 'i' };
    } else if (req.query.all !== 'true') {
      filter.parentId = parentId || null;
    }

    const query = buildTenantQuery(rawUserId, filter);
    const folders = await Folder.find(query)
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
    const rawUserId = req.user.id || req.user._id || req.user.userId;
    const folderId = req.params.id;
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

    const folder = await Folder.findOne({ _id: folderId, ...userMatch });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    let allFolderIds = [folder._id];
    if (typeof getDescendantFolderIds === 'function') {
      const descendants = await getDescendantFolderIds(folderId, userMatch);
      allFolderIds.push(...descendants);
    }

    const allFolderObjectIds = allFolderIds
      .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
      .map((id) => new mongoose.Types.ObjectId(String(id)));
    const allFolderStringIds = allFolderIds.map((id) => String(id));

    const files = await File.find({
      $and: [
        userMatch,
        {
          $or: [
            { folder: { $in: allFolderObjectIds } },
            { folderId: { $in: allFolderObjectIds } },
            { folder: { $in: allFolderStringIds } },
            { folderId: { $in: allFolderStringIds } },
          ],
        },
      ],
    });

    let freedBytes = 0;
    for (const f of files) freedBytes += (f.size || 0);

    // Soft-delete folder, descendant folders, and child files to 30-Day Bin
    const trashedAt = new Date();
    await Folder.updateMany(
      { _id: { $in: allFolderObjectIds }, ...userMatch },
      { $set: { isTrash: true, trashedAt } }
    );
    await File.updateMany(
      {
        $and: [
          userMatch,
          {
            $or: [
              { folder: { $in: allFolderObjectIds } },
              { folderId: { $in: allFolderObjectIds } },
              { folder: { $in: allFolderStringIds } },
              { folderId: { $in: allFolderStringIds } },
            ],
          },
        ],
      },
      { $set: { isTrash: true, trashedAt } }
    );

    // In 30-Day Bin lifecycle: items stay in Backblaze B2 and continue counting toward storage quota.
    // Zero quota deduction and zero premature purge on soft-delete!

    return res.status(200).json({
      success: true,
      message: 'Moved to Bin • Auto-deletes in 30 days',
      folderId: folder._id,
      deletedFolderIds: allFolderIds,
    });
  } catch (err) {
    console.error('Folder delete error:', err);
    return res.status(500).json({ error: 'Failed to delete folder' });
  }
});

router.get('/:id/details', authMiddleware, handleFolderDetails);
router.get('/:id/stats', authMiddleware, handleFolderDetails);
router.get('/:id', authMiddleware, handleGetSingleFolder);

// -------------------------------------------------------------
// BULK FOLDER TREE CREATION (POST /ensure-tree)
// -------------------------------------------------------------
router.post('/ensure-tree', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(String(rawUserId))) {
      return res.status(401).json({ error: 'Unauthorized: Valid session required' });
    }

    // Write-lock enforcement
    const user = await User.findById(rawUserId).select('plan trialExpiresAt subscription').lean();
    if (user) {
      const now = new Date();
      if ((user.plan === 'trial' || user.subscription?.planId === 'trial') && user.trialExpiresAt && new Date(user.trialExpiresAt) <= now) {
        return res.status(403).json({
          error: 'Your 14-day evaluation trial has ended. Select a plan to restore write privileges.',
          code: 'TRIAL_EXPIRED',
        });
      }
      if (user.subscription?.status === 'past_due') {
        return res.status(403).json({
          error: 'Your vault is in a read-only grace period. Renew or upgrade your plan to resume folder modifications.',
          code: 'SUBSCRIPTION_PAST_DUE',
        });
      }
      if (user.subscription?.status === 'expired') {
        return res.status(403).json({
          error: 'Your subscription has expired. Select a plan on the Pricing page to resume folder modifications.',
          code: 'SUBSCRIPTION_EXPIRED',
        });
      }
    }

    const { baseParentId = null, paths = [] } = req.body;
    const rawPaths = Array.isArray(paths) ? paths.slice(0, 1000) : [];

    const baseParent =
      baseParentId &&
      baseParentId !== 'null' &&
      baseParentId !== 'undefined' &&
      baseParentId !== 'root' &&
      mongoose.Types.ObjectId.isValid(baseParentId)
        ? new mongoose.Types.ObjectId(baseParentId)
        : null;

    if (baseParent) {
      const parentFolder = await Folder.findOne(
        buildTenantQuery(rawUserId, { _id: baseParent, isTrash: { $ne: true } })
      );
      if (!parentFolder) {
        return res.status(404).json({ success: false, error: 'Target base parent folder not found or unauthorized' });
      }
    }

    const folderMap = {};
    if (rawPaths.length === 0) {
      return res.status(200).json({ success: true, folderMap });
    }

    // 1. Deduplicate paths and collect all intermediate ancestor directories
    const allDirsSet = new Set();
    for (const p of rawPaths) {
      const cleanPath = String(p || '')
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .trim();
      if (!cleanPath) continue;

      const parts = cleanPath.split('/').filter(Boolean);
      let prefix = '';
      for (const part of parts) {
        const segment = part.trim();
        if (segment.length > 50) {
          return res.status(400).json({ error: 'Folder name cannot exceed 50 characters' });
        }
        prefix = prefix ? `${prefix}/${segment}` : segment;
        allDirsSet.add(prefix);
      }
    }

    if (allDirsSet.size === 0) {
      return res.status(200).json({ success: true, folderMap });
    }

    // 2. Group directories by depth ascending
    const depthMap = new Map();
    for (const dirPath of allDirsSet) {
      const depth = dirPath.split('/').length;
      if (!depthMap.has(depth)) {
        depthMap.set(depth, []);
      }
      depthMap.get(depth).push(dirPath);
    }

    const sortedDepths = Array.from(depthMap.keys()).sort((a, b) => a - b);
    const userIdObj = new mongoose.Types.ObjectId(String(rawUserId));

    // 3. Resolve level-by-level
    for (const depth of sortedDepths) {
      const dirsAtDepth = depthMap.get(depth);
      const itemsToResolve = [];

      for (const dirPath of dirsAtDepth) {
        const parts = dirPath.split('/');
        const folderName = parts[parts.length - 1];
        let parentObjectId = baseParent;

        if (depth > 1) {
          const parentPath = parts.slice(0, -1).join('/');
          const parentFolderId = folderMap[parentPath];
          if (parentFolderId && mongoose.Types.ObjectId.isValid(parentFolderId)) {
            parentObjectId = new mongoose.Types.ObjectId(parentFolderId);
          }
        }

        itemsToResolve.push({
          path: dirPath,
          name: folderName,
          parentId: parentObjectId,
        });
      }

      // Batch query existing folders at this level
      const orConditions = itemsToResolve.map((item) => ({
        name: item.name,
        parentId: item.parentId || null,
      }));

      const existingFolders = await Folder.find({
        $and: [
          buildTenantQuery(rawUserId, { isTrash: { $ne: true } }),
          { $or: orConditions },
        ],
      }).lean();

      // Index existing by `${parentIdStr || 'root'}:::${name}`
      const existingLookup = new Map();
      for (const ef of existingFolders) {
        const pIdStr = ef.parentId ? String(ef.parentId) : 'root';
        existingLookup.set(`${pIdStr}:::${ef.name}`, String(ef._id));
      }

      // Assign existing and create missing
      for (const item of itemsToResolve) {
        const lookupKey = `${item.parentId ? String(item.parentId) : 'root'}:::${item.name}`;
        if (existingLookup.has(lookupKey)) {
          folderMap[item.path] = existingLookup.get(lookupKey);
        } else {
          try {
            const newFolder = new Folder({
              name: item.name,
              userId: userIdObj,
              user: userIdObj,
              parentId: item.parentId || null,
              parentFolder: item.parentId || null,
              isTrash: false,
            });
            await newFolder.save();
            const newIdStr = String(newFolder._id);
            folderMap[item.path] = newIdStr;
            existingLookup.set(lookupKey, newIdStr);
          } catch (err) {
            if (err.name === 'ValidationError') {
              return res.status(400).json({ error: 'Folder name cannot exceed 50 characters' });
            }
            if (err.code === 11000) {
              const collided = await Folder.findOne(
                buildTenantQuery(rawUserId, {
                  name: item.name,
                  parentId: item.parentId || null,
                  isTrash: { $ne: true },
                })
              ).lean();
              if (collided) {
                const colIdStr = String(collided._id);
                folderMap[item.path] = colIdStr;
                existingLookup.set(lookupKey, colIdStr);
              }
            } else {
              throw err;
            }
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      folderMap,
    });
  } catch (err) {
    console.error('Error in /api/folders/ensure-tree:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: 'Folder name cannot exceed 50 characters' });
    }
    return res.status(500).json({ error: err.message || 'Failed to ensure folder tree' });
  }
});

module.exports = router;
module.exports.handleBatchMove = handleBatchMove;
module.exports.getFolderAncestors = getFolderAncestors;
