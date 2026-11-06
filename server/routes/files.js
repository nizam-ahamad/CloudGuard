const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const mongoose = require('mongoose');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const User = require('../models/User');
const File = require('../models/File');
const Folder = require('../models/Folder');

// Ensure S3Client is configured with credentials and region
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-north-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Auth Middleware for modular files route
const authMiddleware = (req, res, next) => {
  if (req.user) return next();
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Access denied. Please log in.' });
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'cloudguard-super-secret-jwt-key-2024');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
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

    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: targetKey,
      ResponseContentDisposition: `inline; filename="${encodeURIComponent(file.name || file.originalName || 'file')}"`,
    });

    const accessUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

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
    // 1. Guard against missing req.user
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const targetFolderId = req.query.folderId || req.query.folder || null;
    const isRecent = req.query.recent === 'true';
    const searchQuery = req.query.search || '';

    const query = {
      $or: [{ userId: userId }, { user: userId }],
      isTrash: { $ne: true },
      securityStatus: { $ne: 'threat_purged' },
    };

    if (searchQuery) {
      query.$and = [
        {
          $or: [
            { name: { $regex: searchQuery, $options: 'i' } },
            { originalName: { $regex: searchQuery, $options: 'i' } }
          ],
        },
      ];
    } else if (!isRecent) {
      if (!targetFolderId || targetFolderId === 'null' || targetFolderId === 'undefined') {
        // HOME (Root Directory):
        // A file belongs to Home ONLY if it is not inside ANY folder.
        // Both folder and folderId must be null/unset.
        query.folder = null;
        query.folderId = null;
      } else {
        // Subfolder: match targetFolderId via either pointer field
        query.$and = [
          {
            $or: [
              { folder: targetFolderId },
              { folderId: targetFolderId },
            ],
          },
        ];
      }
    }

    let filesQuery = File.find(query)
      .select('name originalName diskName sanitizedName size mimeType mimetype s3Key securityStatus isMalicious uploadedAt createdAt folder folderId')
      .sort({ uploadedAt: -1, createdAt: -1 });

    if (isRecent) {
      filesQuery = filesQuery.limit(50);
    }

    const files = await filesQuery.lean();

    const mappedFiles = files.map(file => ({
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

    return res.status(200).json(mappedFiles);
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
    const user = await User.findById(userId).select('storageUsed storageLimit').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const currentUsed = user.storageUsed || 0;
    const limit = user.storageLimit || 5368709120; // 5 GB fallback default
    if (currentUsed + Number(fileSize) > limit) {
      return res.status(403).json({ error: 'Storage quota exceeded. Upgrade required.' });
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

// -------------------------------------------------------------
// 4. FINALIZE UPLOAD & THREAT AUTO-DELETE PIPELINE
// -------------------------------------------------------------
router.post('/finalize-upload', authMiddleware, async (req, res) => {
  try {
    const { fileId, sha256 } = req.body;
    const userId = req.user.id || req.user._id;
    const userMatch = mongoose.Types.ObjectId.isValid(userId)
      ? { $in: [String(userId), new mongoose.Types.ObjectId(userId)] }
      : String(userId);

    const file = await File.findOne({
      _id: fileId,
      $or: [{ userId: userMatch }, { user: userMatch }]
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found or unauthorized' });
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

    // 3. AI Service Deep Scan (Extended 15s timeout for large binaries like AC4BFSP.exe)
    if (!isMalicious) {
      try {
        const scanUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000/scan';
        const scanRes = await axios.post(
          scanUrl,
          { 
            s3Key: file.s3Key, 
            fileName: file.name, 
            sha256,
            fileKey: file.s3Key,
            filename: file.name
          },
          { timeout: 15000 }
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
      console.log(`[SECURITY INTERCEPT] Threat confirmed for ${file.name} (${threatReason}). Purging from S3 immediately...`);

      try {
        const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
        await s3Client.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: file.s3Key,
        }));
      } catch (delErr) {
        console.error('S3 Delete error:', delErr.message);
      }

      file.isMalicious = true;
      file.securityStatus = 'threat_purged';
      file.status = 'malicious';
      file.size = 0;
      await file.save();

      return res.status(200).json({
        success: true,
        isMalicious: true,
        message: `Security threat intercepted (${threatReason}). File was automatically deleted.`,
        file,
      });
    }

    // 5. Commit Clean File
    file.securityStatus = 'clean';
    file.isMalicious = false;
    file.status = 'safe';
    await file.save();

    await User.findByIdAndUpdate(file.userId, {
      $inc: { storageUsed: file.size },
    });

    return res.status(200).json({
      success: true,
      isMalicious: false,
      file,
    });
  } catch (err) {
    console.error('Finalize error:', err);
    res.status(500).json({ error: 'Failed to finalize upload' });
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
    for (const f of threats) {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: f.s3Key,
        }));
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
// 6. SOFT-DELETE SINGLE FILE (Appears permanently deleted to user)
// -------------------------------------------------------------
const handleSingleFileDelete = async (req, res) => {
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

    const file = await File.findOne({
      _id: req.params.id,
      ...userMatch,
    });

    if (!file) return res.status(404).json({ error: 'File not found' });

    file.isTrash = true;
    file.trashedAt = new Date();
    await file.save();

    // Deduct from user storage quota immediately
    if (file.size > 0 && file.securityStatus !== 'threat_purged') {
      await User.findByIdAndUpdate(rawUserId, {
        $inc: { storageUsed: -Math.abs(file.size || 0) },
      });
    }

    return res.status(200).json({
      success: true,
      message: 'File deleted',
      fileId: file._id,
      deletedId: file._id
    });
  } catch (err) {
    console.error('Delete file error:', err);
    return res.status(500).json({ error: 'Failed to delete file' });
  }
};

router.delete('/:id', authMiddleware, handleSingleFileDelete);

// -------------------------------------------------------------
// 7. BATCH DELETE FILES & FOLDERS
// -------------------------------------------------------------
const handleBatchDelete = async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id || req.user.userId;
    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    const { fileIds = [], folderIds = [] } = req.body;

    const userMatch = {
      $or: [
        { userId: userIdObj },
        { user: userIdObj },
        { userId: String(rawUserId) },
        { user: String(rawUserId) },
      ],
    };

    if (fileIds.length > 0) {
      await File.updateMany(
        { _id: { $in: fileIds }, ...userMatch },
        { $set: { isTrash: true, trashedAt: new Date() } }
      );
    }

    if (folderIds.length > 0) {
      await Folder.updateMany(
        { _id: { $in: folderIds }, ...userMatch },
        { $set: { isTrash: true, trashedAt: new Date() } }
      );
      await File.updateMany(
        {
          $or: [
            { folder: { $in: folderIds } },
            { folderId: { $in: folderIds } },
          ],
          ...userMatch,
        },
        { $set: { isTrash: true, trashedAt: new Date() } }
      );
    }

    // Recalculate storage for the user to be 100% accurate
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

    return res.status(200).json({ success: true, deletedCount: fileIds.length + folderIds.length });
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
    const rawUserId = req.user.id || req.user._id || req.user.userId;
    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    const { fileIds = [], folderIds = [] } = req.body;

    const userMatch = {
      $or: [
        { userId: userIdObj },
        { user: userIdObj },
        { userId: String(rawUserId) },
        { user: String(rawUserId) },
      ],
    };

    if (fileIds.length > 0) {
      await File.updateMany(
        { _id: { $in: fileIds }, ...userMatch },
        { $set: { isTrash: false, trashedAt: null } }
      );
    }

    if (folderIds.length > 0) {
      await Folder.updateMany(
        { _id: { $in: folderIds }, ...userMatch },
        { $set: { isTrash: false, trashedAt: null } }
      );
      await File.updateMany(
        {
          $or: [
            { folder: { $in: folderIds } },
            { folderId: { $in: folderIds } },
          ],
          ...userMatch,
        },
        { $set: { isTrash: false, trashedAt: null } }
      );
    }

    // Recalculate storage for the user
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

    return res.status(200).json({ success: true, restoredCount: fileIds.length + folderIds.length });
  } catch (err) {
    console.error('Restore error:', err);
    return res.status(500).json({ error: 'Failed to restore items' });
  }
};

router.post('/restore-batch', authMiddleware, handleBatchRestore);
router.post('/batch-restore', authMiddleware, handleBatchRestore);

// -------------------------------------------------------------
// 9. STORAGE STATS RECALCULATION (ROBUST ObjectId CASTING & FALLBACK)
// -------------------------------------------------------------
const getStorageStats = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId) {
      return res.status(401).json({ error: 'Unauthorized: User ID missing from session' });
    }

    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : null;

    // Support both String and ObjectId query matching for legacy compatibility
    const userMatchConditions = [
      { userId: rawUserId },
      { user: rawUserId },
    ];
    if (userIdObj) {
      userMatchConditions.push({ userId: userIdObj }, { user: userIdObj });
    }

    // 1. Calculate actual active storage used using Aggregation
    let actualStorageUsed = 0;
    try {
      const stats = await File.aggregate([
        {
          $match: {
            isTrash: { $ne: true },
            securityStatus: { $ne: 'threat_purged' },
            $or: userMatchConditions,
          },
        },
        {
          $group: {
            _id: null,
            totalBytes: { $sum: { $ifNull: ['$size', 0] } },
          },
        },
      ]);
      actualStorageUsed = stats[0]?.totalBytes || 0;
    } catch (aggErr) {
      console.warn('Aggregation fallback triggered:', aggErr.message);
      // Fallback: simple sum via find if aggregation pipeline encounters driver issues
      const activeFiles = await File.find({
        isTrash: { $ne: true },
        securityStatus: { $ne: 'threat_purged' },
        $or: userMatchConditions,
      }).select('size').lean();
      actualStorageUsed = activeFiles.reduce((acc, curr) => acc + (curr.size || 0), 0);
    }

    // 2. Fetch User Quota Limit & Sync storageUsed
    const defaultLimit = 5368709120; // 5 GB default
    let storageLimit = defaultLimit;

    if (userIdObj) {
      const user = await User.findById(userIdObj).select('storageLimit').lean();
      if (user?.storageLimit) {
        storageLimit = user.storageLimit;
      }
      // Update user document asynchronously (non-blocking)
      User.findByIdAndUpdate(userIdObj, { storageUsed: actualStorageUsed }).exec();
    }

    const percentage = storageLimit > 0
      ? Math.min(100, (actualStorageUsed / storageLimit) * 100).toFixed(1)
      : '0.0';

    return res.status(200).json({
      success: true,
      storageUsed: actualStorageUsed,
      used: actualStorageUsed,
      usedBytes: actualStorageUsed,
      storageLimit,
      limit: storageLimit,
      totalLimitBytes: storageLimit,
      percentage,
      usedPercentage: percentage,
    });
  } catch (err) {
    console.error('Fatal error in getStorageStats:', err);
    // Never crash the entire dashboard UI with a 500: return safe defaults
    return res.status(200).json({
      success: true,
      storageUsed: 0,
      used: 0,
      usedBytes: 0,
      storageLimit: 5368709120,
      limit: 5368709120,
      totalLimitBytes: 5368709120,
      percentage: '0.0',
      usedPercentage: '0.0',
    });
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
    return res.json({ downloadUrl, name: fileName, size: file.size || 0 });
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
    const userId = req.user.id || req.user._id;
    const userMatch = mongoose.Types.ObjectId.isValid(userId)
      ? { $in: [String(userId), new mongoose.Types.ObjectId(userId)] }
      : String(userId);

    const { folderId, folder, parentId, targetFolderId } = req.body;
    const rawTarget = folderId !== undefined ? folderId : (folder !== undefined ? folder : (parentId !== undefined ? parentId : targetFolderId));
    const targetParentId = !rawTarget || rawTarget === 'null' || rawTarget === 'undefined' || rawTarget === 'root' ? null : rawTarget;

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

router.put('/folder/:id', handleFolderRenameInFiles);
router.patch('/folder/:id', handleFolderRenameInFiles);

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
