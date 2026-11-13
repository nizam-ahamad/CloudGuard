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
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const User = require('../models/User');
const File = require('../models/File');
const Folder = require('../models/Folder');
const { buildTenantQuery } = require('../utils/tenantQuery');
const { permanentlyDeleteS3Keys } = require('../utils/s3Delete');
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

      const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || 'cloudguard-vault-mumbai-2026';
      const keysToPurge = [file.s3Key, file.thumbnailKey].filter(Boolean);
      if (keysToPurge.length > 0) {
        await permanentlyDeleteS3Keys(s3Client, bucket, keysToPurge).catch((e) => console.warn(`[S3 Purge Warning] ${e.message}`));
      }

      await File.deleteOne({ _id: file._id });
      console.log(`[Auto-Purge] Un-restored file "${file.name}" permanently deleted from S3 & DB.`);
    } catch (err) {
      console.error('[Deferred File Purge Error]:', err);
    }
  }, delayMs);

  activePurgeTimers.set(fileIdStr, timer);
};

// 2. Batch Purge Scheduler
const scheduleBatchPurge = (fileIds = [], folderIds = [], rawUserId, delayMs = 12000) => {
  const batchKey = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const purgeScheduledAt = Date.now();

  // Register individual keys so restore-batch can cancel them
  fileIds.forEach((id) => cancelPurgeTimer(id));
  folderIds.forEach((id) => cancelPurgeTimer(id));

  const timer = setTimeout(async () => {
    activePurgeTimers.delete(batchKey);
    fileIds.forEach((id) => activePurgeTimers.delete(String(id)));
    folderIds.forEach((id) => activePurgeTimers.delete(String(id)));

    try {
      const userMatch = { $or: [{ userId: rawUserId }, { user: rawUserId }] };

      // Purge un-restored files
      if (fileIds.length > 0) {
        const trashedFiles = await File.find({
          _id: { $in: fileIds },
          isTrash: true,
          ...userMatch,
        });

        // Only purge files whose trashedAt is not newer than this timer
        const validToPurge = trashedFiles.filter(
          (f) => !f.trashedAt || new Date(f.trashedAt).getTime() <= purgeScheduledAt
        );

        const keys = [];
        validToPurge.forEach((f) => {
          if (f.s3Key) keys.push(f.s3Key);
          if (f.thumbnailKey) keys.push(f.thumbnailKey);
        });

        if (keys.length > 0) {
          const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || 'cloudguard-vault-mumbai-2026';
          await permanentlyDeleteS3Keys(s3Client, bucket, keys).catch((e) => console.warn(`[S3 Batch Purge Warning] ${e.message}`));
        }

        if (validToPurge.length > 0) {
          await File.deleteMany({
            _id: { $in: validToPurge.map((f) => f._id) },
            ...userMatch,
          });
        }
      }

      // Purge un-restored folders & children
      if (folderIds.length > 0) {
        const trashedFolders = await Folder.find({
          _id: { $in: folderIds },
          isTrash: true,
          ...userMatch,
        });

        const validFolders = trashedFolders.filter(
          (f) => !f.trashedAt || new Date(f.trashedAt).getTime() <= purgeScheduledAt
        );

        if (validFolders.length > 0) {
          const allFolderIds = validFolders.map((f) => f._id);
          if (typeof getDescendantFolderIds === 'function') {
            for (const f of validFolders) {
              const desc = await getDescendantFolderIds(f._id, userMatch);
              allFolderIds.push(...desc);
            }
          }

          const childFiles = await File.find({
            $or: [{ folder: { $in: allFolderIds } }, { folderId: { $in: allFolderIds } }],
            isTrash: true,
            ...userMatch,
          });

          const childKeys = [];
          childFiles.forEach((cf) => {
            if (cf.s3Key) childKeys.push(cf.s3Key);
            if (cf.thumbnailKey) childKeys.push(cf.thumbnailKey);
          });

          if (childKeys.length > 0) {
            const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || 'cloudguard-vault-mumbai-2026';
            await permanentlyDeleteS3Keys(s3Client, bucket, childKeys).catch((e) => console.warn(`[S3 Folder Child Purge Warning] ${e.message}`));
          }

          await File.deleteMany({
            $or: [{ folder: { $in: allFolderIds } }, { folderId: { $in: allFolderIds } }],
            ...userMatch,
          });

          await Folder.deleteMany({ _id: { $in: allFolderIds }, ...userMatch });
        }
      }
    } catch (err) {
      console.error('[Deferred Batch Purge Error]:', err);
    }
  }, delayMs);

  activePurgeTimers.set(batchKey, timer);
  fileIds.forEach((id) => activePurgeTimers.set(String(id), timer));
  folderIds.forEach((id) => activePurgeTimers.set(String(id), timer));
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
    const searchQuery = (req.query.search || '').trim();
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
    const userId = req.user.id || req.user._id;

    if (!fileName || fileSize === undefined || fileSize === null) {
      return res.status(400).json({ error: 'Filename and file size are required' });
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

    // Storage Quota Enforcement
    const uploadSize = Number(fileSize);
    const storageLimit = user.storageLimit || 5368709120;
    if ((user.storageUsed || 0) + uploadSize > storageLimit) {
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
      folder: activeFolder,
      folderId: activeFolder,
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

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

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

    if (!fileName || !fileSize) {
      return res.status(400).json({ error: 'Filename and file size are required' });
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

    const currentUsed = user.storageUsed || 0;
    const limit = user.storageLimit || 5368709120;
    if (currentUsed + Number(fileSize) > limit) {
      return res.status(403).json({ error: 'Storage quota exceeded. Upgrade required.' });
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
      folder: activeFolder,
      folderId: activeFolder,
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

    const { UploadId } = await s3Client.send(createCmd);

    // 4. Adaptive part sizing (>= 10 MB: strictly above Backblaze B2's 5 MB minimum, well under 10k parts)
    const numericFileSize = Number(fileSize);
    let partSize = 10 * 1024 * 1024; // 10 MB for files < 250 MB
    if (numericFileSize >= 1024 * 1024 * 1024) {
      partSize = 50 * 1024 * 1024; // 50 MB for files >= 1 GB
    } else if (numericFileSize >= 250 * 1024 * 1024) {
      partSize = 25 * 1024 * 1024; // 25 MB for files 250 MB to < 1 GB
    }
    const totalParts = Math.ceil(numericFileSize / partSize);

    const partUrls = await Promise.all(
      Array.from({ length: totalParts }, async (_, idx) => {
        const partNumber = idx + 1;
        const partCmd = new UploadPartCommand({
          Bucket: bucket,
          Key: s3Key,
          UploadId,
          PartNumber: partNumber,
        });
        const signedUrl = await getSignedUrl(s3Client, partCmd, { expiresIn: 14400 });
        return { partNumber, signedUrl };
      })
    );

    return res.status(200).json({
      fileId: newFile._id,
      s3Key,
      uploadId: UploadId,
      partSize,
      totalParts,
      partUrls,
    });
  } catch (err) {
    console.error('[Multipart Init Error]:', err);
    return res.status(500).json({ error: 'Failed to initialize multipart upload' });
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

    const file = await File.findOne({ _id: fileId, userId });
    if (!file) return res.status(404).json({ error: 'File record not found' });

    // S3 and Backblaze B2 strictly require parts sorted ascending by PartNumber
    const sortedParts = [...parts]
      .sort((a, b) => Number(a.PartNumber) - Number(b.PartNumber))
      .map((p) => ({
        PartNumber: Number(p.PartNumber),
        ETag: p.ETag,
      }));

    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
    await s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: s3Key,
        UploadId: uploadId,
        MultipartUpload: { Parts: sortedParts },
      })
    );

    return res.status(200).json({ success: true, fileId, s3Key });
  } catch (err) {
    console.error('[Multipart Complete Error]:', err);
    return res.status(500).json({ error: 'Failed to assemble multipart upload' });
  }
});

// POST /api/files/multipart/abort — Clean up incomplete chunks & pending DB record on failure/cancel
router.post('/multipart/abort', authMiddleware, async (req, res) => {
  try {
    const { fileId, s3Key, uploadId } = req.body;
    const userId = req.user.id || req.user._id;

    if (s3Key && uploadId) {
      const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
      await s3Client
        .send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: s3Key,
            UploadId: uploadId,
          })
        )
        .catch((e) => console.warn('[Multipart Abort S3 Notice]:', e.message));
    }

    if (fileId) {
      await File.deleteOne({ _id: fileId, userId, securityStatus: 'pending_scan' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[Multipart Abort Error]:', err);
    return res.status(500).json({ error: 'Failed to abort multipart upload' });
  }
});

// -------------------------------------------------------------
// 4. FINALIZE UPLOAD & THREAT AUTO-DELETE PIPELINE
// -------------------------------------------------------------
router.post('/finalize-upload', authMiddleware, async (req, res) => {
  let file;
  try {
    const { fileId, sha256, thumbnail } = req.body;
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;

    file = await File.findOne(buildTenantQuery(rawUserId, { _id: fileId }));
    if (!file) return res.status(404).json({ error: 'File record not found' });

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
      console.error('[S3 HeadObject Error]:', headErr.message);
      return res.status(400).json({ success: false, error: 'Uploaded object not found in storage.' });
    }

    // Enforce storage quota against actual S3 bytes
    const user = await User.findById(rawUserId);
    if (user && user.subscription?.status === 'past_due') {
      try {
        await permanentlyDeleteS3Keys(s3Client, bucket, file.s3Key);
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
        await permanentlyDeleteS3Keys(s3Client, bucket, file.s3Key);
      } catch (delErr) {}
      await File.deleteOne({ _id: file._id });
      return res.status(403).json({
        error: 'Your subscription has expired. Select a plan on the Pricing page to resume uploading.',
        code: 'SUBSCRIPTION_EXPIRED'
      });
    }
    if (user && user.storageUsed + actualBytes > user.storageLimit) {
      try {
        await permanentlyDeleteS3Keys(s3Client, bucket, file.s3Key);
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
      const previousSecurityStatus = file.securityStatus;
      file.securityStatus = 'clean';
      file.isMalicious = false;
      file.status = 'safe';
      await file.save();

      if (previousSecurityStatus !== 'clean') {
        const u = await User.findByIdAndUpdate(
          rawUserId,
          { $inc: { storageUsed: file.size } },
          { new: true }
        );
        if (u && u.subscription) {
          u.subscription.peakStorageBytes = Math.max(u.subscription?.peakStorageBytes || 0, u.storageUsed);
          await u.save();
        }
      }

      return res.status(200).json({
        success: true,
        isMalicious: false,
        file,
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
            await permanentlyDeleteS3Keys(s3Client, bucket, [file.s3Key, file.thumbnailKey].filter(Boolean));
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
        const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
        await permanentlyDeleteS3Keys(s3Client, bucket, [file.s3Key, file.thumbnailKey].filter(Boolean));
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

    // 5. Commit Clean File
    const previousSecurityStatus = file.securityStatus;
    file.securityStatus = 'clean';
    file.isMalicious = false;
    file.status = 'safe';
    await file.save();

    // Only increment quota if the file was not already clean
    if (previousSecurityStatus !== 'clean') {
      const u = await User.findByIdAndUpdate(
        rawUserId || file.userId,
        { $inc: { storageUsed: file.size } },
        { new: true }
      );
      if (u && u.subscription) {
        u.subscription.peakStorageBytes = Math.max(u.subscription?.peakStorageBytes || 0, u.storageUsed);
        await u.save();
      }
    }

    return res.status(200).json({
      success: true,
      isMalicious: false,
      file,
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
// 6. SOFT-DELETE SINGLE FILE (12-SECOND GRACE PERIOD FOR UNDO)
// -------------------------------------------------------------
const handleSingleFileDelete = async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id || req.user.userId;
    const file = await File.findOne({
      _id: req.params.id,
      $or: [{ userId: rawUserId }, { user: rawUserId }],
    });

    if (!file) return res.status(404).json({ error: 'File not found' });

    file.isTrash = true;
    file.trashedAt = new Date();
    await file.save();

    // Deduct quota immediately
    await User.findByIdAndUpdate(rawUserId, {
      $inc: { storageUsed: -Math.abs(file.size || 0) },
    });

    // Queue S3 & MongoDB purge after 12s grace window
    scheduleFilePurge(file._id, rawUserId);

    return res.status(200).json({ success: true, message: 'File deleted', fileId: file._id, deletedId: file._id });
  } catch (err) {
    console.error('Delete file error:', err);
    return res.status(500).json({ error: 'Failed to delete file' });
  }
};

router.delete('/:id', authMiddleware, handleSingleFileDelete);

// -------------------------------------------------------------
// 7. BATCH DELETE FILES & FOLDERS (12-SECOND GRACE PERIOD FOR UNDO)
// -------------------------------------------------------------
const handleBatchDelete = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    const { fileIds = [], folderIds = [] } = req.body;
    const userMatch = { $or: [{ userId: rawUserId }, { user: rawUserId }] };

    const validFileIds = (Array.isArray(fileIds) ? fileIds : [])
      .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)))
      .map((id) => new mongoose.Types.ObjectId(String(id)));

    const validFolderIds = (Array.isArray(folderIds) ? folderIds : [])
      .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)))
      .map((id) => new mongoose.Types.ObjectId(String(id)));

    let freedBytes = 0;

    if (validFileIds.length > 0) {
      const files = await File.find({ _id: { $in: validFileIds }, ...userMatch });
      for (const f of files) freedBytes += (f.size || 0);

      await File.updateMany(
        { _id: { $in: validFileIds }, ...userMatch },
        { $set: { isTrash: true, trashedAt: new Date() } }
      );
    }

    if (validFolderIds.length > 0) {
      const allFolderIds = [...validFolderIds];
      if (typeof getDescendantFolderIds === 'function') {
        for (const fId of validFolderIds) {
          const descendants = await getDescendantFolderIds(fId, userMatch);
          allFolderIds.push(...descendants);
        }
      }

      const childFiles = await File.find({
        $or: [{ folder: { $in: allFolderIds } }, { folderId: { $in: allFolderIds } }],
        ...userMatch,
      });
      for (const cf of childFiles) freedBytes += (cf.size || 0);

      await Folder.updateMany(
        { _id: { $in: allFolderIds }, ...userMatch },
        { $set: { isTrash: true, trashedAt: new Date() } }
      );

      await File.updateMany(
        {
          $or: [{ folder: { $in: allFolderIds } }, { folderId: { $in: allFolderIds } }],
          ...userMatch,
        },
        { $set: { isTrash: true, trashedAt: new Date() } }
      );
    }

    if (freedBytes > 0) {
      await User.findByIdAndUpdate(rawUserId, {
        $inc: { storageUsed: -Math.abs(freedBytes) },
      });
    }

    // Schedule permanent deletion
    scheduleBatchPurge(validFileIds, validFolderIds, rawUserId);

    return res.status(200).json({
      success: true,
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
// 8. RESTORE ENDPOINT FOR "UNDO" ACTION
// -------------------------------------------------------------
const handleBatchRestore = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    const userMatch = {
      $or: [
        { userId: userIdObj },
        { userId: String(rawUserId) },
        { user: userIdObj },
        { user: String(rawUserId) },
      ],
    };

    const { fileIds = [], folderIds = [] } = req.body;

    // CRITICAL FIX: Cancel any pending purge timers immediately
    (Array.isArray(fileIds) ? fileIds : []).forEach((id) => cancelPurgeTimer(id));
    (Array.isArray(folderIds) ? folderIds : []).forEach((id) => cancelPurgeTimer(id));

    const validFileIds = (Array.isArray(fileIds) ? fileIds : [])
      .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)))
      .map((id) => new mongoose.Types.ObjectId(String(id)));

    const validFolderIds = (Array.isArray(folderIds) ? folderIds : [])
      .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)))
      .map((id) => new mongoose.Types.ObjectId(String(id)));

    let restoredBytes = 0;

    // 1. Restore specific files
    if (validFileIds.length > 0) {
      const filesToRestore = await File.find({ _id: { $in: validFileIds }, ...userMatch });
      for (const f of filesToRestore) {
        restoredBytes += (f.size || 0);
      }

      // Check if parent folders still exist; if not, reattach to root
      const parentFolderIds = filesToRestore.map((f) => f.folderId || f.folder).filter(Boolean);
      const existingFolders = await Folder.find({ _id: { $in: parentFolderIds }, isTrash: { $ne: true } }).select('_id');
      const existingFolderIdSet = new Set(existingFolders.map((f) => String(f._id)));

      for (const f of filesToRestore) {
        const pId = String(f.folderId || f.folder || '');
        const shouldResetToRoot = pId && !existingFolderIdSet.has(pId);

        await File.updateOne(
          { _id: f._id },
          {
            $set: {
              isTrash: false,
              trashedAt: null,
              ...(shouldResetToRoot ? { folder: null, folderId: null } : {}),
            },
          }
        );
      }
    }

    // 2. Restore folders and nested contents
    if (validFolderIds.length > 0) {
      await Folder.updateMany(
        { _id: { $in: validFolderIds }, ...userMatch },
        { $set: { isTrash: false, trashedAt: null } }
      );

      const childFiles = await File.find({
        $or: [{ folder: { $in: validFolderIds } }, { folderId: { $in: validFolderIds } }],
        ...userMatch,
      });

      for (const cf of childFiles) {
        restoredBytes += (cf.size || 0);
      }

      await File.updateMany(
        {
          $or: [{ folder: { $in: validFolderIds } }, { folderId: { $in: validFolderIds } }],
          ...userMatch,
        },
        { $set: { isTrash: false, trashedAt: null } }
      );
    }

    // 3. Increment quota back
    if (restoredBytes > 0) {
      const u = await User.findByIdAndUpdate(rawUserId, {
        $inc: { storageUsed: Math.abs(restoredBytes) },
      }, { new: true });
      if (u && u.subscription) {
        u.subscription.peakStorageBytes = Math.max(u.subscription?.peakStorageBytes || 0, u.storageUsed);
        await u.save();
      }
    }

    return res.status(200).json({
      success: true,
      restoredCount: validFileIds.length + validFolderIds.length,
      restoredBytes,
    });
  } catch (err) {
    console.error('Restore error:', err);
    return res.status(500).json({ error: 'Failed to restore items' });
  }
};

router.post('/restore-batch', authMiddleware, handleBatchRestore);
router.post('/batch-restore', authMiddleware, handleBatchRestore);

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

    // Calculate real active storage
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

    // Synchronize user record in background
    const userDoc = await User.findById(rawUserId);
    if (userDoc) {
      userDoc.storageUsed = actualStorageUsed;
      if (userDoc.subscription) {
        userDoc.subscription.peakStorageBytes = Math.max(userDoc.subscription?.peakStorageBytes || 0, userDoc.storageUsed);
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
 * GET /api/files/:id/download-url
 * Generates fresh on-demand S3 presigned download URL with ResponseContentDisposition attachment
 */
router.get('/:id/download-url', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const file = await File.findOne({
      _id: req.params.id,
      $or: [
        { userId: userId },
        { userId: String(userId) },
        { user: userId }
      ]
    });
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
    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: targetKey,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return res.json({ downloadUrl: applyCdnToUrl(downloadUrl), name: fileName, size: file.size || 0 });
  } catch (err) {
    console.error('Failed to generate presigned download URL:', err);
    return res.status(500).json({ error: 'Failed to generate download link' });
  }
});

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
 * PUT /folder/:id & PATCH /folder/:id - Rename/Move folder with duplicate name guard
 */
const handleFolderRenameInFiles = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, newName, parentId, targetFolderId } = req.body;
    const trimmedName = (name || newName || '').trim();
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
module.exports.handleBatchRestore = handleBatchRestore;
module.exports.handleStorageStats = handleStorageStats;
module.exports.getStorageStats = getStorageStats;
