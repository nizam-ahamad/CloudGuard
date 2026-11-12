// server/scripts/regenerateVideoThumbnails.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();
const mongoose = require('mongoose');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const File = require('../models/File');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
if (ffprobeInstaller && ffprobeInstaller.path) {
  ffmpeg.setFfprobePath(ffprobeInstaller.path);
}

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-central-003',
  ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const bucketName = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || 'cloudguard-vault-mumbai-2026';

function getVideoDuration(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err || !metadata?.format?.duration) {
        resolve(120);
      } else {
        resolve(Number(metadata.format.duration));
      }
    });
  });
}

function extractAccurateFrame(videoPath, outputPath, seekSeconds) {
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

async function regenerateThumbnails() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cloudguard';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    const videos = await File.find({
      isTrash: false,
      $or: [
        { mimeType: { $regex: '^video/', $options: 'i' } },
        { name: { $regex: /\.(mp4|webm|mov|mkv)$/i } },
      ],
    });

    console.log(`Processing ${videos.length} video(s)...`);

    for (const video of videos) {
      const tmpVideoPath = path.join(os.tmpdir(), `vid_${video._id}.mp4`);
      console.log(`\nEvaluating: ${video.name}`);

      try {
        const getObj = await s3Client.send(new GetObjectCommand({
          Bucket: bucketName,
          Key: video.s3Key,
        }));

        await new Promise((resolve, reject) => {
          const writeStream = fs.createWriteStream(tmpVideoPath);
          getObj.Body.pipe(writeStream);
          getObj.Body.on('error', reject);
          writeStream.on('finish', resolve);
        });

        const duration = await getVideoDuration(tmpVideoPath);
        console.log(`  Duration: ${duration.toFixed(1)}s`);

        // Candidate timestamps prioritizing 5.0s (with safe fallbacks for shorter clips)
        const candidates = [5.0, 2.0, 1.0].filter((t) => t < duration);
        if (candidates.length === 0) candidates.push(Math.max(0.1, duration * 0.5));

        let bestFramePath = null;
        let bestLuminance = -1;

        for (let i = 0; i < candidates.length; i++) {
          const seekTime = candidates[i];
          const framePath = path.join(os.tmpdir(), `frame_${video._id}_${i}.jpg`);

          try {
            await extractAccurateFrame(tmpVideoPath, framePath, seekTime);
            const stats = await sharp(framePath).stats();
            const lum = (stats.channels[0].mean + stats.channels[1].mean + stats.channels[2].mean) / 3;
            console.log(`  Candidate @ ${seekTime.toFixed(1)}s -> Luminance: ${lum.toFixed(1)}/255`);

            if (lum > bestLuminance) {
              bestLuminance = lum;
              bestFramePath = framePath;
            }

            if (lum >= 20) {
              console.log(`  Found acceptable non-black scene @ ${seekTime.toFixed(1)}s!`);
              break;
            }
          } catch (frameErr) {
            console.warn(`  Extraction failed @ ${seekTime}s:`, frameErr.message);
          }
        }

        if (!bestFramePath || !fs.existsSync(bestFramePath)) {
          console.warn(`  Could not obtain valid frame for ${video.name}`);
          continue;
        }

        const webpBuffer = await sharp(bestFramePath)
          .rotate()
          .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();

        const thumbnailKey = `thumbnails/${video.userId}/${Date.now()}-${video._id}.webp`;
        await s3Client.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: thumbnailKey,
          Body: webpBuffer,
          ContentType: 'image/webp',
        }));

        video.thumbnailKey = thumbnailKey;
        await video.save();
        console.log(`  ✅ Stored WebP thumbnail: ${thumbnailKey} (Lum: ${bestLuminance.toFixed(1)})`);

        for (let i = 0; i < candidates.length; i++) {
          const fp = path.join(os.tmpdir(), `frame_${video._id}_${i}.jpg`);
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
      } catch (err) {
        console.error(`  ❌ Error processing ${video.name}:`, err.message);
      } finally {
        if (fs.existsSync(tmpVideoPath)) fs.unlinkSync(tmpVideoPath);
      }
    }

    console.log('\nRegeneration complete.');
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Fatal regeneration error:', err);
    process.exit(1);
  }
}

regenerateThumbnails();

