const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const FileModel = require('../models/File');

/**
 * GET /api/files/photos
 * Ultra-lightweight endpoint with field projection, lean query, and 30s cache header
 */
router.get('/photos', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  try {
    const userId = req.user._id;

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

    // Fast ETag check
    const latestTimestamp = mediaFiles.length > 0 
      ? new Date(mediaFiles[0].uploadedAt || mediaFiles[0].createdAt || 0).getTime() 
      : 0;
    const etag = `"${crypto.createHash('md5').update(`${userId}-${mediaFiles.length}-${latestTimestamp}`).digest('hex')}"`;
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    const filesWithUrls = await Promise.all(mediaFiles.map(async (file) => {
      let targetKey = file.s3Key;
      if (!targetKey && file.location) {
        try {
          const urlObj = new URL(file.location);
          targetKey = decodeURIComponent(urlObj.pathname.substring(1).replace(/\+/g, '%20'));
        } catch (e) {}
      }

      let presignedUrl = '';
      if (targetKey && process.env.AWS_BUCKET_NAME) {
        try {
          const command = new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: targetKey
          });
          presignedUrl = await getSignedUrl(req.s3 || global.s3, command, { expiresIn: 3600 });
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

module.exports = router;

