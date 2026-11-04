const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const FileModel = require('../models/File');

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
    const mediaFiles = await FileModel.find({
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
        { securityStatus: { $in: ['Safe', 'unscanned_too_large'] } },
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

    const bucket = process.env.AWS_S3_BUCKET_NAME || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET;
    const s3Client = req.s3 || global.s3;

    const filesWithUrls = await Promise.all(mediaFiles.map(async (file) => {
      let targetKey = file.s3Key;
      if (!targetKey && file.location) {
        try {
          const urlObj = new URL(file.location);
          targetKey = decodeURIComponent(urlObj.pathname.substring(1).replace(/\+/g, '%20'));
        } catch (e) {}
      }

      let presignedUrl = '';
      if (targetKey && bucket && s3Client) {
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
    const file = await FileModel.findOne({
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
    const bucket = process.env.AWS_S3_BUCKET_NAME || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET;

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: targetKey,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });

    const s3Client = req.s3 || global.s3;
    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return res.json({ downloadUrl, name: fileName, size: file.size || 0 });
  } catch (err) {
    console.error('Failed to generate presigned download URL:', err);
    return res.status(500).json({ error: 'Failed to generate download link' });
  }
});

module.exports = router;
