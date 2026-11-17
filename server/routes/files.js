const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const mongoose = require('mongoose');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const User = require('../models/User');
const File = require('../models/File');
const Folder = require('../models/Folder');
const { buildTenantQuery } = require('../utils/tenantQuery');
const { permanentlyDeleteS3Keys, purgeAllVersionsUnderPrefix } = require('../utils/s3Delete');
const { applyCdnToUrl } = require('../utils/cdnHelper');

// In-memory cache for presigned preview/access URLs (30-minute TTL)
// Key: `${file._id}:${file.s3Key}` -> Value: { url: string, expiresAt: number }
const accessUrlCache = new Map();
const ACCESS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Verified SHA-256 hash signatures for Antigravity executables
const ANTIGRAVITY_HASH_WHITELIST = new Set([
  '9b0c8e42758f48c426a39c1919281322381a77d7e526d5b7be7cdb63e1d2873a', // Antigravity.exe
  'df765a8ae84a673ae9e8c8e60eca8e7e839351029c58803a107b8f010ce7b736', // Antigravity IDE.exe
  process.env.ANTIGRAVITY_SHA256?.toLowerCase().trim(),
].filter(Boolean));

// Ensure S3Client is configured with credentials and region
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-central-003',
  ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Auth Middleware for modular files route
const authMiddleware = require('../middleware/auth');

// Strict sanitization helper: converts input into verified non-null ObjectIds
function toValidObjectIds(rawIds) {
  return (Array.isArray(rawIds) ? rawIds : [rawIds])
    .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));
}

// Single-Query BFS Descendant Lookup:
// Fetches the user's folders in 1 lean query and traverses in-memory via Set + queue
async function getDescendantFolderIds(folderId, userMatch, includeTrash = false) {
  if (!folderId || !mongoose.Types.ObjectId.isValid(String(folderId))) return [];
  const targetIdStr = String(folderId);

  const folderQuery = { ...userMatch };
  if (!includeTrash) {
    folderQuery.isTrash = { $ne: true };
  }

  // Lean single DB query for user folders
  const allUserFolders = await Folder.find(folderQuery)
    .select('_id parentId parentFolder')
    .lean();

  // In-memory adjacency map: parentId -> [childId]
  const parentToChildren = new Map();
  for (const f of allUserFolders) {
    const parent = f.parentId || f.parentFolder;
    if (parent) {
      const pStr = String(parent);
      if (!parentToChildren.has(pStr)) {
        parentToChildren.set(pStr, []);
      }
      parentToChildren.get(pStr).push(f._id);
    }
  }

  // BFS traversal using queue and visited set
  const visited = new Set([targetIdStr]);
  const queue = [targetIdStr];
  const allDescendants = [];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const children = parentToChildren.get(currentId) || [];
    for (const childId of children) {
      const childIdStr = String(childId);
      if (!visited.has(childIdStr)) {
        visited.add(childIdStr);
        allDescendants.push(childId);
        queue.push(childIdStr);
      }
    }
  }

  return allDescendants;
}

// Active purge timer registry: Map<string, NodeJS.Timeout>
const activePurgeTimers = new Map();

/**
 * Safely cancels a running deletion timer if the user restores the file/folder
 */
const cancelPurgeTimer = (id) => {
  const idStr = String(id);
  if (activePurgeTimers.has(idStr)) {
    clearTimeout(activePurgeTimers.get(idStr));
    activePurgeTimers.delete(idStr);
  }
};

// 1. Single File Purge Scheduler
const scheduleFilePurge = (fileId, rawUserId, delayMs = 12000) => {
  if (!fileId || !mongoose.Types.ObjectId.isValid(String(fileId))) return;
  const fileIdStr = String(fileId);
  cancelPurgeTimer(fileIdStr);

  const purgeScheduledAt = Date.now();

  const timer = setTimeout(async () => {
    activePurgeTimers.delete(fileIdStr);
    try {
      const userMatch = { $or: [{ userId: rawUserId }, { user: rawUserId }] };
      const file = await File.findOne({ _id: fileId, isTrash: true, ...userMatch });
      if (!file) return;

      // Timestamp Guard: If the file was restored and re-deleted later, abort this stale timer
      if (file.trashedAt && new Date(file.trashedAt).getTime() > purgeScheduledAt) {
        return;
      }

      const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || 'cloudguard-vault-b2';
      const userPrefix = `uploads/${String(rawUserId)}/`;
      const thumbPrefix = `thumbnails/${String(rawUserId)}/`;
      const rawKeys = [file.s3Key, file.thumbnailKey].filter(Boolean);
      const keysToPurge = rawKeys.filter((k) => k.startsWith(userPrefix) || k.startsWith(thumbPrefix));

      if (keysToPurge.length > 0) {
        await permanentlyDeleteS3Keys(s3Client, bucket, keysToPurge, rawUserId).catch((e) => console.warn(`[S3 Purge Warning] ${e.message}`));
      }

      await File.deleteOne({ _id: file._id, ...userMatch });
      console.log(`[Auto-Purge] Un-restored file "${file.name}" permanently deleted from S3 & DB.`);
    } catch (err) {
      console.error('[Deferred File Purge Error]:', err);
    }
  }, delayMs);

  activePurgeTimers.set(fileIdStr, timer);
};

// 2. Batch Purge Scheduler
const scheduleBatchPurge = (fileIds = [], folderIds = [], rawUserId, delayMs = 12000) => {
  const validFileIds = toValidObjectIds(fileIds);
  const validFolderIds = toValidObjectIds(folderIds);

  if (validFileIds.length === 0 && validFolderIds.length === 0) return;

  const batchKey = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const purgeScheduledAt = Date.now();

  // Register individual keys so restore-batch can cancel them
  validFileIds.forEach((id) => cancelPurgeTimer(id));
  validFolderIds.forEach((id) => cancelPurgeTimer(id));

  const timer = setTimeout(async () => {
    activePurgeTimers.delete(batchKey);
    validFileIds.forEach((id) => activePurgeTimers.delete(String(id)));
    validFolderIds.forEach((id) => activePurgeTimers.delete(String(id)));

    try {
      const userMatch = { $or: [{ userId: rawUserId }, { user: rawUserId }] };
      const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || 'cloudguard-vault-b2';
      const userPrefix = `uploads/${String(rawUserId)}/`;
      const thumbPrefix = `thumbnails/${String(rawUserId)}/`;

      // Purge un-restored files
      if (validFileIds.length > 0) {
        const trashedFiles = await File.find({
          _id: { $in: validFileIds },
          isTrash: true,
          ...userMatch,
        });

        // Only purge files whose trashedAt is not newer than this timer
        const validToPurge = trashedFiles.filter(
          (f) => !f.trashedAt || new Date(f.trashedAt).getTime() <= purgeScheduledAt
        );

        const keys = [];
        validToPurge.forEach((f) => {
          if (f.s3Key && (f.s3Key.startsWith(userPrefix) || f.s3Key.startsWith(thumbPrefix))) keys.push(f.s3Key);
          if (f.thumbnailKey && (f.thumbnailKey.startsWith(userPrefix) || f.thumbnailKey.startsWith(thumbPrefix))) keys.push(f.thumbnailKey);
        });

        if (keys.length > 0) {
          await permanentlyDeleteS3Keys(s3Client, bucket, keys, rawUserId).catch((e) => console.warn(`[S3 Batch Purge Warning] ${e.message}`));
        }

        if (validToPurge.length > 0) {
          await File.deleteMany({
            _id: { $in: validToPurge.map((f) => f._id) },
            ...userMatch,
          });
        }
      }

      // Purge un-restored folders & children
      if (validFolderIds.length > 0) {
        const trashedFolders = await Folder.find({
          _id: { $in: validFolderIds },
          isTrash: true,
          ...userMatch,
        });

        const validFolders = trashedFolders.filter(
          (f) => !f.trashedAt || new Date(f.trashedAt).getTime() <= purgeScheduledAt
        );

        if (validFolders.length > 0) {
          const allFolderObjectIds = toValidObjectIds(validFolders.map((f) => f._id));
          for (const f of validFolders) {
            const desc = await getDescendantFolderIds(f._id, userMatch);
            allFolderObjectIds.push(...desc);
          }

          const uniqueFolderObjectIds = toValidObjectIds(allFolderObjectIds);
          if (uniqueFolderObjectIds.length > 0) {
            const uniqueFolderStringIds = uniqueFolderObjectIds.map((id) => String(id));

            const childFiles = await File.find({
              $and: [
                userMatch,
                {
                  $or: [
                    { folder: { $in: uniqueFolderObjectIds } },
                    { folderId: { $in: uniqueFolderObjectIds } },
                    { folder: { $in: uniqueFolderStringIds } },
                    { folderId: { $in: uniqueFolderStringIds } },
                  ],
                },
                { isTrash: true },
              ],
            });

            const childKeys = [];
            childFiles.forEach((cf) => {
              if (cf.s3Key && (cf.s3Key.startsWith(userPrefix) || cf.s3Key.startsWith(thumbPrefix))) childKeys.push(cf.s3Key);
              if (cf.thumbnailKey && (cf.thumbnailKey.startsWith(userPrefix) || cf.thumbnailKey.startsWith(thumbPrefix))) childKeys.push(cf.thumbnailKey);
            });

            if (childKeys.length > 0) {
              await permanentlyDeleteS3Keys(s3Client, bucket, childKeys, rawUserId).catch((e) => console.warn(`[S3 Folder Child Purge Warning] ${e.message}`));
            }

            await File.deleteMany({
              $and: [
                userMatch,
                {
                  $or: [
                    { folder: { $in: uniqueFolderObjectIds } },
                    { folderId: { $in: uniqueFolderObjectIds } },
                    { folder: { $in: uniqueFolderStringIds } },
                    { folderId: { $in: uniqueFolderStringIds } },
                  ],
                },
              ],
            });

            await Folder.deleteMany({ _id: { $in: uniqueFolderObjectIds }, ...userMatch });
          }
        }
      }
    } catch (err) {
      console.error('[Deferred Batch Purge Error]:', err);
    }
  }, delayMs);

  activePurgeTimers.set(batchKey, timer);
  validFileIds.forEach((id) => activePurgeTimers.set(String(id), timer));
  validFolderIds.forEach((id) => activePurgeTimers.set(String(id), timer));
};

// Helper for direct Node-level MalwareBazaar check
async function checkMalwareBazaarNode(sha256) {
  if (!sha256 || sha256.length !== 64) return { isMalicious: false };
  try {
    const params = new URLSearchParams();
    params.append('query', 'get_info');
    params.append('hash', sha256);

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const mbKey = process.env.MALWAREBAZAAR_API_KEY || process.env.MB_API_KEY || process.env.ABUSE_CH_API_KEY;
    if (mbKey) {
      headers['Auth-Key'] = mbKey;
    }

    const res = await axios.post('https://mb-api.abuse.ch/api/v1/', params, {
      headers,
      timeout: 5000,
    });

    if (res.data && res.data.query_status === 'ok') {
      return {
        isMalicious: true,
        threat: res.data.data?.[0]?.signature || 'Known Malware Sample (MalwareBazaar)',
      };
    }
  } catch (err) {
    console.warn('[Node MalwareBazaar] Lookup notice:', err.message);
  }
  return { isMalicious: false };
}

// -------------------------------------------------------------
// 1. SECURE FILE ACCESS / PREVIEW URL (Fixes 404 on /:id/access)
// -------------------------------------------------------------
router.get('/:id/access', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id || req.user.userId;
    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    // Match either user or userId to resolve 404 on existing test files
    const file = await File.findOne({
      _id: req.params.id,
      isTrash: { $ne: true },
      $or: [
        { userId: userIdObj },
        { user: userIdObj },
        { userId: String(rawUserId) },
        { user: String(rawUserId) },
      ],
    }).lean();

    if (!file) {
      return res.status(404).json({ error: 'File not found or unauthorized' });
    }

    if (file.isMalicious || file.securityStatus === 'threat_purged') {
      return res.status(403).json({ error: 'Access denied: File flagged as threat.' });
    }

    let targetKey = file.s3Key || file.key;
    if (!targetKey && file.location) {
      try {
        const urlObj = new URL(file.location);
        targetKey = decodeURIComponent(urlObj.pathname.substring(1).replace(/\+/g, '%20'));
      } catch (e) {}
    }

    if (!targetKey) {
      return res.status(400).json({ error: 'S3 Key missing' });
    }

    const isDownload = req.query.download === 'true';
    const cacheKey = `${file._id}:${targetKey}`;

    if (!isDownload) {
      const cached = accessUrlCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json({
          success: true,
          accessUrl: cached.url,
          downloadUrl: cached.url,
          url: cached.url,
          file,
        });
      }
    }

    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
    const disposition = isDownload
      ? `attachment; filename="${encodeURIComponent(file.name || file.originalName || 'file')}"`
      : `inline; filename="${encodeURIComponent(file.name || file.originalName || 'file')}"`;

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: targetKey,
      ResponseContentDisposition: disposition,
    });

    // 2-hour signature validity (7200 seconds) so Cloudflare and browser can cache responses
    const rawUrl = await getSignedUrl(s3Client, command, { expiresIn: 7200 });
    const accessUrl = applyCdnToUrl(rawUrl);

    if (!isDownload) {
      accessUrlCache.set(cacheKey, {
        url: accessUrl,
        expiresAt: Date.now() + ACCESS_CACHE_TTL_MS, // 30-minute TTL
      });

      // Periodic memory guard
      if (accessUrlCache.size > 2000) {
        const now = Date.now();
        for (const [k, v] of accessUrlCache.entries()) {
          if (v.expiresAt <= now) accessUrlCache.delete(k);
        }
      }
    }

    return res.json({
      success: true,
      accessUrl,
      downloadUrl: accessUrl,
      url: accessUrl,
      file,
    });
  } catch (err) {
    console.error('Error generating access URL:', err);
    return res.status(500).json({ error: 'Failed to generate secure access URL' });
  }
});

// -------------------------------------------------------------
// 2. LIST FILES FOR FOLDER
// -------------------------------------------------------------
router.get('/', authMiddleware, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const isRecent = req.query.recent === 'true';
    const searchQuery = (req.query.search || '').trim().slice(0, 100);
    const targetFolderId = req.query.folderId || req.query.folder || null;
    const hasTargetFolder = Boolean(targetFolderId && targetFolderId !== 'null' && targetFolderId !== 'undefined');

    const limit = req.query.limit !== undefined 
      ? parseInt(req.query.limit, 10) 
      : (isRecent ? 10 : 0);
    const skip = parseInt(req.query.skip, 10) || 0;

    // Base filter
    const baseFilter = {
      isTrash: { $ne: true },
      securityStatus: { $in: ['clean', 'unverified'] },
    };

    // FOLDER SCOPING:
    if (hasTargetFolder) {
      // 1. Explicit folder targeted -> scope strictly to that folder
      baseFilter.$or = [
        { folder: targetFolderId },
        { folderId: targetFolderId },
      ];
    } else if (!isRecent && !searchQuery) {
      // 2. Only restrict to root directory ("Home") when browsing Home WITHOUT search or recent
      baseFilter.folder = null;
      baseFilter.folderId = null;
    }
    // 3. When isRecent === true OR searchQuery is active without folderId -> search across ALL folders!

    // Search filter (ReDoS-safe)
    if (searchQuery) {
      const safeSearch = escapeRegex(searchQuery);
      baseFilter.$and = [
        {
          $or: [
            { name: { $regex: safeSearch, $options: 'i' } },
            { originalName: { $regex: safeSearch, $options: 'i' } },
          ],
        },
      ];
    }

    const query = typeof buildTenantQuery === 'function'
      ? buildTenantQuery(rawUserId, baseFilter)
      : { userId: rawUserId, ...baseFilter };

    const totalCount = await File.countDocuments(query);

    let fileQuery = File.find(query)
      .select('name originalName diskName sanitizedName size mimeType mimetype s3Key thumbnailKey securityStatus isMalicious uploadedAt createdAt folder folderId')
      .sort({ uploadedAt: -1, createdAt: -1 });

    if (skip > 0) fileQuery = fileQuery.skip(skip);
    if (limit > 0) fileQuery = fileQuery.limit(limit);

    const rawFiles = await fileQuery.lean();

    const files = rawFiles.map(file => ({
      ...file,
      _id: file._id.toString(),
      id: file.s3Key || file._id.toString(),
      diskName: file.sanitizedName || file.diskName || file.s3Key || file.name,
      name: file.name || file.originalName,
      folderId: file.folderId ? file.folderId.toString() : (file.folder ? file.folder.toString() : null),
      isFolder: false,
      date: new Date(file.uploadedAt || file.createdAt || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      mtimeMs: new Date(file.uploadedAt || file.createdAt || Date.now()).getTime(),
      size: file.size,
      status: (file.securityStatus === 'clean' || file.securityStatus === 'Safe') ? 'Safe' : (file.securityStatus || 'Safe'),
      type: (file.originalName || file.name || '').split('.').pop()
    }));

    res.set('X-Total-Count', String(totalCount));

    // If recent was requested, return pagination metadata
    if (isRecent) {
      return res.status(200).json({
        files,
        total: totalCount,
        hasMore: skip + files.length < totalCount,
      });
    }

    // Otherwise return standard array for folder navigation
    return res.status(200).json(files);
  } catch (err) {
    console.error('Error fetching files:', err);
    return res.status(500).json({ error: 'Failed to retrieve files' });
  }
});

// -------------------------------------------------------------
// 3. PRESIGNED UPLOAD URL GENERATION
// -------------------------------------------------------------
router.post('/presigned-url', authMiddleware, async (req, res) => {
  try {
    // 1. Accept any standard property naming convention
    const fileName = req.body.fileName || req.body.name || req.body.filename || req.body.originalName;
    const fileSize = req.body.fileSize !== undefined ? req.body.fileSize : req.body.size;
    const mimeType = req.body.mimeType || req.body.type || req.body.contentType || 'application/octet-stream';
    const activeFolder = req.body.folderId || req.body.folder || null;
    const validFolder = (activeFolder && mongoose.Types.ObjectId.isValid(String(activeFolder)))
      ? activeFolder
      : null;
    const userId = req.user.id || req.user._id;

    const parsedFileSize = Number(fileSize);
    if (!fileName || !Number.isFinite(parsedFileSize) || parsedFileSize <= 0) {
      return res.status(400).json({ error: 'Filename and valid non-zero file size are required', message: 'Invalid file size' });
    }

    // 2. Storage Quota Enforcement
    const user = await User.findById(userId).select('plan trialExpiresAt storageUsed storageLimit subscription').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now = new Date();
    if ((user.plan === 'trial' || user.subscription?.planId === 'trial') && user.trialExpiresAt && new Date(user.trialExpiresAt) <= now) {
      return res.status(403).json({
        error: 'Your 14-day evaluation trial has ended. Select a plan to restore upload privileges.',
        code: 'TRIAL_EXPIRED'
      });
    }

    if (user.subscription?.status === 'past_due') {
      return res.status(403).json({
        error: 'Your vault is in a read-only grace period. Renew or upgrade your plan to resume uploads.',
        code: 'SUBSCRIPTION_PAST_DUE'
      });
    }

    if (user.subscription?.status === 'expired') {
      return res.status(403).json({
        error: 'Your subscription has expired. Select a plan on the Pricing page to resume uploading.',
        code: 'SUBSCRIPTION_EXPIRED'
      });
    }

    // Storage Quota Enforcement (with in-flight pending_scan quota accounting)
    const uploadSize = Number(fileSize);
    const storageLimit = user.storageLimit || 5368709120;
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
    const pendingAggregation = await File.aggregate([
      {
        $match: {
          $or: [
            { userId: new mongoose.Types.ObjectId(String(userId)) },
            { user: new mongoose.Types.ObjectId(String(userId)) },
          ],
          securityStatus: 'pending_scan',
          createdAt: { $gte: thirtyMinsAgo },
        },
      },
      { $group: { _id: null, totalPending: { $sum: '$size' } } },
    ]);
    const inFlightPendingBytes = pendingAggregation.length > 0 ? (pendingAggregation[0].totalPending || 0) : 0;
    const effectiveUsed = (user.storageUsed || 0) + inFlightPendingBytes;

    if (effectiveUsed + uploadSize > storageLimit) {
      // Determine suggested upgrade tier based on current quota
      let suggestedUpgrade = 'tier_100gb';
      if (storageLimit >= 200 * 1024 * 1024 * 1024) {
        suggestedUpgrade = null; // Max tier reached
      } else if (storageLimit >= 100 * 1024 * 1024 * 1024) {
        suggestedUpgrade = 'tier_200gb';
      }

      return res.status(403).json({
        error: 'Storage quota exceeded. Please upgrade your vault to complete this upload.',
        code: 'QUOTA_EXCEEDED',
        storageUsed: user.storageUsed || 0,
        inFlightPendingBytes,
        effectiveUsed,
        storageLimit,
        requiredBytes: uploadSize,
        suggestedUpgrade
      });
    }

    const sanitized = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const s3Key = `uploads/${userId}/${Date.now()}-${sanitized}`;

    // 3. Pre-create MongoDB record
    const newFile = await File.create({
      name: fileName,
      originalName: fileName,
      sanitizedName: sanitized,
      diskName: sanitized,
      size: Number(fileSize),
      mimeType,
      mimetype: mimeType,
      s3Key,
      userId,
      user: userId,
      folder: validFolder,
      folderId: validFolder,
      isTrash: false,
      isDeleted: false,
      isMalicious: false,
      securityStatus: 'pending_scan',
      uploadedAt: new Date(),
      createdAt: new Date(),
    });

    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      ContentType: mimeType,
    });

    let presignedUrl;
    try {
      presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
    } catch (signErr) {
      console.error('[Presigned URL Signing Error]:', signErr.message || signErr);
      await File.deleteOne({ _id: newFile._id });
      return res.status(502).json({ error: 'Storage provider error generating upload ticket. Please retry.' });
    }

    return res.status(200).json({
      presignedUrl,
      signedUrl: presignedUrl,
      fileId: newFile._id,
      s3Key,
      fileKey: s3Key,
    });
  } catch (err) {
    console.error('Presigned URL error:', err);
    return res.status(500).json({ error: 'Failed to generate upload ticket' });
  }
});

// POST /api/files/multipart/init — Initialize multipart upload for large files (>= 25 MB)
router.post('/multipart/init', authMiddleware, async (req, res) => {
  try {
    const { fileName, fileSize, mimeType, folderId, folder } = req.body;
    const userId = req.user.id || req.user._id;
    const activeFolder = folderId || folder || null;
    const validFolder = (activeFolder && mongoose.Types.ObjectId.isValid(String(activeFolder)))
      ? activeFolder
      : null;

    const parsedFileSize = Number(fileSize);
    if (!fileName || !Number.isFinite(parsedFileSize) || parsedFileSize <= 0) {
      return res.status(400).json({ error: 'Filename and valid non-zero file size are required', message: 'Invalid file size' });
    }

    // 1. Pre-flight storage quota and write-lock checks (identical to single-PUT)
    const user = await User.findById(userId).select('plan trialExpiresAt storageUsed storageLimit subscription').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now = new Date();
    if ((user.plan === 'trial' || user.subscription?.planId === 'trial') && user.trialExpiresAt && new Date(user.trialExpiresAt) <= now) {
      return res.status(403).json({
        error: 'Your 14-day evaluation trial has ended. Select a plan to restore upload privileges.',
        code: 'TRIAL_EXPIRED'
      });
    }

    if (user.subscription?.status === 'past_due') {
      return res.status(403).json({
        error: 'Your vault is in a read-only grace period. Renew or upgrade your plan to resume uploads.',
        code: 'SUBSCRIPTION_PAST_DUE'
      });
    }

    if (user.subscription?.status === 'expired') {
      return res.status(403).json({
        error: 'Your subscription has expired. Select a plan on the Pricing page to resume uploading.',
        code: 'SUBSCRIPTION_EXPIRED'
      });
    }

    const numericFileSize = Number(fileSize);
    const limit = user.storageLimit || 5368709120;
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
    const pendingAggregation = await File.aggregate([
      {
        $match: {
          $or: [
            { userId: new mongoose.Types.ObjectId(String(userId)) },
            { user: new mongoose.Types.ObjectId(String(userId)) },
          ],
          securityStatus: 'pending_scan',
          createdAt: { $gte: thirtyMinsAgo },
        },
      },
      { $group: { _id: null, totalPending: { $sum: '$size' } } },
    ]);
    const inFlightPendingBytes = pendingAggregation.length > 0 ? (pendingAggregation[0].totalPending || 0) : 0;
    const effectiveUsed = (user.storageUsed || 0) + inFlightPendingBytes;

    if (effectiveUsed + numericFileSize > limit) {
      let suggestedUpgrade = 'tier_100gb';
      if (limit >= 200 * 1024 * 1024 * 1024) {
        suggestedUpgrade = null;
      } else if (limit >= 100 * 1024 * 1024 * 1024) {
        suggestedUpgrade = 'tier_200gb';
      }

      return res.status(403).json({
        error: 'Storage quota exceeded. Upgrade required.',
        code: 'QUOTA_EXCEEDED',
        storageUsed: user.storageUsed || 0,
        inFlightPendingBytes,
        effectiveUsed,
        storageLimit: limit,
        requiredBytes: numericFileSize,
        suggestedUpgrade,
      });
    }

    // 2. Key generation & MongoDB pre-creation
    const sanitized = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const s3Key = `uploads/${userId}/${Date.now()}-${sanitized}`;
    const contentType = mimeType || 'application/octet-stream';

    const newFile = await File.create({
      name: fileName,
      originalName: fileName,
      sanitizedName: sanitized,
      diskName: sanitized,
      size: Number(fileSize),
      mimeType: contentType,
      mimetype: contentType,
      s3Key,
      userId,
      user: userId,
      folder: validFolder,
      folderId: validFolder,
      isTrash: false,
      isDeleted: false,
      isMalicious: false,
      securityStatus: 'pending_scan',
      uploadedAt: new Date(),
      createdAt: new Date(),
    });

    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;

    // 3. Initiate S3 / Backblaze B2 Multipart Session
    const createCmd = new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: s3Key,
      ContentType: contentType,
    });

    let UploadId;
    try {
      const initResult = await s3Client.send(createCmd);
      UploadId = initResult.UploadId;
    } catch (s3Err) {
      console.error('[Multipart Init S3 Error]:', s3Err.message || s3Err);
      await File.deleteOne({ _id: newFile._id });
      return res.status(502).json({ error: 'Storage provider error initiating multipart session. Please retry.' });
    }

    // 4. Mobile-optimized part sizing: strictly 10 MB–25 MB (well above Backblaze B2's 5 MB minimum, avoids 5G socket stalls)
    // S3/B2 supports up to 10,000 parts: 25 MB * 10,000 = 250 GB, covering all CloudGuard plan quotas
    let partSize = 10 * 1024 * 1024; // 10 MB default chunk size for smaller multipart files
    if (numericFileSize >= 250 * 1024 * 1024) {
      partSize = 25 * 1024 * 1024; // 25 MB chunk size for files >= 250 MB
    }
    if (numericFileSize > 9000 * 25 * 1024 * 1024) {
      partSize = Math.ceil(numericFileSize / 9000); // Scale up only if > 225 GB to stay under 10k parts
    }
    const totalParts = Math.ceil(numericFileSize / partSize);

    let partUrls;
    try {
      partUrls = await Promise.all(
        Array.from({ length: totalParts }, async (_, idx) => {
          const partNumber = idx + 1;
          const partCmd = new UploadPartCommand({
            Bucket: bucket,
            Key: s3Key,
            UploadId,
            PartNumber: partNumber,
          });
          const signedUrl = await getSignedUrl(s3Client, partCmd, { expiresIn: 14400 });
          return { partNumber, uploadUrl: signedUrl, signedUrl };
        })
      );
    } catch (signErr) {
      console.error('[Multipart Part Signing Error]:', signErr.message || signErr);
      try {
        await s3Client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: s3Key, UploadId }));
      } catch (abortErr) {}
      await File.deleteOne({ _id: newFile._id });
      return res.status(502).json({ error: 'Storage provider error generating part signatures. Please retry.' });
    }

    return res.status(200).json({
      success: true,
      fileId: newFile._id,
      s3Key,
      uploadId: UploadId,
      partSize,
      chunkSize: partSize,
      totalParts,
      partUrls,
    });
  } catch (err) {
    console.error('[Multipart Init Error]:', err);
    return res.status(500).json({ error: 'Failed to initialize multipart upload' });
  }
});

// POST /api/files/multipart/sign-part — Fallback single-part signer
router.post('/multipart/sign-part', authMiddleware, async (req, res) => {
  try {
    const { s3Key, uploadId, partNumber } = req.body;
    if (!s3Key || !uploadId || !partNumber) {
      return res.status(400).json({ error: 'Missing required sign-part parameters' });
    }
    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
    const partCmd = new UploadPartCommand({
      Bucket: bucket,
      Key: s3Key,
      UploadId,
      PartNumber: Number(partNumber),
    });
    const signedUrl = await getSignedUrl(s3Client, partCmd, { expiresIn: 14400 });
    return res.status(200).json({ partNumber: Number(partNumber), uploadUrl: signedUrl, signedUrl });
  } catch (err) {
    console.error('[Sign Part Error]:', err.message || err);
    return res.status(502).json({ error: 'Failed to sign part' });
  }
});

// POST /api/files/multipart/complete — Assemble uploaded chunks into final object
router.post('/multipart/complete', authMiddleware, async (req, res) => {
  try {
    const { fileId, s3Key, uploadId, parts } = req.body;
    const userId = req.user.id || req.user._id;

    if (!fileId || !s3Key || !uploadId || !Array.isArray(parts) || parts.length === 0) {
      return res.status(400).json({ error: 'Missing required multipart completion parameters' });
    }

    if (!mongoose.Types.ObjectId.isValid(String(fileId))) {
      return res.status(400).json({ error: 'Invalid fileId' });
    }

    const file = await File.findOne({ _id: fileId, userId });
    if (!file) return res.status(404).json({ error: 'File record not found' });

    if (!file.size || file.size <= 0) {
      return res.status(400).json({ error: 'Invalid or empty file size for multipart completion' });
    }

    // Write-lock enforcement
    const user = await User.findById(userId).select('plan trialExpiresAt subscription').lean();
    if (user) {
      const now = new Date();
      if ((user.plan === 'trial' || user.subscription?.planId === 'trial') && user.trialExpiresAt && new Date(user.trialExpiresAt) <= now) {
        return res.status(403).json({
          error: 'Your 14-day evaluation trial has ended. Select a plan to restore upload privileges.',
          code: 'TRIAL_EXPIRED',
        });
      }
      if (user.subscription?.status === 'past_due') {
        return res.status(403).json({
          error: 'Your vault is in a read-only grace period. Renew or upgrade your plan to resume uploads.',
          code: 'SUBSCRIPTION_PAST_DUE',
        });
      }
      if (user.subscription?.status === 'expired') {
        return res.status(403).json({
          error: 'Your subscription has expired. Select a plan on the Pricing page to resume uploading.',
          code: 'SUBSCRIPTION_EXPIRED',
        });
      }
    }

    // S3 and Backblaze B2 strictly require parts sorted ascending by PartNumber
    const sortedParts = [...parts]
      .sort((a, b) => Number(a.PartNumber) - Number(b.PartNumber))
      .map((p) => ({
        PartNumber: Number(p.PartNumber),
        ETag: p.ETag,
      }));

    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
    try {
      await s3Client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: s3Key,
          UploadId: uploadId,
          MultipartUpload: { Parts: sortedParts },
        })
      );
    } catch (s3Err) {
      console.error('[Multipart Complete S3 Error]:', s3Err.message || s3Err);
      return res.status(502).json({
        error: 'Storage provider error during multipart assembly. Please retry.',
        details: s3Err.message,
      });
    }

    return res.status(200).json({ success: true, fileId, s3Key });
  } catch (err) {
    console.error('[Multipart Complete Error]:', err.message || err);
    return res.status(500).json({ error: 'Failed to assemble multipart upload', details: err.message });
  }
});

// In-memory set lock to serialize and coalesce concurrent abort calls for the same s3Key
const activeAborts = new Set();

// POST /api/files/cancel-upload & POST /api/files/multipart/abort — Clean up S3 objects & pending DB records
const handleCancelUpload = async (req, res) => {
  const { fileId, s3Key, uploadId } = req.body;
  const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
  const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;

  // Verify ownership and key isolation
  const userMatch = buildTenantQuery(rawUserId);

  // Look up the File document before deleting to obtain s3Key and thumbnailKey
  let existingFile = null;
  const lookupFilter = {
    ...userMatch,
    ...(fileId && mongoose.Types.ObjectId.isValid(String(fileId))
      ? { _id: fileId }
      : (s3Key ? { s3Key } : {})),
  };
  if (lookupFilter._id || lookupFilter.s3Key) {
    try {
      existingFile = await File.findOne(lookupFilter).select('s3Key thumbnailKey securityStatus').lean();
    } catch (e) {
      // ignore lookup error
    }
  }

  const effectiveS3Key = s3Key || existingFile?.s3Key;
  const lockKey = effectiveS3Key || (fileId ? String(fileId) : null);

  // In-memory lock: coalesce concurrent abort calls for the same key
  if (lockKey && activeAborts.has(lockKey)) {
    return res.status(200).json({ success: true, message: 'Abort already in progress' });
  }

  if (lockKey) {
    activeAborts.add(lockKey);
  }

  try {
    // 1. Abort explicit uploadId AND any open multipart uploads matching Prefix: s3Key via ListMultipartUploadsCommand + AbortMultipartUploadCommand
    if (effectiveS3Key && uploadId) {
      try {
        await s3Client.send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: effectiveS3Key,
            UploadId: uploadId,
          })
        );
      } catch (e) {
        if (e.name !== 'NoSuchUpload' && e.code !== 'NoSuchUpload') {
          console.warn('[Upload Abort Multipart S3 Notice]:', e.message);
        }
      }
    }

    if (effectiveS3Key) {
      const userPrefix = `uploads/${String(rawUserId)}/`;
      if (effectiveS3Key.startsWith(userPrefix)) {
        try {
          const listMultiRes = await s3Client.send(
            new ListMultipartUploadsCommand({
              Bucket: bucket,
              Prefix: effectiveS3Key,
            })
          );
          if (Array.isArray(listMultiRes.Uploads)) {
            for (const u of listMultiRes.Uploads) {
              if (u.Key === effectiveS3Key && u.UploadId && u.UploadId !== uploadId) {
                try {
                  await s3Client.send(
                    new AbortMultipartUploadCommand({
                      Bucket: bucket,
                      Key: u.Key,
                      UploadId: u.UploadId,
                    })
                  );
                } catch (abortErr) {
                  // Ignore NoSuchUpload
                }
              }
            }
          }
        } catch (listErr) {
          console.warn('[Multipart Fallback List Notice]:', listErr.message);
        }
      }
    }

    // 2. Run await permanentlyDeleteS3Keys(keysToPurge, rawUserId) immediately
    const keysToPurge = Array.from(
      new Set([s3Key, existingFile?.s3Key, existingFile?.thumbnailKey].filter(Boolean))
    );
    if (keysToPurge.length > 0) {
      try {
        await permanentlyDeleteS3Keys(keysToPurge, rawUserId);
      } catch (delErr) {
        console.warn('[Upload Abort S3 Purge Notice]:', delErr.message);
      }
    }

    // 3. Delete any pending_scan MongoDB records for that fileId / s3Key
    const deleteFilter = {
      ...userMatch,
      securityStatus: 'pending_scan',
      ...(fileId && mongoose.Types.ObjectId.isValid(String(fileId))
        ? { _id: fileId }
        : (effectiveS3Key ? { s3Key: effectiveS3Key } : {})),
    };

    if (deleteFilter._id || deleteFilter.s3Key) {
      await File.deleteMany(deleteFilter);
    }

    // 4. Late-Settling B2 Pod Sweep:
    // Schedule a non-blocking sweep 2000ms after abort so any 0 bytes hide marker created by
    // Backblaze B2's storage pod as in-flight TCP chunks drop is automatically purged via VersionId
    if (keysToPurge.length > 0) {
      setTimeout(async () => {
        try {
          await permanentlyDeleteS3Keys(keysToPurge, rawUserId);
        } catch (sweepErr) {
          // non-blocking cleanup
        } finally {
          if (lockKey) {
            activeAborts.delete(lockKey);
          }
        }
      }, 2000);
    } else {
      if (lockKey) {
        activeAborts.delete(lockKey);
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    if (lockKey) {
      activeAborts.delete(lockKey);
    }
    console.error('[Cancel Upload Error]:', err);
    return res.status(500).json({ error: 'Failed to cancel upload' });
  }
};

router.post('/cancel-upload', authMiddleware, handleCancelUpload);
router.post('/multipart/abort', authMiddleware, handleCancelUpload);

// -------------------------------------------------------------
// 4. FINALIZE UPLOAD & THREAT AUTO-DELETE PIPELINE
// -------------------------------------------------------------
router.post('/finalize-upload', authMiddleware, async (req, res) => {
  let file;
  try {
    const { fileId, sha256, thumbnail } = req.body;
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;

    if (!fileId || !mongoose.Types.ObjectId.isValid(String(fileId))) {
      return res.status(400).json({ error: 'Valid fileId is required' });
    }

    file = await File.findOne(buildTenantQuery(rawUserId, { _id: fileId }));
    if (!file) return res.status(404).json({ error: 'File record not found' });
    if (!file.s3Key) return res.status(400).json({ error: 'File storage key not found' });

    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;

    let actualBytes;
    try {
      const headResult = await s3Client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: file.s3Key,
        })
      );
      actualBytes = headResult.ContentLength;
    } catch (headErr) {
      console.error('[S3 HeadObject Error]:', headErr.message || headErr);
      return res.status(400).json({ success: false, error: 'Uploaded object not found in storage.' });
    }

    // Guard against size <= 0: reject empty files immediately
    if (actualBytes === undefined || actualBytes === null || actualBytes <= 0) {
      console.warn(`[Finalize Upload Guard] Rejecting empty or corrupted file ${file._id} (${file.s3Key}) with size ${actualBytes}`);
      try {
        await permanentlyDeleteS3Keys([file.s3Key, file.thumbnailKey].filter(Boolean), rawUserId);
      } catch (delErr) {
        console.error('[Finalize Empty Delete S3 Error]:', delErr.message);
      }
      await File.deleteOne({ _id: file._id });
      return res.status(400).json({
        success: false,
        error: 'Uploaded file is empty (0 bytes) or could not be read from device.',
      });
    }

    // Enforce storage quota against actual S3 bytes
    const user = await User.findById(rawUserId);
    const now = new Date();
    if (
      user &&
      (user.plan === 'trial' || user.subscription?.planId === 'trial') &&
      user.trialExpiresAt &&
      new Date(user.trialExpiresAt) <= now
    ) {
      try {
        await permanentlyDeleteS3Keys([file.s3Key, file.thumbnailKey].filter(Boolean), rawUserId);
      } catch (delErr) {}
      await File.deleteOne({ _id: file._id });
      return res.status(403).json({
        error: 'Your 14-day evaluation trial has ended. Select a plan to restore upload privileges.',
        code: 'TRIAL_EXPIRED',
      });
    }
    if (user && user.subscription?.status === 'past_due') {
      try {
        await permanentlyDeleteS3Keys([file.s3Key, file.thumbnailKey].filter(Boolean), rawUserId);
      } catch (delErr) {}
      await File.deleteOne({ _id: file._id });
      return res.status(403).json({
        success: false,
        error: 'Uploads locked: subscription is past due or over quota.',
        code: 'SUBSCRIPTION_PAST_DUE'
      });
    }
    if (user && user.subscription?.status === 'expired') {
      try {
        await permanentlyDeleteS3Keys([file.s3Key, file.thumbnailKey].filter(Boolean), rawUserId);
      } catch (delErr) {}
      await File.deleteOne({ _id: file._id });
      return res.status(403).json({
        error: 'Your subscription has expired. Select a plan on the Pricing page to resume uploading.',
        code: 'SUBSCRIPTION_EXPIRED'
      });
    }
    if (user && user.storageUsed + actualBytes > user.storageLimit) {
      try {
        await permanentlyDeleteS3Keys([file.s3Key, file.thumbnailKey].filter(Boolean), rawUserId);
      } catch (delErr) {}
      await File.deleteOne({ _id: file._id });
      return res.status(403).json({ success: false, error: 'Storage limit exceeded by uploaded file.' });
    }

    file.size = actualBytes;

    if (thumbnail && typeof thumbnail === 'string' && thumbnail.startsWith('data:image/')) {
      try {
        const matches = thumbnail.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const buffer = Buffer.from(matches[2], 'base64');
          const thumbS3Key = `thumbnails/${rawUserId}/${Date.now()}-${file._id}.${ext}`;
          const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;

          await s3Client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: thumbS3Key,
            Body: buffer,
            ContentType: `image/${ext}`,
          }));

          file.thumbnailKey = thumbS3Key;
        }
      } catch (thumbErr) {
        console.warn('[Thumbnail S3 Save Notice]:', thumbErr.message);
      }
    }

    // Idempotency: If already clean, return immediately without re-incrementing storage
    if (file.securityStatus === 'clean') {
      if (file.thumbnailKey) {
        await file.save();
      }
      return res.status(200).json({ success: true, isMalicious: false, file });
    }

    const normalizedHash = (sha256 || '').toLowerCase().trim();

    // 0. STRICT CRYPTOGRAPHIC WHITELIST: Antigravity ONLY via verified SHA-256
    if (normalizedHash && ANTIGRAVITY_HASH_WHITELIST.has(normalizedHash)) {
      console.log(`[CloudGuard Security] Verified clean via Antigravity SHA-256 whitelist: ${normalizedHash}`);
      
      const claimedFile = await File.findOneAndUpdate(
        buildTenantQuery(rawUserId, { _id: file._id, securityStatus: 'pending_scan' }),
        {
          $set: {
            securityStatus: 'clean',
            isMalicious: false,
            status: 'safe',
            size: actualBytes,
            ...(file.thumbnailKey ? { thumbnailKey: file.thumbnailKey } : {}),
          },
        },
        { new: true }
      );

      if (claimedFile) {
        const u = await User.findByIdAndUpdate(
          rawUserId,
          { $inc: { storageUsed: claimedFile.size } },
          { new: true }
        );
        if (u) {
          const newStorageUsed = u.storageUsed || 0;
          await User.findByIdAndUpdate(rawUserId, {
            $max: {
              peakStorageBytes: newStorageUsed,
              'subscription.peakStorageBytes': newStorageUsed,
            },
          });
        }
        return res.status(200).json({
          success: true,
          isMalicious: false,
          file: claimedFile,
        });
      }

      const existingFile = await File.findOne(buildTenantQuery(rawUserId, { _id: file._id }));
      return res.status(200).json({
        success: true,
        isMalicious: false,
        file: existingFile || file,
      });
    }

    let isMalicious = false;
    let threatReason = '';

    const lowerName = (file.name || '').toLowerCase();

    // 1. Signature / Test Pattern Intercept
    if (
      lowerName.includes('eicar') ||
      lowerName.includes('test virus') ||
      lowerName === 'nfs13.exe' ||
      lowerName.includes('preactivated') ||
      (lowerName.includes('idm') && (lowerName.includes('crack') || lowerName.includes('patch') || lowerName.includes('repack'))) ||
      lowerName.includes('trojan')
    ) {
      isMalicious = true;
      threatReason = 'Known malicious test signature / pirated crack pattern';
    }

    // 2. Direct MalwareBazaar Threat Intelligence Lookup (SHA-256)
    if (!isMalicious && sha256) {
      const mbCheck = await checkMalwareBazaarNode(sha256);
      if (mbCheck.isMalicious) {
        isMalicious = true;
        threatReason = mbCheck.threat;
      }
    }

    // 2.5 EICAR Content Inspection (Fetch initial 1 KB payload from S3)
    if (!isMalicious && actualBytes > 0) {
      try {
        const getCmd = new GetObjectCommand({
          Bucket: bucket,
          Key: file.s3Key,
          ...(actualBytes > 1024 ? { Range: 'bytes=0-1023' } : {}),
        });
        const s3Obj = await s3Client.send(getCmd);
        const streamChunks = [];
        for await (const chunk of s3Obj.Body) {
          streamChunks.push(chunk);
        }
        const sampleBuffer = Buffer.concat(streamChunks);
        const sampleText = sampleBuffer.toString('utf8');

        const EICAR_STANDARD_STRING = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
        if (
          sampleText.includes(EICAR_STANDARD_STRING) ||
          sampleText.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')
        ) {
          console.log(`[CloudGuard Security] Threat intercepted: EICAR content signature detected in ${file.s3Key}`);
          try {
            await permanentlyDeleteS3Keys([file.s3Key, file.thumbnailKey].filter(Boolean), rawUserId);
          } catch (delErr) {
            console.error('[S3 Delete Error on EICAR]:', delErr.message);
          }

          // Permanently remove the database record
          await File.deleteOne({ _id: file._id });

          return res.status(200).json({
            success: false,
            isMalicious: true,
            message: `Threat detected: "${file.name}" was automatically deleted from vault.`,
          });
        }
      } catch (eicarErr) {
        console.warn('[EICAR Content Check Notice]:', eicarErr.message);
      }
    }

    // 3. AI Service Deep Scan (Extended 20s timeout for large binaries like AC4BFSP.exe)
    if (!isMalicious) {
      try {
        const aiBase = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';
        const scanUrl = aiBase.endsWith('/scan') ? aiBase : `${aiBase}/scan`;
        const scanRes = await axios.post(
          scanUrl,
          { 
            s3Key: file.s3Key, 
            fileName: file.name, 
            fileSize: file.size,
            sha256,
            fileKey: file.s3Key,
            filename: file.name
          },
          { timeout: 20000 } // 20s timeout for large executables
        );

        if (scanRes.data && (scanRes.data.isMalicious || scanRes.data.status === 'malicious')) {
          isMalicious = true;
          threatReason = scanRes.data.reason || 'AI heuristic threat detected';
        }
      } catch (scanErr) {
        console.warn('AI Scanner unreachable/timed out:', scanErr.message);
        // Only mark unverified if it's an executable and the scanner dropped
        if (lowerName.endsWith('.exe') || lowerName.endsWith('.dll')) {
          file.securityStatus = 'unverified';
          await file.save();
          return res.status(200).json({
            success: true,
            isMalicious: false,
            warning: 'Deep scan timed out. Marked unverified.',
            file,
          });
        }
      }
    }

    // 4. HARD AUTO-DELETE ON THREAT (Zero Quarantine, Zero Email Alerts)
    if (isMalicious) {
      console.log(`[CloudGuard Threat Alert] Purging malicious object from S3: ${file.s3Key} (${threatReason})`);

      try {
        await permanentlyDeleteS3Keys([file.s3Key, file.thumbnailKey].filter(Boolean), rawUserId);
      } catch (delErr) {
        console.error('[S3 Delete Error]:', delErr.message);
      }

      if (threatReason.toLowerCase().includes('eicar')) {
        await File.deleteOne({ _id: file._id });
        return res.status(200).json({
          success: false,
          isMalicious: true,
          message: `Threat detected: "${file.name}" was automatically deleted from vault.`,
        });
      }

      file.isMalicious = true;
      file.securityStatus = 'threat_purged';
      file.status = 'malicious';
      file.size = 0;
      await file.save();

      return res.status(200).json({
        success: false,
        isMalicious: true,
        message: `Threat intercepted (${threatReason}). File was automatically deleted.`,
        file,
      });
    }

    // 5. Commit Clean File with Atomic Claim
    const claimedFile = await File.findOneAndUpdate(
      buildTenantQuery(rawUserId, { _id: file._id, securityStatus: 'pending_scan' }),
      {
        $set: {
          securityStatus: 'clean',
          isMalicious: false,
          status: 'safe',
          size: actualBytes,
          ...(file.thumbnailKey ? { thumbnailKey: file.thumbnailKey } : {}),
        },
      },
      { new: true }
    );

    if (claimedFile) {
      const u = await User.findByIdAndUpdate(
        rawUserId || file.userId,
        { $inc: { storageUsed: claimedFile.size } },
        { new: true }
      );
      if (u) {
        const newStorageUsed = u.storageUsed || 0;
        await User.findByIdAndUpdate(rawUserId || file.userId, {
          $max: {
            peakStorageBytes: newStorageUsed,
            'subscription.peakStorageBytes': newStorageUsed,
          },
        });
      }
      return res.status(200).json({
        success: true,
        isMalicious: false,
        file: claimedFile,
      });
    }

    // Idempotency: If already claimed and marked clean by concurrent request, return clean record without double-incrementing quota
    const existingFile = await File.findOne(buildTenantQuery(rawUserId, { _id: file._id }));
    return res.status(200).json({
      success: true,
      isMalicious: false,
      file: existingFile || file,
    });
  } catch (err) {
    console.error('[Finalize Upload Error] Initiating S3 rollback cleanup:', err.message);

    // If s3Key exists in request or resolved file, purge the binary so an incomplete upload never remains orphaned
    const targetS3Key = req.body?.s3Key || file?.s3Key;
    if (targetS3Key) {
      try {
        const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
        await permanentlyDeleteS3Keys(s3Client, bucket, targetS3Key);
        console.log(`[Rollback] Removed orphaned S3 object: ${targetS3Key}`);
      } catch (cleanupErr) {
        console.warn('[Rollback Warning] Could not remove S3 object on finalize failure:', cleanupErr.message);
      }
    }

    return res.status(500).json({ error: 'Failed to finalize upload' });
  }
});

// -------------------------------------------------------------
// 5. PURGE STALE TEST THREATS FROM DATABASE & S3
// -------------------------------------------------------------
router.delete('/purge-test-threats', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const userMatch = mongoose.Types.ObjectId.isValid(userId)
      ? { $in: [String(userId), new mongoose.Types.ObjectId(userId)] }
      : String(userId);

    const threats = await File.find({
      $or: [{ userId: userMatch }, { user: userMatch }],
      name: { $regex: /eicar|test virus|nfs13|preactivated|oyemaza|idm.*crack|trojan/i },
    });

    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
    const threatKeys = [];
    for (const f of threats) {
      if (f.s3Key) threatKeys.push(f.s3Key);
      if (f.thumbnailKey) threatKeys.push(f.thumbnailKey);
    }
    if (threatKeys.length > 0) {
      try {
        await permanentlyDeleteS3Keys(s3Client, bucket, threatKeys);
      } catch (e) {}
    }

    await File.deleteMany({
      $or: [{ userId: userMatch }, { user: userMatch }],
      name: { $regex: /eicar|test virus|nfs13|preactivated|oyemaza|idm.*crack|trojan/i },
    });

    res.json({ success: true, purgedCount: threats.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 6. SOFT-DELETE SINGLE FILE (30-DAY BIN LIFECYCLE)
// -------------------------------------------------------------
const handleSingleFileDelete = async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id || req.user.userId;
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }

    const file = await File.findOne({
      _id: req.params.id,
      $or: [{ userId: rawUserId }, { user: rawUserId }],
    });

    if (!file) return res.status(404).json({ error: 'File not found' });

    file.isTrash = true;
    file.trashedAt = new Date();
    await file.save();

    // In 30-Day Bin lifecycle: items stay in Backblaze B2 and continue counting toward storage quota.
    // Zero quota deduction and zero premature purge on soft-delete!

    return res.status(200).json({
      success: true,
      message: 'Moved to Bin • Auto-deletes in 30 days',
      fileId: file._id,
      deletedId: file._id,
      trashedAt: file.trashedAt,
    });
  } catch (err) {
    console.error('Delete file error:', err);
    return res.status(500).json({ error: 'Failed to delete file' });
  }
};

router.delete('/:id', authMiddleware, handleSingleFileDelete);

// -------------------------------------------------------------
// 7. BATCH SOFT-DELETE FILES & FOLDERS (30-DAY BIN LIFECYCLE)
// -------------------------------------------------------------
const handleBatchDelete = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    const { fileIds = [], folderIds = [] } = req.body;
    const userMatch = { $or: [{ userId: rawUserId }, { user: rawUserId }] };

    const validFileIds = toValidObjectIds(fileIds);
    const validFolderIds = toValidObjectIds(folderIds);

    // Zero-wildcard guard
    if (validFileIds.length === 0 && validFolderIds.length === 0) {
      return res.status(200).json({
        success: true,
        deletedFiles: 0,
        deletedFolders: 0,
        deletedCount: 0,
      });
    }

    const trashedAt = new Date();

    if (validFileIds.length > 0) {
      await File.updateMany(
        { _id: { $in: validFileIds }, ...userMatch },
        { $set: { isTrash: true, trashedAt } }
      );
    }

    if (validFolderIds.length > 0) {
      const allFolderObjectIds = [...validFolderIds];
      for (const fId of validFolderIds) {
        const descendants = await getDescendantFolderIds(fId, userMatch, false);
        allFolderObjectIds.push(...descendants);
      }

      const uniqueFolderObjectIds = toValidObjectIds(allFolderObjectIds);
      if (uniqueFolderObjectIds.length > 0) {
        const uniqueFolderStringIds = uniqueFolderObjectIds.map((id) => String(id));

        await Folder.updateMany(
          { _id: { $in: uniqueFolderObjectIds }, ...userMatch },
          { $set: { isTrash: true, trashedAt } }
        );

        await File.updateMany(
          {
            $and: [
              userMatch,
              {
                $or: [
                  { folder: { $in: uniqueFolderObjectIds } },
                  { folderId: { $in: uniqueFolderObjectIds } },
                  { folder: { $in: uniqueFolderStringIds } },
                  { folderId: { $in: uniqueFolderStringIds } },
                ],
              },
            ],
          },
          { $set: { isTrash: true, trashedAt } }
        );
      }
    }

    // In 30-Day Bin lifecycle: items stay in Backblaze B2 and continue counting toward storage quota.
    // Zero quota deduction and zero premature purge on soft-delete!

    return res.status(200).json({
      success: true,
      message: 'Moved to Bin • Auto-deletes in 30 days',
      deletedFiles: validFileIds.length,
      deletedFolders: validFolderIds.length,
      deletedCount: validFileIds.length + validFolderIds.length,
    });
  } catch (err) {
    console.error('Batch delete error:', err);
    return res.status(500).json({ error: 'Failed to delete items' });
  }
};

router.post('/delete-batch', authMiddleware, handleBatchDelete);
router.post('/batch-delete', authMiddleware, handleBatchDelete);
router.post('/bulk-delete', authMiddleware, handleBatchDelete);

// -------------------------------------------------------------
// 8. 30-DAY BIN (TRASH) ENDPOINTS: GET, RESTORE, PERMANENT DELETE
// -------------------------------------------------------------

/**
 * GET /api/files/bin
 * Returns all top-level trashed folders and files with countdowns
 */
const handleGetBin = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    const userMatch = { $or: [{ userId: rawUserId }, { user: rawUserId }] };

    // Fetch all trashed folders and files for user
    const [allTrashedFolders, allTrashedFiles] = await Promise.all([
      Folder.find({ ...userMatch, isTrash: true }).sort({ trashedAt: -1, createdAt: -1 }).lean(),
      File.find({ ...userMatch, isTrash: true }).sort({ trashedAt: -1, createdAt: -1 }).lean(),
    ]);

    const trashedFolderIdSet = new Set(allTrashedFolders.map((f) => String(f._id)));

    // Top-level trashed folders: parentId is null or parentId is NOT also in trash
    const topLevelFolders = allTrashedFolders.filter(
      (f) => !f.parentId || !trashedFolderIdSet.has(String(f.parentId))
    );

    // Top-level trashed files: folderId/folder is null or is NOT in trashedFolderIdSet
    const topLevelFiles = allTrashedFiles.filter(
      (f) => (!f.folder && !f.folderId) || !trashedFolderIdSet.has(String(f.folderId || f.folder))
    );

    // Calculate folder sizes and file counts in memory
    const folderToFiles = new Map();
    for (const f of allTrashedFiles) {
      const pId = String(f.folderId || f.folder || '');
      if (pId) {
        if (!folderToFiles.has(pId)) folderToFiles.set(pId, []);
        folderToFiles.get(pId).push(f);
      }
    }

    // Pre-build adjacency map for descendant lookup in memory
    const parentToChildren = new Map();
    for (const f of allTrashedFolders) {
      const p = f.parentId || f.parentFolder;
      if (p) {
        const pStr = String(p);
        if (!parentToChildren.has(pStr)) parentToChildren.set(pStr, []);
        parentToChildren.get(pStr).push(String(f._id));
      }
    }

    const getDescendantsInMemory = (rootId) => {
      const visited = new Set([String(rootId)]);
      const queue = [String(rootId)];
      const res = [];
      while (queue.length > 0) {
        const curr = queue.shift();
        const children = parentToChildren.get(curr) || [];
        for (const ch of children) {
          if (!visited.has(ch)) {
            visited.add(ch);
            res.push(ch);
            queue.push(ch);
          }
        }
      }
      return res;
    };

    const now = Date.now();

    const foldersWithStats = topLevelFolders.map((folder) => {
      const folderIdStr = String(folder._id);
      const allSubFolderIds = [folderIdStr, ...getDescendantsInMemory(folderIdStr)];
      let folderBytes = 0;
      let folderFileCount = 0;

      for (const sfId of allSubFolderIds) {
        const cFiles = folderToFiles.get(sfId) || [];
        folderFileCount += cFiles.length;
        for (const cf of cFiles) {
          folderBytes += (cf.size || 0);
        }
      }

      const trashedTimestamp = new Date(folder.trashedAt || folder.updatedAt || now).getTime();
      const daysAgo = Math.max(0, Math.floor((now - trashedTimestamp) / 86400000));
      const daysRemaining = Math.max(0, 30 - daysAgo);

      return {
        ...folder,
        type: 'folder',
        isFolder: true,
        size: folderBytes,
        fileCount: folderFileCount,
        daysRemaining,
        deletedDaysAgo: daysAgo,
      };
    });

    const filesWithStats = topLevelFiles.map((file) => {
      const trashedTimestamp = new Date(file.trashedAt || file.createdAt || now).getTime();
      const daysAgo = Math.max(0, Math.floor((now - trashedTimestamp) / 86400000));
      const daysRemaining = Math.max(0, 30 - daysAgo);

      return {
        ...file,
        type: 'file',
        isFolder: false,
        daysRemaining,
        deletedDaysAgo: daysAgo,
      };
    });

    const totalCount = foldersWithStats.length + filesWithStats.length;
    const totalBytes = allTrashedFiles.reduce((sum, f) => sum + (f.size || 0), 0);

    return res.status(200).json({
      success: true,
      folders: foldersWithStats,
      files: filesWithStats,
      totalCount,
      totalBytes,
    });
  } catch (err) {
    console.error('Get bin error:', err);
    return res.status(500).json({ error: 'Failed to fetch items in Bin' });
  }
};

/**
 * POST /api/files/bin/restore (and alias /api/files/restore-batch)
 * Restores items from Bin to their original folder (or root if parent was deleted)
 */
const handleBinRestore = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    const userMatch = { $or: [{ userId: rawUserId }, { user: rawUserId }] };
    const { fileIds = [], folderIds = [], restoreAll = false } = req.body;

    if (restoreAll) {
      // 1. Restore all trashed files & folders for user
      await Promise.all([
        File.updateMany({ ...userMatch, isTrash: true }, { $set: { isTrash: false, trashedAt: null } }),
        Folder.updateMany({ ...userMatch, isTrash: true }, { $set: { isTrash: false, trashedAt: null } }),
      ]);

      // 2. Validate all parent references in one pass
      const allActiveFolders = await Folder.find({ ...userMatch, isTrash: { $ne: true } }).select('_id').lean();
      const activeFolderSet = new Set(allActiveFolders.map((f) => String(f._id)));

      const filesToCheck = await File.find({
        ...userMatch,
        $or: [{ folder: { $ne: null } }, { folderId: { $ne: null } }],
      }).select('_id folder folderId').lean();

      const orphanedFileIds = filesToCheck
        .filter((f) => !activeFolderSet.has(String(f.folderId || f.folder)))
        .map((f) => f._id);

      if (orphanedFileIds.length > 0) {
        await File.updateMany(
          { _id: { $in: orphanedFileIds } },
          { $set: { folder: null, folderId: null } }
        );
      }

      return res.status(200).json({
        success: true,
        message: 'All items restored from Bin',
        restoredAll: true,
      });
    }

    const validFileIds = toValidObjectIds(fileIds);
    const validFolderIds = toValidObjectIds(folderIds);

    if (validFileIds.length === 0 && validFolderIds.length === 0) {
      return res.status(200).json({ success: true, restoredCount: 0 });
    }

    // If folder IDs provided, also resolve all descendant folders in trash
    const allFolderObjectIds = [...validFolderIds];
    for (const fId of validFolderIds) {
      const descendants = await getDescendantFolderIds(fId, userMatch, true);
      allFolderObjectIds.push(...descendants);
    }
    const uniqueFolderObjectIds = toValidObjectIds(allFolderObjectIds);

    // 1. Restore folders
    if (uniqueFolderObjectIds.length > 0) {
      await Folder.updateMany(
        { _id: { $in: uniqueFolderObjectIds }, ...userMatch },
        { $set: { isTrash: false, trashedAt: null } }
      );

      const uniqueFolderStringIds = uniqueFolderObjectIds.map((id) => String(id));

      // Restore child files inside those folders
      await File.updateMany(
        {
          $and: [
            userMatch,
            {
              $or: [
                { folder: { $in: uniqueFolderObjectIds } },
                { folderId: { $in: uniqueFolderObjectIds } },
                { folder: { $in: uniqueFolderStringIds } },
                { folderId: { $in: uniqueFolderStringIds } },
              ],
            },
          ],
        },
        { $set: { isTrash: false, trashedAt: null } }
      );
    }

    // 2. Restore individual files
    if (validFileIds.length > 0) {
      await File.updateMany(
        { _id: { $in: validFileIds }, ...userMatch },
        { $set: { isTrash: false, trashedAt: null } }
      );
    }

    // 3. Safety reattachment check: if an item's parent folder is still in Bin or doesn't exist, reset to root
    const allActiveFolders = await Folder.find({ ...userMatch, isTrash: { $ne: true } }).select('_id').lean();
    const activeFolderSet = new Set(allActiveFolders.map((f) => String(f._id)));

    if (validFileIds.length > 0) {
      const restoredFiles = await File.find({ _id: { $in: validFileIds } }).select('_id folder folderId').lean();
      const orphanedFileIds = restoredFiles
        .filter((f) => {
          const pId = String(f.folderId || f.folder || '');
          return pId && !activeFolderSet.has(pId);
        })
        .map((f) => f._id);

      if (orphanedFileIds.length > 0) {
        await File.updateMany(
          { _id: { $in: orphanedFileIds } },
          { $set: { folder: null, folderId: null } }
        );
      }
    }

    if (uniqueFolderObjectIds.length > 0) {
      const restoredFolders = await Folder.find({ _id: { $in: uniqueFolderObjectIds } }).select('_id parentId parentFolder').lean();
      const orphanedFolderIds = restoredFolders
        .filter((f) => {
          const pId = String(f.parentId || f.parentFolder || '');
          return pId && !activeFolderSet.has(pId);
        })
        .map((f) => f._id);

      if (orphanedFolderIds.length > 0) {
        await Folder.updateMany(
          { _id: { $in: orphanedFolderIds } },
          { $set: { parentId: null, parentFolder: null } }
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Items restored from Bin',
      restoredFiles: validFileIds.length,
      restoredFolders: uniqueFolderObjectIds.length,
      restoredCount: validFileIds.length + uniqueFolderObjectIds.length,
    });
  } catch (err) {
    console.error('Restore bin error:', err);
    return res.status(500).json({ error: 'Failed to restore items from Bin' });
  }
};

/**
 * DELETE /api/files/bin/permanent
 * Permanently deletes items from Backblaze B2, drops MongoDB docs, and decrements quota
 */
const handleBinPermanentDelete = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    const userMatch = { $or: [{ userId: rawUserId }, { user: rawUserId }] };
    const { fileIds = [], folderIds = [], emptyAll = false } = req.body;

    let filesToDelete = [];
    let foldersToDelete = [];

    if (emptyAll) {
      // Empty entire Bin for user
      [filesToDelete, foldersToDelete] = await Promise.all([
        File.find({ ...userMatch, isTrash: true }).select('_id s3Key thumbnailKey size').lean(),
        Folder.find({ ...userMatch, isTrash: true }).select('_id').lean(),
      ]);
    } else {
      const validFileIds = toValidObjectIds(fileIds);
      const validFolderIds = toValidObjectIds(folderIds);

      if (validFileIds.length === 0 && validFolderIds.length === 0) {
        return res.status(200).json({
          success: true,
          deletedFiles: 0,
          deletedFolders: 0,
          freedBytes: 0,
        });
      }

      // Resolve all descendant folders
      const allFolderObjectIds = [...validFolderIds];
      for (const fId of validFolderIds) {
        const descendants = await getDescendantFolderIds(fId, userMatch, true);
        allFolderObjectIds.push(...descendants);
      }
      const uniqueFolderObjectIds = toValidObjectIds(allFolderObjectIds);
      const uniqueFolderStringIds = uniqueFolderObjectIds.map((id) => String(id));

      const fileConditions = [];
      if (validFileIds.length > 0) {
        fileConditions.push({ _id: { $in: validFileIds } });
      }
      if (uniqueFolderObjectIds.length > 0) {
        fileConditions.push(
          { folder: { $in: uniqueFolderObjectIds } },
          { folderId: { $in: uniqueFolderObjectIds } },
          { folder: { $in: uniqueFolderStringIds } },
          { folderId: { $in: uniqueFolderStringIds } }
        );
      }

      filesToDelete = await File.find({
        $and: [userMatch, { isTrash: true }, { $or: fileConditions }],
      }).select('_id s3Key thumbnailKey size').lean();

      if (uniqueFolderObjectIds.length > 0) {
        foldersToDelete = await Folder.find({
          _id: { $in: uniqueFolderObjectIds },
          ...userMatch,
          isTrash: true,
        }).select('_id').lean();
      }
    }

    // 1. Collect all S3 / B2 keys to permanently erase
    const keysToPurge = filesToDelete
      .flatMap((f) => [f.s3Key, f.thumbnailKey])
      .filter(Boolean);

    if (keysToPurge.length > 0) {
      try {
        await permanentlyDeleteS3Keys(keysToPurge, rawUserId);
      } catch (s3Err) {
        console.warn('[Bin Permanent Delete S3 Warning]:', s3Err.message);
      }
    }

    // 2. Sum freed bytes
    const freedBytes = filesToDelete.reduce((sum, f) => sum + (f.size || 0), 0);

    // 3. Delete records from MongoDB
    const fileIdsToDelete = filesToDelete.map((f) => f._id);
    const folderIdsToDelete = foldersToDelete.map((f) => f._id);

    if (fileIdsToDelete.length > 0) {
      await File.deleteMany({ _id: { $in: fileIdsToDelete } });
    }
    if (folderIdsToDelete.length > 0) {
      await Folder.deleteMany({ _id: { $in: folderIdsToDelete } });
    }

    // 4. Decrement user.storageUsed
    if (freedBytes > 0) {
      const u = await User.findById(rawUserId);
      if (u) {
        u.storageUsed = Math.max(0, (u.storageUsed || 0) - freedBytes);
        await u.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Items permanently deleted',
      deletedFiles: fileIdsToDelete.length,
      deletedFolders: folderIdsToDelete.length,
      deletedCount: fileIdsToDelete.length + folderIdsToDelete.length,
      freedBytes,
    });
  } catch (err) {
    console.error('Permanent delete error:', err);
    return res.status(500).json({ error: 'Failed to permanently delete items' });
  }
};

router.get('/bin', authMiddleware, handleGetBin);
router.post('/bin/restore', authMiddleware, handleBinRestore);
router.delete('/bin/permanent', authMiddleware, handleBinPermanentDelete);
router.post('/restore-batch', authMiddleware, handleBinRestore);
router.post('/batch-restore', authMiddleware, handleBinRestore);

// -------------------------------------------------------------
// 9. DYNAMIC LIVE STORAGE AGGREGATION
// -------------------------------------------------------------
const getStorageStats = async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id;
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

    // Calculate real active storage (retains items in 30-Day Bin, excludes only purged & pending scans)
    const stats = await File.aggregate([
      {
        $match: {
          securityStatus: { $nin: ['threat_purged', 'pending_scan'] },
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

    // Synchronize user record in background
    const userDoc = await User.findById(rawUserId);
    if (userDoc) {
      userDoc.storageUsed = actualStorageUsed;
      const newPeak = Math.max(userDoc.peakStorageBytes || 0, userDoc.subscription?.peakStorageBytes || 0, actualStorageUsed);
      userDoc.peakStorageBytes = newPeak;
      if (userDoc.subscription) {
        userDoc.subscription.peakStorageBytes = newPeak;
      }
      await userDoc.save();
    }

    const user = await User.findById(rawUserId).select('storageLimit').lean();
    const storageLimit = user?.storageLimit || 5368709120; // 5 GB

    return res.status(200).json({
      storageUsed: actualStorageUsed,
      used: actualStorageUsed,
      usedBytes: actualStorageUsed,
      storageLimit,
      limit: storageLimit,
      totalLimitBytes: storageLimit,
      percentage: Math.min(100, (actualStorageUsed / storageLimit) * 100).toFixed(1),
      usedPercentage: Math.min(100, (actualStorageUsed / storageLimit) * 100).toFixed(1),
      success: true,
    });
  } catch (err) {
    console.error('Storage stats error:', err);
    return res.status(500).json({ error: 'Failed to retrieve storage stats' });
  }
};

const handleStorageStats = getStorageStats;
router.get('/storage-stats', authMiddleware, getStorageStats);

/**
 * GET /api/files/photos
 * Vault-wide photos and media endpoint
 */
router.get('/photos', authMiddleware, (req, res, next) => require('./photos').handleGetPhotos(req, res, next));

/**
 * GET /api/files/:id/download-url and GET /api/files/:id/download
 * Generates fresh on-demand S3 presigned download URL with ResponseContentDisposition attachment
 */
const handleGetDownloadUrl = async (req, res) => {
  try {
    const rawUserId = req.user?._id || req.user?.id;
    if (!rawUserId && !req.user?.isAdmin) {
      return res.status(401).json({ error: 'Unauthorized: User identity missing' });
    }

    const query = req.user?.isAdmin
      ? { _id: req.params.id }
      : buildTenantQuery(rawUserId, { _id: req.params.id });

    const file = await File.findOne(query);
    if (!file) return res.status(404).json({ error: 'File not found' });

    let targetKey = file.s3Key || file.key;
    if (!targetKey && file.location) {
      try {
        const urlObj = new URL(file.location);
        targetKey = decodeURIComponent(urlObj.pathname.substring(1).replace(/\+/g, '%20'));
      } catch (e) {}
    }

    if (!targetKey) return res.status(400).json({ error: 'S3 Key missing' });

    const fileName = file.originalName || file.name || 'download';
    const safeAsciiName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '');
    const encodedName = encodeURIComponent(fileName).replace(/['()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/\*/g, '%2A');
    const contentDisposition = `attachment; filename="${safeAsciiName || 'download'}"; filename*=UTF-8''${encodedName}`;

    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME || process.env.B2_BUCKET_NAME || 'cloudguard-vault-mumbai-2026';

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: targetKey,
      ResponseContentDisposition: contentDisposition,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return res.json({
      success: true,
      downloadUrl: applyCdnToUrl(downloadUrl),
      url: applyCdnToUrl(downloadUrl),
      name: fileName,
      size: file.size || 0
    });
  } catch (err) {
    console.error('Failed to generate presigned download URL:', err);
    return res.status(500).json({ error: 'Failed to generate download link' });
  }
};

router.get('/:id/download-url', authMiddleware, handleGetDownloadUrl);
router.get('/:id/download', authMiddleware, handleGetDownloadUrl);

// -------------------------------------------------------------
// 7. SECURE FILE MOVE ROUTE (PUT & PATCH /:id/move)
// -------------------------------------------------------------
const handleFileMove = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    const userId = rawUserId;
    const userMatch = mongoose.Types.ObjectId.isValid(userId)
      ? { $in: [String(userId), new mongoose.Types.ObjectId(userId)] }
      : String(userId);

    const { folderId, folder, parentId, targetFolderId } = req.body;
    const rawTarget = folderId !== undefined ? folderId : (folder !== undefined ? folder : (parentId !== undefined ? parentId : targetFolderId));
    const targetParentId = !rawTarget || rawTarget === 'null' || rawTarget === 'undefined' || rawTarget === 'root' ? null : rawTarget;

    if (targetParentId) {
      const destFolder = await Folder.findOne(
        buildTenantQuery(rawUserId, { _id: targetParentId, isTrash: { $ne: true } })
      );
      if (!destFolder) {
        return res.status(404).json({ success: false, error: 'Destination folder not found or unauthorized' });
      }
    }

    const file = await File.findOne({
      _id: req.params.id,
      $or: [{ userId: userMatch }, { user: userMatch }],
      isTrash: false
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    file.folder = targetParentId;
    file.folderId = targetParentId;
    await file.save();

    return res.status(200).json({ success: true, file });
  } catch (err) {
    console.error('Error moving file:', err);
    return res.status(500).json({ error: 'Failed to move file' });
  }
};

router.put('/:id/move', authMiddleware, handleFileMove);
router.patch('/:id/move', authMiddleware, handleFileMove);

/**
 * PATCH & PUT /:id/rename and /:id - File rename with length cap (1-120 chars)
 */
const handleFileRename = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId) return res.status(401).json({ error: 'Authentication required' });

    const userMatch = mongoose.Types.ObjectId.isValid(rawUserId)
      ? { $in: [String(rawUserId), new mongoose.Types.ObjectId(rawUserId)] }
      : String(rawUserId);

    const { name, newName } = req.body;
    const trimmedName = (name || newName || '').trim();

    if (!trimmedName || trimmedName.length > 120) {
      return res.status(400).json({
        error: 'File name must be between 1 and 120 characters',
        message: 'File name must be between 1 and 120 characters'
      });
    }

    const file = await File.findOne({
      _id: req.params.id,
      $or: [{ userId: userMatch }, { user: userMatch }],
      isTrash: false
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    file.name = trimmedName;
    file.originalName = trimmedName;
    await file.save();

    return res.status(200).json({ success: true, file });
  } catch (err) {
    console.error('File rename error:', err);
    return res.status(500).json({ error: 'Failed to rename file' });
  }
};

router.patch('/:id/rename', authMiddleware, handleFileRename);
router.put('/:id/rename', authMiddleware, handleFileRename);

/**
 * PUT /folder/:id & PATCH /folder/:id - Rename/Move folder with duplicate name guard
 */
const handleFolderRenameInFiles = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, newName, parentId, targetFolderId } = req.body;
    const trimmedName = (name || newName || '').trim();

    if (trimmedName && trimmedName.length > 60) {
      return res.status(400).json({
        error: 'Folder name must be between 1 and 60 characters',
        message: 'Folder name must be between 1 and 60 characters'
      });
    }
    const userId = req.user?._id || req.user?.id;
    const userMatch = mongoose.Types.ObjectId.isValid(userId)
      ? { $in: [String(userId), new mongoose.Types.ObjectId(userId)] }
      : String(userId);

    // If name is omitted but destination is provided, execute move
    if (!trimmedName && (parentId !== undefined || targetFolderId !== undefined)) {
      const dest = parentId !== undefined ? parentId : targetFolderId;
      const targetParentId = dest === 'null' || dest === 'root' || !dest ? null : dest;
      if (id === targetParentId) {
        return res.status(400).json({ error: 'Cannot move a folder into itself' });
      }
      if (targetParentId) {
        const destFolder = await Folder.findOne(
          buildTenantQuery(userId, { _id: targetParentId, isTrash: { $ne: true } })
        );
        if (!destFolder) {
          return res.status(404).json({ success: false, error: 'Destination folder not found or unauthorized' });
        }
      }
      const targetFolder = await Folder.findOne({ _id: id, $or: [{ userId: userMatch }, { user: userMatch }] });
      if (!targetFolder) return res.status(404).json({ error: 'Folder not found' });
      targetFolder.parentId = targetParentId;
      targetFolder.parentFolder = targetParentId;
      await targetFolder.save();
      return res.json({ success: true, folder: targetFolder });
    }

    if (!trimmedName) {
      return res.status(400).json({ error: 'Folder name cannot be empty' });
    }

    // 1. Find the target folder
    const targetFolder = await Folder.findOne({ _id: id, $or: [{ userId: userMatch }, { user: userMatch }] });
    if (!targetFolder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    // 2. If the name hasn't changed, return early
    if (targetFolder.name === trimmedName) {
      return res.json(targetFolder);
    }

    // 3. Check for any OTHER folder in the SAME parent directory with the same name
    const existingDuplicate = await Folder.findOne({
      _id: { $ne: id },
      parentId: targetFolder.parentId || null,
      name: trimmedName,
      $or: [{ userId: userMatch }, { user: userMatch }],
    });

    if (existingDuplicate) {
      return res.status(409).json({
        error: `A folder named "${trimmedName}" already exists in this directory.`,
      });
    }

    // 4. Save updated name
    targetFolder.name = trimmedName;
    await targetFolder.save();

    return res.json(targetFolder);
  } catch (err) {
    console.error('Rename folder error:', err);
    return res.status(500).json({ error: 'Server error while renaming folder' });
  }
};

router.put('/folder/:id', authMiddleware, handleFolderRenameInFiles);
router.patch('/folder/:id', authMiddleware, handleFolderRenameInFiles);

// Mount Universal Batch Move on files router for route path compatibility
router.post('/move-batch', authMiddleware, (req, res, next) => require('./folders').handleBatchMove(req, res, next));
router.put('/move-batch', authMiddleware, (req, res, next) => require('./folders').handleBatchMove(req, res, next));
router.post('/batch-move', authMiddleware, (req, res, next) => require('./folders').handleBatchMove(req, res, next));
router.put('/batch-move', authMiddleware, (req, res, next) => require('./folders').handleBatchMove(req, res, next));

module.exports = router;
module.exports.handleBatchDelete = handleBatchDelete;
module.exports.handleBinRestore = handleBinRestore;
module.exports.handleBatchRestore = handleBinRestore;
module.exports.handleGetBin = handleGetBin;
module.exports.handleBinPermanentDelete = handleBinPermanentDelete;
module.exports.handleStorageStats = handleStorageStats;
module.exports.getStorageStats = getStorageStats;
module.exports.toValidObjectIds = toValidObjectIds;
module.exports.getDescendantFolderIds = getDescendantFolderIds;
