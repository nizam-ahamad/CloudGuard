const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();
const mongoose = require('mongoose');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const File = require('../models/File');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-central-003',
  ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;

async function runBackfill() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cloudguard';
    await mongoose.connect(mongoUri);
    console.log('[CloudGuard Auto-Orient] Connected to MongoDB.');

    // Find all active photos to re-orient (removed thumbnailKey: null so all photos are re-processed)
    const files = await File.find({
      isTrash: { $ne: true },
      securityStatus: { $ne: 'threat_purged' },
      $or: [
        { mimeType: { $regex: /^image\//i } },
        { mimetype: { $regex: /^image\//i } },
        { name: { $regex: /\.(jpe?g|png|webp|gif|bmp|tiff|heic)$/i } },
        { originalName: { $regex: /\.(jpe?g|png|webp|gif|bmp|tiff|heic)$/i } },
      ],
    });

    console.log(`[CloudGuard Auto-Orient] Processing ${files.length} photos for EXIF orientation correction.`);

    let successCount = 0;
    for (const file of files) {
      try {
        console.log(`Auto-orienting: ${file.name || file.originalName}...`);

        const targetKey = file.s3Key || file.key;
        if (!targetKey) {
          console.warn(`✗ Skipped ${file.name}: No s3Key found.`);
          continue;
        }

        const getCmd = new GetObjectCommand({
          Bucket: bucket,
          Key: targetKey,
        });
        const s3Res = await s3Client.send(getCmd);
        
        const streamToBuffer = async (stream) => {
          if (Buffer.isBuffer(stream)) return stream;
          return new Promise((resolve, reject) => {
            const chunks = [];
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('error', reject);
            stream.on('end', () => resolve(Buffer.concat(chunks)));
          });
        };
        const originalBuffer = await streamToBuffer(s3Res.Body);

        // .rotate() without arguments auto-orients using EXIF metadata
        const thumbBuffer = await sharp(originalBuffer)
          .rotate()
          .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();

        const thumbKey = file.thumbnailKey || `thumbnails/${file.userId || 'system'}/${Date.now()}-${file._id}.webp`;
        await s3Client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: thumbKey,
          Body: thumbBuffer,
          ContentType: 'image/webp',
        }));

        if (!file.thumbnailKey) {
          file.thumbnailKey = thumbKey;
          await file.save();
        }

        successCount++;
        console.log(`✓ Upright thumbnail updated: ${file.name || file.originalName} (${(thumbBuffer.length / 1024).toFixed(1)} KB)`);
      } catch (err) {
        console.warn(`✗ Skipped ${file.name}:`, err.message);
      }
    }

    console.log(`\n[Completed] Successfully corrected ${successCount}/${files.length} photos.`);
    process.exit(0);
  } catch (err) {
    console.error('[CloudGuard Auto-Orient Error]:', err);
    process.exit(1);
  }
}

runBackfill();
