const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const Share = require('../models/Share');
const File = require('../models/File');
const Folder = require('../models/Folder');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const { buildTenantQuery } = require('../utils/tenantQuery');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-central-003',
  ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

function getBucketName() {
  return process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
}

async function signDirectThumbnailUrl(thumbnailKey, expiresIn = 3600) {
  const bucket = getBucketName();
  if (!thumbnailKey || !bucket) return null;
  try {
    return await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: thumbnailKey,
      }),
      { expiresIn }
    );
  } catch (err) {
    console.warn('[Shares] Failed to sign direct thumbnail URL:', err.message);
    return null;
  }
}

async function signDirectPdfPreviewUrl(file) {
  const bucket = getBucketName();
  if (!file?.s3Key || !bucket) return null;
  const mime = String(file.mimeType || file.mimetype || '').toLowerCase();
  const name = String(file.originalName || file.name || '').toLowerCase();
  if (mime !== 'application/pdf' && !name.endsWith('.pdf')) {
    return null;
  }
  try {
    return await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: file.s3Key,
      }),
      { expiresIn: 3600 }
    );
  } catch (err) {
    console.warn('[Shares] Failed to sign direct PDF preview URL:', err.message);
    return null;
  }
}

/**
 * Verifies whether `folderId` is directly shared with `recipientId` OR is a descendant
 * of an active, non-trashed Folder shared with `recipientId`.
 * Walks up parentId / parentFolder with cycle protection and checks isTrash at every level.
 */
async function verifySharedFolderAccess(folderId, recipientId) {
  if (!folderId || !mongoose.Types.ObjectId.isValid(String(folderId))) {
    return { authorized: false };
  }

  const visited = new Set();
  const chain = [];
  let currentId = String(folderId);
  let targetFolder = null;
  let depth = 0;

  while (currentId && depth < 50) {
    if (visited.has(currentId)) {
      return { authorized: false }; // cycle guard
    }
    visited.add(currentId);
    depth++;

    const folder = await Folder.findById(currentId)
      .select('_id name parentId parentFolder isTrash userId user createdAt updatedAt')
      .lean();

    if (!folder || folder.isTrash === true) {
      return { authorized: false };
    }

    if (!targetFolder) {
      targetFolder = folder;
    }

    chain.unshift({
      _id: String(folder._id),
      name: folder.name,
    });

    const share = await Share.findOne({
      recipientId,
      itemType: 'folder',
      itemId: folder._id,
    }).lean();

    if (share) {
      return {
        authorized: true,
        folder: targetFolder,
        rootShare: share,
        breadcrumbs: chain,
      };
    }

    const parent = folder.parentId || folder.parentFolder || null;
    currentId = parent ? String(parent) : null;
  }

  return { authorized: false };
}

// -------------------------------------------------------------
// 1. POST /api/shares — Share a file or folder with another user
// -------------------------------------------------------------
router.post('/', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(String(rawUserId))) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { itemType, itemId, recipientEmail } = req.body || {};

    if (itemType !== 'file' && itemType !== 'folder') {
      return res.status(400).json({ error: 'itemType must be "file" or "folder"' });
    }
    if (!itemId || !mongoose.Types.ObjectId.isValid(String(itemId))) {
      return res.status(400).json({ error: 'Valid itemId is required' });
    }
    if (typeof recipientEmail !== 'string' || !recipientEmail.trim() || !recipientEmail.includes('@')) {
      return res.status(400).json({ error: 'Valid recipientEmail is required' });
    }

    const normalizedEmail = recipientEmail.trim().toLowerCase();

    // Verify ownership and active (non-trashed) status
    const itemQuery = buildTenantQuery(rawUserId, {
      _id: itemId,
      isTrash: { $ne: true },
      ...(itemType === 'file' ? { isDeleted: { $ne: true }, isMalicious: { $ne: true } } : {}),
    });

    const item =
      itemType === 'file'
        ? await File.findOne(itemQuery).select('_id name').lean()
        : await Folder.findOne(itemQuery).select('_id name').lean();

    if (!item) {
      return res.status(404).json({ error: `${itemType === 'file' ? 'File' : 'Folder'} not found` });
    }

    // Look up recipient by email
    const recipient = await User.findOne({ email: normalizedEmail })
      .select('_id name email')
      .lean();

    if (!recipient) {
      return res.status(404).json({ error: 'No CloudGuard account found with that email' });
    }

    if (String(recipient._id) === String(rawUserId)) {
      return res.status(400).json({ error: 'You cannot share an item with yourself' });
    }

    const existing = await Share.findOne({
      ownerId: rawUserId,
      recipientId: recipient._id,
      itemType,
      itemId: item._id,
    }).lean();

    if (existing) {
      return res.status(409).json({ error: 'Already shared with this user' });
    }

    const share = await Share.create({
      ownerId: rawUserId,
      recipientId: recipient._id,
      recipientEmail: recipient.email || normalizedEmail,
      itemType,
      itemId: item._id,
      permission: 'viewer',
    });

    const populatedShare = await Share.findById(share._id)
      .populate('recipientId', 'name email')
      .lean();

    return res.status(201).json({
      success: true,
      share: populatedShare || share,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Already shared with this user' });
    }
    console.error('Error creating share:', err);
    return res.status(500).json({ error: 'Failed to create share' });
  }
});

// -------------------------------------------------------------
// 2. GET /api/shares/item/:itemType/:itemId — List recipients for an owned item
// -------------------------------------------------------------
router.get('/item/:itemType/:itemId', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(String(rawUserId))) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { itemType, itemId } = req.params;
    if (itemType !== 'file' && itemType !== 'folder') {
      return res.status(400).json({ error: 'Invalid itemType' });
    }
    if (!itemId || !mongoose.Types.ObjectId.isValid(String(itemId))) {
      return res.status(400).json({ error: 'Valid itemId is required' });
    }

    const itemQuery = buildTenantQuery(rawUserId, {
      _id: itemId,
      isTrash: { $ne: true },
    });

    const item =
      itemType === 'file'
        ? await File.findOne(itemQuery).select('_id').lean()
        : await Folder.findOne(itemQuery).select('_id').lean();

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const shares = await Share.find({
      ownerId: rawUserId,
      itemType,
      itemId: item._id,
    })
      .populate('recipientId', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ shares });
  } catch (err) {
    console.error('Error fetching item shares:', err);
    return res.status(500).json({ error: 'Failed to fetch item shares' });
  }
});

// -------------------------------------------------------------
// 3. DELETE /api/shares/:shareId — Revoke (owner) or remove (recipient)
// -------------------------------------------------------------
router.delete('/:shareId', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(String(rawUserId))) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { shareId } = req.params;
    if (!shareId || !mongoose.Types.ObjectId.isValid(String(shareId))) {
      return res.status(400).json({ error: 'Valid shareId is required' });
    }

    const share = await Share.findById(shareId).lean();
    if (!share) {
      return res.status(404).json({ error: 'Share record not found' });
    }

    const isOwner = String(share.ownerId) === String(rawUserId);
    const isRecipient = String(share.recipientId) === String(rawUserId);

    if (!isOwner && !isRecipient) {
      return res.status(403).json({ error: 'Not authorized to remove this share' });
    }

    await Share.deleteOne({ _id: share._id });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error deleting share:', err);
    return res.status(500).json({ error: 'Failed to remove share' });
  }
});

// -------------------------------------------------------------
// 4. GET /api/shares/with-me — List active items shared with current user
// -------------------------------------------------------------
router.get('/with-me', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(String(rawUserId))) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const shareDocs = await Share.find({ recipientId: rawUserId })
      .sort({ createdAt: -1 })
      .populate('ownerId', 'name email')
      .lean();

    const fileIds = shareDocs.filter((s) => s.itemType === 'file').map((s) => s.itemId);
    const folderIds = shareDocs.filter((s) => s.itemType === 'folder').map((s) => s.itemId);

    const [activeFiles, activeFolders] = await Promise.all([
      fileIds.length > 0
        ? File.find({
            _id: { $in: fileIds },
            isTrash: { $ne: true },
            isDeleted: { $ne: true },
            isMalicious: { $ne: true },
            securityStatus: { $in: ['clean', 'unverified'] },
          })
            .select('name originalName size mimeType mimetype s3Key thumbnailKey securityStatus uploadedAt createdAt')
            .lean()
        : [],
      folderIds.length > 0
        ? Folder.find({
            _id: { $in: folderIds },
            isTrash: { $ne: true },
          })
            .select('name parentId parentFolder createdAt updatedAt')
            .lean()
        : [],
    ]);

    const fileMap = new Map(activeFiles.map((f) => [String(f._id), f]));
    const folderMap = new Map(activeFolders.map((f) => [String(f._id), f]));

    const folders = [];
    const rawFiles = [];

    for (const share of shareDocs) {
      const sharedBy = share.ownerId
        ? { name: share.ownerId.name || 'CloudGuard User', email: share.ownerId.email || '' }
        : { name: 'CloudGuard User', email: '' };

      if (share.itemType === 'folder') {
        const folder = folderMap.get(String(share.itemId));
        if (folder) {
          folders.push({
            ...folder,
            _id: String(folder._id),
            shareId: String(share._id),
            sharedBy,
            sharedAt: share.createdAt,
            permission: share.permission || 'viewer',
          });
        }
      } else if (share.itemType === 'file') {
        const file = fileMap.get(String(share.itemId));
        if (file) {
          rawFiles.push({
            ...file,
            _id: String(file._id),
            id: String(file._id),
            name: file.name || file.originalName,
            shareId: String(share._id),
            sharedBy,
            sharedAt: share.createdAt,
            permission: share.permission || 'viewer',
          });
        }
      }
    }

    const files = await Promise.all(
      rawFiles.map(async (f) => ({
        ...f,
        thumbnailUrl: f.thumbnailKey ? await signDirectThumbnailUrl(f.thumbnailKey) : null,
        previewUrl: await signDirectPdfPreviewUrl(f),
      }))
    );

    return res.status(200).json({ folders, files });
  } catch (err) {
    console.error('Error fetching shared-with-me items:', err);
    return res.status(500).json({ error: 'Failed to load shared items' });
  }
});

// -------------------------------------------------------------
// 5. GET /api/shares/folder/:folderId/contents — Browse shared folder subtree
// -------------------------------------------------------------
router.get('/folder/:folderId/contents', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(String(rawUserId))) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { folderId } = req.params;
    if (!folderId || !mongoose.Types.ObjectId.isValid(String(folderId))) {
      return res.status(400).json({ error: 'Valid folderId is required' });
    }

    const access = await verifySharedFolderAccess(folderId, rawUserId);
    if (!access.authorized) {
      return res.status(403).json({ error: 'Access denied to shared folder' });
    }

    const targetObjId = new mongoose.Types.ObjectId(String(folderId));
    const targetStrId = String(folderId);

    const [childFolders, childFilesRaw] = await Promise.all([
      Folder.find({
        $or: [{ parentId: targetObjId }, { parentFolder: targetObjId }],
        isTrash: { $ne: true },
      })
        .select('name parentId parentFolder createdAt updatedAt')
        .sort({ name: 1 })
        .lean(),
      File.find({
        $or: [
          { folder: targetObjId },
          { folderId: targetObjId },
          { folder: targetStrId },
          { folderId: targetStrId },
        ],
        isTrash: { $ne: true },
        isDeleted: { $ne: true },
        isMalicious: { $ne: true },
        securityStatus: { $in: ['clean', 'unverified'] },
      })
        .select('name originalName size mimeType mimetype s3Key thumbnailKey securityStatus uploadedAt createdAt')
        .sort({ uploadedAt: -1, createdAt: -1 })
        .lean(),
    ]);

    const folders = childFolders.map((f) => ({
      ...f,
      _id: String(f._id),
    }));

    const files = await Promise.all(
      childFilesRaw.map(async (f) => ({
        ...f,
        _id: String(f._id),
        id: String(f._id),
        name: f.name || f.originalName,
        thumbnailUrl: f.thumbnailKey ? await signDirectThumbnailUrl(f.thumbnailKey, 3600) : null,
        previewUrl: await signDirectPdfPreviewUrl(f),
      }))
    );

    return res.status(200).json({
      folder: {
        ...access.folder,
        _id: String(access.folder._id),
      },
      folders,
      files,
      breadcrumbs: access.breadcrumbs,
    });
  } catch (err) {
    console.error('Error loading shared folder contents:', err);
    return res.status(500).json({ error: 'Failed to load shared folder contents' });
  }
});

// -------------------------------------------------------------
// 5b. GET /api/shares/by-me — Outbound shares grouped by item
// -------------------------------------------------------------
router.get('/by-me', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(String(rawUserId))) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const shareDocs = await Share.find({ ownerId: rawUserId })
      .sort({ createdAt: -1 })
      .populate('recipientId', 'name email')
      .lean();

    if (shareDocs.length === 0) {
      return res.status(200).json({ items: [], sharedItemIds: [] });
    }

    const fileIds = shareDocs.filter((s) => s.itemType === 'file').map((s) => s.itemId);
    const folderIds = shareDocs.filter((s) => s.itemType === 'folder').map((s) => s.itemId);

    const [ownedFiles, ownedFolders] = await Promise.all([
      fileIds.length > 0
        ? File.find(
            buildTenantQuery(rawUserId, {
              _id: { $in: fileIds },
              isTrash: { $ne: true },
              isDeleted: { $ne: true },
              isMalicious: { $ne: true },
              securityStatus: { $in: ['clean', 'unverified'] },
            })
          )
            .select('name originalName size mimeType mimetype thumbnailKey createdAt uploadedAt updatedAt')
            .lean()
        : [],
      folderIds.length > 0
        ? Folder.find(
            buildTenantQuery(rawUserId, {
              _id: { $in: folderIds },
              isTrash: { $ne: true },
            })
          )
            .select('name createdAt updatedAt')
            .lean()
        : [],
    ]);

    const filesWithThumbs = await Promise.all(
      ownedFiles.map(async (f) => ({
        ...f,
        thumbnailUrl: f.thumbnailKey ? await signDirectThumbnailUrl(f.thumbnailKey, 3600) : null,
      }))
    );

    const fileMap = new Map(filesWithThumbs.map((f) => [String(f._id), f]));
    const folderMap = new Map(ownedFolders.map((f) => [String(f._id), f]));
    const groupedMap = new Map();

    for (const share of shareDocs) {
      const idStr = String(share.itemId);
      const itemDoc = share.itemType === 'file' ? fileMap.get(idStr) : folderMap.get(idStr);
      if (!itemDoc) continue; // Ignore shares for trashed or deleted items

      const groupKey = `${share.itemType}:${idStr}`;
      if (!groupedMap.has(groupKey)) {
        groupedMap.set(groupKey, {
          itemType: share.itemType,
          item:
            share.itemType === 'file'
              ? {
                  _id: String(itemDoc._id),
                  name: itemDoc.originalName || itemDoc.name,
                  size: itemDoc.size || 0,
                  mimeType: itemDoc.mimeType || itemDoc.mimetype || '',
                  thumbnailUrl: itemDoc.thumbnailUrl || null,
                  updatedAt: itemDoc.updatedAt || itemDoc.uploadedAt || itemDoc.createdAt,
                  createdAt: itemDoc.createdAt || itemDoc.uploadedAt,
                }
              : {
                  _id: String(itemDoc._id),
                  name: itemDoc.name,
                  updatedAt: itemDoc.updatedAt || itemDoc.createdAt,
                  createdAt: itemDoc.createdAt,
                },
          recipients: [],
          latestSharedAt: share.createdAt,
        });
      }

      const entry = groupedMap.get(groupKey);
      entry.recipients.push({
        shareId: String(share._id),
        recipientId: share.recipientId?._id ? String(share.recipientId._id) : String(share.recipientId),
        name: share.recipientId?.name || share.recipientEmail,
        email: share.recipientId?.email || share.recipientEmail,
        permission: share.permission || 'viewer',
        sharedAt: share.createdAt,
      });

      if (share.createdAt && new Date(share.createdAt) > new Date(entry.latestSharedAt)) {
        entry.latestSharedAt = share.createdAt;
      }
    }

    const items = Array.from(groupedMap.values());
    const sharedItemIds = items.map((entry) => String(entry.item._id));

    return res.status(200).json({ items, sharedItemIds });
  } catch (err) {
    console.error('Error fetching outbound shares:', err);
    return res.status(500).json({ error: 'Failed to load outbound shares' });
  }
});

// -------------------------------------------------------------
// 6. GET /api/shares/file/:fileId/access — Direct B2 signed URL for shared file
// -------------------------------------------------------------
router.get('/file/:fileId/access', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(String(rawUserId))) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { fileId } = req.params;
    if (!fileId || !mongoose.Types.ObjectId.isValid(String(fileId))) {
      return res.status(400).json({ error: 'Valid fileId is required' });
    }

    const file = await File.findById(fileId).lean();
    if (
      !file ||
      file.isTrash === true ||
      file.isDeleted === true ||
      file.isMalicious === true ||
      file.securityStatus === 'malicious' ||
      file.securityStatus === 'threat_purged'
    ) {
      return res.status(404).json({ error: 'Shared file not found' });
    }

    // Check direct share first, then shared ancestor folder
    let authorized = false;
    const directShare = await Share.findOne({
      recipientId: rawUserId,
      itemType: 'file',
      itemId: file._id,
    }).lean();

    if (directShare) {
      authorized = true;
    } else {
      const parentFolderId = file.folderId || file.folder || null;
      if (parentFolderId) {
        const folderAccess = await verifySharedFolderAccess(parentFolderId, rawUserId);
        authorized = folderAccess.authorized;
      }
    }

    if (!authorized) {
      return res.status(403).json({ error: 'Access denied to shared file' });
    }

    if (!file.s3Key) {
      return res.status(400).json({ error: 'File storage key missing' });
    }

    const bucket = getBucketName();
    const isDownload = req.query.download === 'true';
    const fileName = file.originalName || file.name || 'file';
    const disposition = isDownload
      ? `attachment; filename="${encodeURIComponent(fileName)}"`
      : `inline; filename="${encodeURIComponent(fileName)}"`;

    // Direct Backblaze B2 S3 URL (300s expiry, no CDN_DOWNLOAD_URL rewrite to preserve cg_vault_session tenant isolation)
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: file.s3Key,
      ResponseContentDisposition: disposition,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });
    const thumbnailUrl = file.thumbnailKey ? await signDirectThumbnailUrl(file.thumbnailKey) : null;

    return res.status(200).json({
      url,
      file: {
        ...file,
        _id: String(file._id),
        thumbnailUrl,
      },
    });
  } catch (err) {
    console.error('Error generating shared file access URL:', err);
    return res.status(500).json({ error: 'Failed to generate access URL for shared file' });
  }
});

module.exports = router;
