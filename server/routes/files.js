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
    const userId = req.user.id || req.user._id;
    const file = await File.findOne({ 
      _id: req.params.id, 
      $or: [{ userId: userId }, { userId: String(userId) }, { user: userId }],
      isTrash: false 
    }).lean();

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
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

    res.json({
      success: true,
      accessUrl,
      downloadUrl: accessUrl,
      url: accessUrl,
      file,
    });
  } catch (err) {
    console.error('Error generating access URL:', err);
    res.status(500).json({ error: 'Failed to generate secure access URL' });
  }
});

// -------------------------------------------------------------
// 2. LIST FILES FOR FOLDER
// -------------------------------------------------------------
router.get('/', authMiddleware, async (req, res) => {
  try {
    const targetFolderId = req.query.folderId || req.query.folder || null;
    const userId = req.user.id || req.user._id;
    const isRecent = req.query.recent === 'true';
    const searchQuery = req.query.search || '';

    const query = {
      userId,
      isTrash: false,
      securityStatus: { $ne: 'threat_purged' },
    };

    if (searchQuery) {
      query.$or = [
        { name: { $regex: searchQuery, $options: 'i' } },
        { originalName: { $regex: searchQuery, $options: 'i' } }
      ];
    } else if (!isRecent) {
      if (!targetFolderId || targetFolderId === 'null' || targetFolderId === 'undefined') {
        // HOME (Root Directory):
        // A file belongs to Home ONLY if it is not inside ANY folder.
        // Both folder and folderId must be null/unset.
        query.folder = null;
        query.folderId = null;
      } else {
        // SUBFOLDER:
        // Match files assigned to targetFolderId via either field
        query.$or = [
          { folder: targetFolderId },
          { folderId: targetFolderId },
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
// 6. SECURE SINGLE-FILE DELETE (Strict Tenant Isolation)
// -------------------------------------------------------------
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const userMatch = mongoose.Types.ObjectId.isValid(userId)
      ? { $in: [String(userId), new mongoose.Types.ObjectId(userId)] }
      : String(userId);

    const file = await File.findOne({
      _id: req.params.id,
      $or: [{ userId: userMatch }, { user: userMatch }]
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found or unauthorized' });
    }

    const keyToDelete = file.s3Key || file.key;
    if (keyToDelete) {
      try {
        const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
        await s3Client.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: keyToDelete,
        }));
      } catch (s3Err) {
        console.warn(`S3 delete notice (${keyToDelete}):`, s3Err.message);
      }
    }

    await File.deleteOne({ _id: req.params.id });

    // Decrement user storage
    if (file.size > 0 && file.securityStatus !== 'threat_purged') {
      await User.findByIdAndUpdate(userId, {
        $inc: { storageUsed: -file.size }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'File deleted successfully',
      deletedId: req.params.id
    });
  } catch (err) {
    console.error('Delete error:', err);
    return res.status(500).json({ error: 'Failed to delete file' });
  }
});

/**
 * GET /api/files/photos
 * Ultra-lightweight endpoint with field projection and lean query.
 * Cache-Control: no-store prevents caching stale S3 presigned URLs.
 */
router.get('/photos', authMiddleware, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const userId = req.user?.id || req.user?._id;

    // Hard tenant isolation guard: Never allow an undefined query to run
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: User identifier missing.' });
    }

    const userMatch = mongoose.Types.ObjectId.isValid(userId)
      ? { $in: [String(userId), new mongoose.Types.ObjectId(userId)] }
      : String(userId);

    // Query images & media strictly owned by the authenticated user
    const mediaFiles = await File.find({
      $and: [
        {
          $or: [
            { userId: userMatch },
            { user: userMatch }
          ]
        },
        { isTrash: false },
        { isDeleted: { $ne: true } },
        { securityStatus: { $ne: 'threat_purged' } },
        {
          $or: [
            { mimeType: { $regex: '^(image|video)/', $options: 'i' } },
            { mimetype: { $regex: '^(image|video)/', $options: 'i' } },
            { type: 'image' },
            { type: 'video' },
            { originalName: { $regex: /\.(jpg|jpeg|png|webp|gif|svg|mp4|webm|mov|mkv)$/i } },
            { name: { $regex: /\.(jpg|jpeg|png|webp|gif|svg|mp4|webm|mov|mkv)$/i } }
          ]
        }
      ]
    })
      .select('name originalName size mimeType mimetype s3Key location securityStatus uploadedAt createdAt folder')
      .sort({ uploadedAt: -1, createdAt: -1 })
      .lean();

    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;

    const filesWithUrls = await Promise.all(mediaFiles.map(async (file) => {
      let targetKey = file.s3Key;
      if (!targetKey && file.location) {
        try {
          const urlObj = new URL(file.location);
          targetKey = decodeURIComponent(urlObj.pathname.substring(1).replace(/\+/g, '%20'));
        } catch (e) {}
      }

      let presignedUrl = '';
      if (targetKey && bucket) {
        try {
          const command = new GetObjectCommand({
            Bucket: bucket,
            Key: targetKey
          });
          presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        } catch (err) {
          console.error('Error signing URL for media asset:', err.message);
        }
      }

      const finalUrl = presignedUrl || file.location || '';
      const ext = (file.originalName || file.name || '').split('.').pop().toLowerCase();
      const isVideo = (file.mimetype || file.mimeType || '').startsWith('video') || ['mp4', 'webm', 'mov', 'mkv'].includes(ext);
      const mimeType = file.mimetype || file.mimeType || (isVideo ? `video/${ext === 'mov' ? 'quicktime' : ext}` : `image/${ext === 'jpg' ? 'jpeg' : ext}`);

      return {
        ...file,
        _id: file._id.toString(),
        name: file.originalName || file.name,
        mimeType: mimeType,
        size: file.size || 0,
        createdAt: file.uploadedAt || file.createdAt || new Date(),
        s3Url: finalUrl,
        url: finalUrl
      };
    }));

    return res.status(200).json(filesWithUrls);
  } catch (err) {
    console.error('Error fetching user photos:', err);
    return res.status(500).json({ error: 'Failed to load user photos' });
  }
});

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

module.exports = router;
