/**
 * CloudGuard - Standalone Thumbnail Backfill Script
 *
 * Scans non-trashed image File records missing thumbnailKey, downloads
 * the original from Backblaze B2, converts HEIC/HEIF (with sharp fallback),
 * and resizes with sharp.rotate() using the exact same dimensions (320px)
 * and WebP quality (70%) configured in client/src/utils/thumbnailHelper.js.
 *
 * Usage:
 *   node server/scripts/backfillThumbnails.js
 *   node server/scripts/backfillThumbnails.js --dry-run
 *   node server/scripts/backfillThumbnails.js --limit=50
 *   node server/scripts/backfillThumbnails.js --dry-run --limit=10
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();

const mongoose = require('mongoose');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const File = require('../models/File');

// 1. CLI Arguments Parsing
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

let limit = 0;
for (const arg of args) {
  if (arg.startsWith('--limit=')) {
    limit = parseInt(arg.split('=')[1], 10);
  } else if (arg === '--limit') {
    const next = args[args.indexOf(arg) + 1];
    if (next) limit = parseInt(next, 10);
  }
}

// 2. S3/B2 Client & Storage Config
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-central-003',
  ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME || 'cloudguard-vault-b2';

// 3. Helper to stream S3 GetObject stream to Buffer
async function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) return stream;
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// 4. Main Backfill Execution
async function runBackfill() {
  let scannedCount = 0;
  let generatedCount = 0;
  let failedCount = 0;

  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cloudguard';
    await mongoose.connect(mongoUri);
    console.log('[CloudGuard Backfill] Connected to MongoDB.');

    // Query non-trashed image File documents missing thumbnailKey
    const query = {
      isTrash: { $ne: true },
      isDeleted: { $ne: true },
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
            { mimeType: { $regex: /^image\//i } },
            { mimetype: { $regex: /^image\//i } },
            { name: { $regex: /\.(jpe?g|png|webp|heic|heif)$/i } },
            { originalName: { $regex: /\.(jpe?g|png|webp|heic|heif)$/i } },
          ],
        },
      ],
    };

    let fileQuery = File.find(query).sort({ uploadedAt: -1, createdAt: -1 });
    if (limit > 0) {
      fileQuery = fileQuery.limit(limit);
    }

    const files = await fileQuery;
    scannedCount = files.length;
    console.log(`[CloudGuard Backfill] Found ${scannedCount} image files pending thumbnail generation.`);
    if (isDryRun) {
      console.log('[CloudGuard Backfill] Running in DRY-RUN mode (zero S3 writes, zero DB updates).');
    }

    for (const file of files) {
      try {
        const targetKey = file.s3Key || file.key;
        if (!targetKey) {
          throw new Error('No s3Key present on File record.');
        }

        // Download original image bytes from Backblaze B2 (Read-only GetObject)
        const s3Res = await s3Client.send(new GetObjectCommand({
          Bucket: bucket,
          Key: targetKey,
        }));
        const originalBuffer = await streamToBuffer(s3Res.Body);

        // Check if HEIC / HEIF
        const isHeic = Boolean(
          (file.mimeType && (file.mimeType === 'image/heic' || file.mimeType === 'image/heif')) ||
          (file.mimetype && (file.mimetype === 'image/heic' || file.mimetype === 'image/heif')) ||
          /\.(heic|heif)$/i.test(file.name || '') ||
          /\.(heic|heif)$/i.test(file.originalName || '')
        );

        let imgBuf = originalBuffer;
        if (isHeic) {
          try {
            imgBuf = await heicConvert({
              buffer: originalBuffer,
              format: 'JPEG',
              quality: 0.85,
            });
          } catch (heicErr) {
            console.warn(`[CloudGuard Backfill] heic-convert failed for ${file.name || file._id}, falling back to sharp direct decode: ${heicErr.message}`);
            imgBuf = originalBuffer;
          }
        }

        // Exact thumbnail sizing & WebP quality matching client/src/utils/thumbnailHelper.js:
        // maxDimension = 320, quality = 0.7 (70%), fit = inside, withoutEnlargement = true, auto-rotate via EXIF
        const thumbBuffer = await sharp(imgBuf)
          .rotate()
          .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 70 })
          .toBuffer();

        const rawUserId = String(file.userId || 'system');
        const thumbS3Key = `thumbnails/${rawUserId}/${Date.now()}-${file._id}.webp`;

        if (!isDryRun) {
          // Upload thumbnail to Backblaze B2
          await s3Client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: thumbS3Key,
            Body: thumbBuffer,
            ContentType: 'image/webp',
          }));

          // Update ONLY thumbnailKey on the MongoDB File record
          await File.updateOne(
            { _id: file._id },
            { $set: { thumbnailKey: thumbS3Key } }
          );
        }

        generatedCount++;
        console.log(`✓ [${generatedCount}/${scannedCount}] ${isDryRun ? '[DRY-RUN] ' : ''}Thumbnail generated for "${file.name || file.originalName}" (${(thumbBuffer.length / 1024).toFixed(1)} KB) -> ${thumbS3Key}`);
      } catch (fileErr) {
        failedCount++;
        console.error(`✗ [FAILED] "${file.name || file.originalName || file._id}": ${fileErr.message}`);
      }
    }
  } catch (err) {
    console.error('[CloudGuard Backfill Fatal Error]:', err.message);
  } finally {
    console.log('\n========================================');
    console.log('Thumbnail Backfill Summary:');
    console.log(`Scanned:   ${scannedCount}`);
    console.log(`Generated: ${generatedCount}`);
    console.log(`Failed:    ${failedCount}`);
    if (isDryRun) {
      console.log('(Dry Run: No changes were written to S3 or MongoDB)');
    }
    console.log('========================================\n');

    try {
      await mongoose.disconnect();
    } catch (_) {}

    process.exit(0);
  }
}

runBackfill();
