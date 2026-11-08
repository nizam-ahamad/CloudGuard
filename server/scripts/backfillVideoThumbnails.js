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
  region: process.env.AWS_REGION || 'ap-south-1',
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
        resolve(10);
      } else {
        resolve(metadata.format.duration);
      }
    });
  });
}

function extractSingleFrame(videoPath, outputPath, seekSeconds) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .setStartTime(seekSeconds) // Accurate output seek (after -i) to decode true frame
      .frames(1)
      .outputOptions(['-q:v 2', '-pix_fmt yuv420p'])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

async function runLuminanceAwareExtraction() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cloudguard';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    // Find all active video files
    const videos = await File.find({
      isTrash: false,
      $or: [
        { mimeType: { $regex: '^video/', $options: 'i' } },
        { mimetype: { $regex: '^video/', $options: 'i' } },
        { name: { $regex: /\.(mp4|webm|mov|mkv)$/i } },
        { originalName: { $regex: /\.(mp4|webm|mov|mkv)$/i } },
      ],
    });

    console.log(`Checking ${videos.length} video(s) for black thumbnail replacement...`);

    for (const video of videos) {
      const tmpVideoPath = path.join(os.tmpdir(), `vid_${video._id}.mp4`);
      console.log(`\nEvaluating: ${video.name}...`);

      try {
        // 1. Download video binary to temp
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

        // Test candidate timestamps across the video to avoid intro fade-ins
        const candidates = [
          Math.min(3.0, duration * 0.2),
          Math.min(6.0, duration * 0.35),
          duration * 0.5,
          duration * 0.75,
          1.5,
        ].filter((t) => t < duration);

        let bestFramePath = null;
        let bestLuminance = -1;

        for (let i = 0; i < candidates.length; i++) {
          const seekTime = candidates[i];
          const framePath = path.join(os.tmpdir(), `frame_${video._id}_${i}.jpg`);

          try {
            await extractSingleFrame(tmpVideoPath, framePath, seekTime);
            const stats = await sharp(framePath).stats();
            // Calculate mean brightness across channels (0 to 255)
            const lum = (stats.channels[0].mean + stats.channels[1].mean + stats.channels[2].mean) / 3;
            console.log(`  Candidate @ ${seekTime.toFixed(1)}s -> Luminance: ${lum.toFixed(1)}/255`);

            if (lum > bestLuminance) {
              bestLuminance = lum;
              bestFramePath = framePath;
            }

            // If brightness > 25, this frame has clear visible content and is not black
            if (lum > 25) {
              console.log(`  Found clear non-black frame at ${seekTime.toFixed(1)}s!`);
              break;
            }
          } catch (frameErr) {
            console.warn(`  Failed extraction at ${seekTime}s:`, frameErr.message);
          }
        }

        if (!bestFramePath || !fs.existsSync(bestFramePath)) {
          console.warn(`  Could not find valid frame for ${video.name}`);
          continue;
        }

        // 2. Convert best frame to 512px WebP
        const webpBuffer = await sharp(bestFramePath)
          .rotate()
          .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();

        // 3. Upload to S3 thumbnails prefix
        const thumbnailKey = `thumbnails/${video.userId}/${Date.now()}-${video._id}.webp`;
        await s3Client.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: thumbnailKey,
          Body: webpBuffer,
          ContentType: 'image/webp',
        }));

        // 4. Update MongoDB
        video.thumbnailKey = thumbnailKey;
        await video.save();
        console.log(`  ✅ Successfully updated thumbnail: ${thumbnailKey} (${(webpBuffer.length / 1024).toFixed(1)} kB)`);

        // Clean candidate frame files
        for (let i = 0; i < candidates.length; i++) {
          const fp = path.join(os.tmpdir(), `frame_${video._id}_${i}.jpg`);
          if (fs.existsSync(fp)) {
            try { fs.unlinkSync(fp); } catch (e) {}
          }
        }
      } catch (err) {
        console.error(`  ❌ Error processing ${video.name}:`, err.message);
      } finally {
        if (fs.existsSync(tmpVideoPath)) {
          try { fs.unlinkSync(tmpVideoPath); } catch (e) {}
        }
      }
    }

    console.log('\nVideo thumbnail regeneration complete.');
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Execution error:', err);
    process.exit(1);
  }
}

runLuminanceAwareExtraction();
