const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();
const mongoose = require('mongoose');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const File = require('../models/File');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-central-003',
  ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || 'cloudguard-vault-mumbai-2026';

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function extractVideoFrame(videoPath, outputPath, seekSeconds = 1.0) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .setStartTime(seekSeconds)
      .frames(1)
      .outputOptions(['-q:v 2', '-pix_fmt yuv420p'])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

async function backfillAllMediaThumbnails() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    await mongoose.connect(mongoUri);
    console.log('[Thumbnail Generator] Connected to MongoDB.');

    // Query non-trash media files missing thumbnailKey
    const pendingMedia = await File.find({
      isTrash: false,
      $or: [
        { mimeType: { $regex: '^(image|video)/', $options: 'i' } },
        { name: { $regex: /\.(jpg|jpeg|png|webp|gif|mp4|webm|mov|mkv)$/i } },
      ],
      $and: [
        {
          $or: [
            { thumbnailKey: null },
            { thumbnailKey: { $exists: false } },
            { thumbnailKey: '' },
          ],
        },
      ],
    });

    console.log(`[Thumbnail Generator] Found ${pendingMedia.length} media item(s) without thumbnails.\n`);

    let processedCount = 0;
    let failedCount = 0;

    for (const item of pendingMedia) {
      const ext = (item.name.split('.').pop() || '').toLowerCase();
      const isVideo = (item.mimeType && item.mimeType.startsWith('video/')) || ['mp4', 'mov', 'webm', 'mkv'].includes(ext);
      const isImage = (item.mimeType && item.mimeType.startsWith('image/')) || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);

      console.log(`Processing [${isVideo ? 'VIDEO' : 'IMAGE'}]: ${item.name} (Key: ${item.s3Key})`);

      try {
        let webpBuffer = null;

        if (isImage) {
          // Process Image directly in memory
          const getObj = await s3Client.send(new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: item.s3Key,
          }));

          const rawBuffer = await streamToBuffer(getObj.Body);

          webpBuffer = await sharp(rawBuffer, { failOnError: false })
            .rotate()
            .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 78 })
            .toBuffer();

        } else if (isVideo) {
          // Process Video via temp file & ffmpeg
          const tmpVideoPath = path.join(os.tmpdir(), `temp_vid_${item._id}.${ext}`);
          const tmpFramePath = path.join(os.tmpdir(), `temp_frame_${item._id}.jpg`);

          try {
            const getObj = await s3Client.send(new GetObjectCommand({
              Bucket: BUCKET_NAME,
              Key: item.s3Key,
            }));

            await new Promise((resolve, reject) => {
              const writeStream = fs.createWriteStream(tmpVideoPath);
              getObj.Body.pipe(writeStream);
              getObj.Body.on('error', reject);
              writeStream.on('finish', resolve);
            });

            // Extract frame at 1.0s (fallback to 0.0s if extraction fails)
            try {
              await extractVideoFrame(tmpVideoPath, tmpFramePath, 1.0);
            } catch (seekErr) {
              await extractVideoFrame(tmpVideoPath, tmpFramePath, 0.0);
            }

            if (fs.existsSync(tmpFramePath)) {
              webpBuffer = await sharp(tmpFramePath)
                .rotate()
                .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 78 })
                .toBuffer();
            }
          } finally {
            if (fs.existsSync(tmpVideoPath)) fs.unlinkSync(tmpVideoPath);
            if (fs.existsSync(tmpFramePath)) fs.unlinkSync(tmpFramePath);
          }
        }

        if (!webpBuffer) {
          throw new Error('Failed to create WebP buffer');
        }

        // Upload generated thumbnail to S3 under thumbnails/ prefix
        const thumbnailKey = `thumbnails/${item.userId}/${Date.now()}-${item._id}.webp`;

        await s3Client.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: thumbnailKey,
          Body: webpBuffer,
          ContentType: 'image/webp',
        }));

        // Update MongoDB document
        item.thumbnailKey = thumbnailKey;
        await item.save();

        console.log(`  └─ Saved: ${thumbnailKey} (${(webpBuffer.length / 1024).toFixed(1)} kB)`);
        processedCount++;
      } catch (err) {
        console.error(`  └─ [ERROR] Skipping ${item.name}:`, err.message);
        failedCount++;
      }
    }

    console.log(`\n==============================================`);
    console.log(`[Batch Finished]`);
    console.log(`Successfully Generated: ${processedCount}`);
    console.log(`Failed / Skipped: ${failedCount}`);
    console.log(`==============================================\n`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (fatalErr) {
    console.error('Fatal execution error:', fatalErr);
    process.exit(1);
  }
}

backfillAllMediaThumbnails();

