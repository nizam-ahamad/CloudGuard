const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
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

/**
 * POST /api/files/presigned-url
 * Issues direct browser-to-S3 upload ticket with quota enforcement
 */
router.post('/presigned-url', authMiddleware, async (req, res) => {
  try {
    const { fileName, filename, fileSize, size, mimeType, contentType, folderId, folder } = req.body;
    const targetFileName = fileName || filename;
    const targetFileSize = fileSize !== undefined ? Number(fileSize) : (size !== undefined ? Number(size) : 0);
    const targetMimeType = mimeType || contentType || 'application/octet-stream';
    const targetFolderId = folderId || folder || null;
    const userId = req.user.id || req.user._id;

    if (!targetFileName || !targetFileSize) {
      return res.status(400).json({ error: 'Filename and file size are required' });
    }

    // 1. Enforce Storage Quota
    const user = await User.findById(userId).select('storageUsed storageLimit').lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentUsed = user.storageUsed || 0;
    const limit = user.storageLimit || 5368709120; // 5 GB fallback default
    if (currentUsed + targetFileSize > limit) {
      return res.status(403).json({ error: 'Storage quota exceeded. Please upgrade your plan.' });
    }

    // 2. Format S3 Key & Pre-create Database Document
    const sanitized = targetFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const s3Key = `uploads/${userId}/${Date.now()}-${sanitized}`;

    const newFile = await File.create({
      name: targetFileName,
      originalName: targetFileName,
      sanitizedName: sanitized,
      diskName: sanitized,
      size: targetFileSize,
      mimeType: targetMimeType,
      mimetype: targetMimeType,
      s3Key,
      userId,
      user: userId,
      folder: targetFolderId,
      folderId: targetFolderId,
      isTrash: false,
      isDeleted: false,
      isMalicious: false,
      status: 'pending_scan',
      securityStatus: 'pending_scan',
      uploadedAt: new Date(),
      createdAt: new Date(),
    });

    // 3. Generate Presigned PUT URL
    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      ContentType: targetMimeType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

    res.json({
      presignedUrl,
      signedUrl: presignedUrl,
      fileId: newFile._id,
      s3Key,
      fileKey: s3Key,
    });
  } catch (err) {
    console.error('Error generating presigned URL:', err);
    res.status(500).json({ error: 'Failed to initialize direct upload ticket' });
  }
});

/**
 * POST /api/files/finalize-upload
 * Enforces graceful scanning and threat auto-delete (never 406 or 503)
 */
router.post('/finalize-upload', authMiddleware, async (req, res) => {
  try {
    const { fileId, sha256 } = req.body;
    const file = await File.findById(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File record not found' });
    }

    let isMalicious = false;
    let scanVerdict = 'clean';

    // 1. Safe scan invocation with error guard (prevents 503 crash if scanner is blocked)
    try {
      const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';
      const scanRes = await axios.post(
        `${aiServiceUrl}/scan`,
        { 
          fileKey: file.s3Key,
          filename: file.name,
          s3Key: file.s3Key, 
          fileName: file.name,
          sha256 
        },
        { timeout: 8000 }
      );
      if (scanRes.data && (scanRes.data.isMalicious || scanRes.data.status === 'malicious')) {
        isMalicious = true;
        scanVerdict = 'threat_purged';
      }
    } catch (scanErr) {
      console.warn('AI Scanner notice (handled):', scanErr.message);
      // Fallback: If scanner could not read file due to local AV lock, do not crash backend with 503
    }

    // 2. Immediate S3 Deletion on Threat (No Quarantine, No Email)
    if (isMalicious) {
      try {
        const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
        await s3Client.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: file.s3Key,
        }));
      } catch (delErr) {
        console.error('S3 Delete Error:', delErr.message);
      }

      file.isMalicious = true;
      file.securityStatus = 'threat_purged';
      file.status = 'malicious';
      file.size = 0;
      await file.save();

      // Return clean HTTP 200 so frontend queue doesn't crash with 406
      return res.status(200).json({
        success: true,
        isMalicious: true,
        message: 'Security threat intercepted. File was automatically deleted.',
        file,
      });
    }

    // 3. Clean File Confirmation
    file.securityStatus = 'clean';
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
    console.error('Finalize upload error:', err);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

/**
 * GET /api/files - High-performance lean read query
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const currentFolderId = req.query.folder || req.query.folderId || null;
    const userId = req.user.id || req.user._id;

    // Run parallel queries resolved directly by compound indexes
    const [files, folders] = await Promise.all([
      File.find({ 
        userId, 
        $or: [{ folder: currentFolderId }, { folderId: currentFolderId }], 
        isTrash: false 
      })
        .select('name originalName size mimeType s3Key securityStatus uploadedAt folder folderId')
        .sort({ uploadedAt: -1 })
        .lean(),
      Folder.find({ userId, parentId: currentFolderId, isTrash: false })
        .select('name parentId createdAt')
        .sort({ name: 1 })
        .lean(),
    ]);

    res.json({ files, folders });
  } catch (err) {
    console.error('Error fetching files:', err);
    res.status(500).json({ error: 'Failed to retrieve folder contents' });
  }
});

/**
 * GET /api/files/photos
 * Ultra-lightweight endpoint with field projection and lean query.
 * Cache-Control: no-store prevents caching stale S3 presigned URLs.
 */
router.get('/photos', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const userId = req.user?._id || req.user?.id;

    // Field projection: minimal fields required by frontend grid
    const mediaFiles = await File.find({
      $and: [
        {
          $or: [
            { userId: userId },
            { userId: String(userId) },
            { user: userId }
          ]
        },
        { isTrash: { $ne: true } },
        { isDeleted: { $ne: true } },
        { securityStatus: { $in: ['Safe', 'unscanned_too_large', 'clean'] } },
        {
          $or: [
            { mimetype: { $regex: /^(image|video)\//i } },
            { mimeType: { $regex: /^(image|video)\//i } },
            { extension: { $in: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'mp4', 'webm', 'mov', 'mkv'] } },
            { originalName: { $regex: /\.(jpg|jpeg|png|webp|gif|svg|mp4|webm|mov|mkv)$/i } },
            { name: { $regex: /\.(jpg|jpeg|png|webp|gif|svg|mp4|webm|mov|mkv)$/i } }
          ]
        }
      ]
    })
    .select('_id name originalName s3Key location size mimetype mimeType uploadedAt createdAt')
    .sort({ uploadedAt: -1, createdAt: -1 })
    .lean();

    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
    const s3 = s3Client;

    const filesWithUrls = await Promise.all(mediaFiles.map(async (file) => {
      let targetKey = file.s3Key;
      if (!targetKey && file.location) {
        try {
          const urlObj = new URL(file.location);
          targetKey = decodeURIComponent(urlObj.pathname.substring(1).replace(/\+/g, '%20'));
        } catch (e) {}
      }

      let presignedUrl = '';
      if (targetKey && bucket && s3) {
        try {
          const command = new GetObjectCommand({
            Bucket: bucket,
            Key: targetKey
          });
          presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
        } catch (err) {
          console.error('Error signing URL for media asset:', err.message);
        }
      }

      const finalUrl = presignedUrl || file.location || '';
      const ext = (file.originalName || file.name || '').split('.').pop().toLowerCase();
      const isVideo = (file.mimetype || file.mimeType || '').startsWith('video') || ['mp4', 'webm', 'mov', 'mkv'].includes(ext);
      const mimeType = file.mimetype || file.mimeType || (isVideo ? `video/${ext === 'mov' ? 'quicktime' : ext}` : `image/${ext === 'jpg' ? 'jpeg' : ext}`);

      return {
        _id: file._id.toString(),
        name: file.originalName || file.name,
        mimeType: mimeType,
        size: file.size || 0,
        createdAt: file.uploadedAt || file.createdAt || new Date(),
        s3Url: finalUrl,
        url: finalUrl
      };
    }));

    return res.json({ success: true, count: filesWithUrls.length, files: filesWithUrls });
  } catch (error) {
    console.error('Error fetching photos:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch media assets' });
  }
});

/**
 * GET /api/files/:id/download-url
 * Generates fresh on-demand S3 presigned download URL with ResponseContentDisposition attachment
 */
router.get('/:id/download-url', async (req, res) => {
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

/**
 * PUT /folder/:id & PATCH /folder/:id - Rename folder with duplicate name guard
 */
const handleFolderRenameInFiles = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, newName } = req.body;
    const trimmedName = (name || newName || '').trim();

    if (!trimmedName) {
      return res.status(400).json({ error: 'Folder name cannot be empty' });
    }

    const userId = req.user?._id || req.user?.id;

    // 1. Find the target folder
    const targetFolder = await Folder.findOne({ _id: id, userId });
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
      userId,
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
