const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const File = require('../models/File');
const authMiddleware = require('../middleware/auth');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
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

    const mediaFiles = await File.find({
      ...userMatch,
      isTrash: { $ne: true },
      securityStatus: { $in: ['clean', 'unverified'] },
      $or: [
        { mimeType: { $regex: MEDIA_MIME_REGEX } },
        { mimetype: { $regex: MEDIA_MIME_REGEX } },
        { name: { $regex: MEDIA_EXTENSIONS_REGEX } },
        { originalName: { $regex: MEDIA_EXTENSIONS_REGEX } },
      ],
    })
      .select('name originalName size mimeType mimetype s3Key thumbnailKey createdAt uploadedAt folder')
      .sort({ createdAt: -1, uploadedAt: -1 })
      .lean();

    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;

    // Sign 24-hour S3 URLs strictly for thumbnails
    const photosWithThumbnails = await Promise.all(
      mediaFiles.map(async (file) => {
        let thumbnailUrl = null;
        if (file.thumbnailKey && bucket) {
          try {
            thumbnailUrl = await getSignedUrl(
              s3Client,
              new GetObjectCommand({
                Bucket: bucket,
                Key: file.thumbnailKey,
              }),
              { expiresIn: 86400 } // 24 hours
            );
          } catch (e) {
            console.warn('[Thumbnail Presign Warning]:', e.message);
          }
        }

        const isVideo =
          (file.mimeType && file.mimeType.startsWith('video/')) ||
          (file.mimetype && file.mimetype.startsWith('video/')) ||
          /\.(mp4|mkv|mov|avi|webm|wmv|flv|m4v|3gp)$/i.test(file.name || file.originalName || '');

        return {
          ...file,
          _id: String(file._id),
          name: file.name || file.originalName,
          originalName: file.originalName || file.name,
          mediaType: isVideo ? 'video' : 'image',
          thumbnailUrl,
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: photosWithThumbnails.length,
      photos: photosWithThumbnails,
      files: photosWithThumbnails,
    });
  } catch (err) {
    console.error('Error loading vault photos:', err);
    return res.status(500).json({ error: 'Failed to retrieve media library' });
  }
};

router.get('/photos', authMiddleware, handleGetPhotos);
router.get('/', authMiddleware, handleGetPhotos);

module.exports = router;
module.exports.handleGetPhotos = handleGetPhotos;
