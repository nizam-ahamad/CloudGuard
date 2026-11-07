const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const File = require('../models/File');
const authMiddleware = require('../middleware/auth');
const { buildTenantQuery } = require('../utils/tenantQuery');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-north-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const MEDIA_EXTENSIONS_REGEX = /\.(jpe?g|png|gif|webp|svg|bmp|ico|tiff|heic|mp4|mkv|mov|avi|webm|wmv|flv|m4v|3gp)$/i;
const MEDIA_MIME_REGEX = /^(image|video)\//i;

const handleGetPhotos = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    if (!rawUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const mediaFilter = {
      isTrash: { $ne: true },
      securityStatus: { $in: ['clean', 'unverified'] },
      $or: [
        { mimeType: { $regex: MEDIA_MIME_REGEX } },
        { mimetype: { $regex: MEDIA_MIME_REGEX } },
        { name: { $regex: MEDIA_EXTENSIONS_REGEX } },
        { originalName: { $regex: MEDIA_EXTENSIONS_REGEX } },
      ],
    };

    // Safe scoped query: impossible for tenant ID to be dropped or overwritten
    const query = buildTenantQuery(rawUserId, mediaFilter);

    const mediaFiles = await File.find(query)
      .select('name originalName size mimeType mimetype s3Key key location thumbnail securityStatus uploadedAt createdAt folder')
      .sort({ createdAt: -1, uploadedAt: -1 })
      .lean();

    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;

    // Sign URLs on the server in parallel for the current user's media only
    const photosWithUrls = await Promise.all(
      mediaFiles.map(async (file) => {
        const fileName = file.originalName || file.name || '';
        const isVideo =
          (file.mimeType && file.mimeType.startsWith('video/')) ||
          (file.mimetype && file.mimetype.startsWith('video/')) ||
          /\.(mp4|mkv|mov|avi|webm|wmv|flv|m4v|3gp)$/i.test(fileName);

        let targetKey = file.s3Key || file.key;
        if (!targetKey && file.location) {
          try {
            const urlObj = new URL(file.location);
            targetKey = decodeURIComponent(urlObj.pathname.substring(1).replace(/\+/g, '%20'));
          } catch (e) {}
        }

        let accessUrl = null;
        if (targetKey && bucket) {
          try {
            const command = new GetObjectCommand({
              Bucket: bucket,
              Key: targetKey,
              ResponseContentDisposition: `inline; filename="${encodeURIComponent(file.name || fileName)}"`,
            });
            accessUrl = await getSignedUrl(s3Client, command, { expiresIn: 7200 }); // 2 hours
          } catch (e) {
            console.warn(`Could not sign URL for file ${file._id}:`, e.message);
          }
        }

        return {
          ...file,
          _id: String(file._id),
          name: file.name || file.originalName,
          originalName: file.originalName || file.name,
          mediaType: isVideo ? 'video' : 'image',
          url: accessUrl,
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: photosWithUrls.length,
      photos: photosWithUrls,
      files: photosWithUrls,
    });
  } catch (err) {
    console.error('Error in GET /api/photos:', err);
    return res.status(500).json({ error: 'Failed to retrieve media library' });
  }
};

router.get('/photos', authMiddleware, handleGetPhotos);
router.get('/', authMiddleware, handleGetPhotos);

module.exports = router;
module.exports.handleGetPhotos = handleGetPhotos;
