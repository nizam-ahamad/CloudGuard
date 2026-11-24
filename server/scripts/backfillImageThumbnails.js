/**
 * CloudGuard One-Time Backblaze B2 Image Thumbnail Backfill Script
 *
 * Scans MongoDB for active (non-trashed, non-purged) image File records
 * missing `thumbnailKey`, downloads the original object from Backblaze B2,
 * converts it to an auto-oriented 320px WebP thumbnail (with `heic-convert`
 * fallback for .heic/.heif), uploads to `thumbnails/{userId}/{timestamp}-{fileId}.webp`,
 * and saves `file.thumbnailKey` in MongoDB.
 *
 * Usage:
 *   node server/scripts/backfillImageThumbnails.js
 *   node server/scripts/backfillImageThumbnails.js --dry-run
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const File = require('../models/File');

const IMAGE_EXTENSIONS_REGEX = /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|heif|tiff?|ico)$/i;
const IMAGE_MIME_REGEX = /^image\//i;
const HEIC_REGEX = /\.(heic|heif)$/i;
const HEIC_MIME_REGEX = /^image\/(heic|heif)(-sequence)?$/i;

const isDryRun = process.argv.includes('--dry-run');

async function streamToBuffer(body) {
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function convertToWebpThumbnail(buffer, file) {
  const fileName = file.name || file.originalName || '';
  const mime = file.mimeType || file.mimetype || '';
  const isHeic = HEIC_REGEX.test(fileName) || HEIC_MIME_REGEX.test(mime);

  try {
    return await sharp(buffer)
      .rotate()
      .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
  } catch (sharpErr) {
    if (!isHeic) {
      throw sharpErr;
    }

    // Fallback for .heic / .heif when system libvips lacks HEVC codec support
    const jpegBuffer = await heicConvert({
      buffer,
      format: 'JPEG',
      quality: 0.9,
    });

    return await sharp(Buffer.from(jpegBuffer))
      .rotate()
      .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
  }
}

async function run() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is not defined in server/.env');
  }

  const bucket = process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME;
  if (!bucket) {
    throw new Error('AWS_BUCKET_NAME / AWS_S3_BUCKET is not defined in server/.env');
  }

  const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'eu-central-003',
    ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  await mongoose.connect(mongoUri);
  console.log(`[Backfill] Connected to MongoDB. Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);

  try {
    const query = {
      isTrash: { $ne: true },
      isDeleted: { $ne: true },
      isMalicious: { $ne: true },
      securityStatus: { $ne: 'threat_purged' },
      $and: [
        {
          $or: [
            { thumbnailKey: null },
            { thumbnailKey: '' },
            { thumbnailKey: { $exists: false } },
          ],
        },
        {
          $or: [
            { mimeType: { $regex: IMAGE_MIME_REGEX } },
            { mimetype: { $regex: IMAGE_MIME_REGEX } },
            { name: { $regex: IMAGE_EXTENSIONS_REGEX } },
            { originalName: { $regex: IMAGE_EXTENSIONS_REGEX } },
          ],
        },
      ],
    };

    const candidates = await File.find(query).sort({ createdAt: -1 });
    console.log(`[Backfill] Found ${candidates.length} image file(s) missing thumbnailKey.`);

    let succeeded = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < candidates.length; i++) {
      const file = candidates[i];
      const label = `[${i + 1}/${candidates.length}] ${file._id} (${file.name || file.originalName})`;

      if (!file.s3Key) {
        console.warn(`${label} -> SKIPPED (missing s3Key)`);
        skipped++;
        continue;
      }

      if (isDryRun) {
        console.log(`${label} -> WOULD PROCESS s3Key=${file.s3Key}`);
        succeeded++;
        continue;
      }

      try {
        const obj = await s3Client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: file.s3Key,
          })
        );

        const rawBuffer = await streamToBuffer(obj.Body);
        const webpBuffer = await convertToWebpThumbnail(rawBuffer, file);

        const ownerId = file.userId || file.user || 'system';
        const thumbnailKey = `thumbnails/${ownerId}/${Date.now()}-${file._id}.webp`;

        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: thumbnailKey,
            Body: webpBuffer,
            ContentType: 'image/webp',
          })
        );

        file.thumbnailKey = thumbnailKey;
        await file.save();

        succeeded++;
        console.log(`${label} -> OK (${webpBuffer.length} bytes) -> ${thumbnailKey}`);
      } catch (err) {
        failed++;
        console.error(`${label} -> FAILED: ${err?.message || err}`);
      }
    }

    console.log(
      `[Backfill] Completed. Total=${candidates.length}, Succeeded=${succeeded}, Skipped=${skipped}, Failed=${failed}`
    );
  } finally {
    await mongoose.disconnect();
    console.log('[Backfill] Disconnected from MongoDB.');
  }
}

run().catch((err) => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
