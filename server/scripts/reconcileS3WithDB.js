const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();
const mongoose = require('mongoose');
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const File = require('../models/File');
const User = require('../models/User');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const bucketName = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;

function getMimeType(fileName) {
  const ext = (fileName || '').split('.').pop().toLowerCase();
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    mkv: 'video/x-matroska',
    mov: 'video/quicktime',
    pdf: 'application/pdf',
    txt: 'text/plain',
    zip: 'application/zip',
    exe: 'application/x-msdownload',
  };
  return map[ext] || 'application/octet-stream';
}

async function reconcileS3() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cloudguard';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    const user = await User.findOne({});
    if (!user) {
      console.error('No user found in MongoDB to assign legacy files to.');
      process.exit(1);
    }
    const defaultUserId = user._id;

    console.log(`Scanning S3 bucket "${bucketName}" for legacy root objects...`);

    let continuationToken = null;
    let importedCount = 0;
    let existingCount = 0;

    do {
      const listCmd = new ListObjectsV2Command({
        Bucket: bucketName,
        ContinuationToken: continuationToken,
      });

      const listRes = await s3Client.send(listCmd);
      continuationToken = listRes.NextContinuationToken;

      const objects = listRes.Contents || [];

      for (const obj of objects) {
        const s3Key = obj.Key;

        // Skip modern uploads, thumbnails, and directory markers
        if (s3Key.startsWith('uploads/') || s3Key.startsWith('thumbnails/') || s3Key.endsWith('/')) {
          continue;
        }

        const existingFile = await File.findOne({ s3Key });
        if (existingFile) {
          if (existingFile.isTrash) {
            existingFile.isTrash = false;
            await existingFile.save();
          }
          existingCount++;
          continue;
        }

        const keyParts = s3Key.split('/');
        let ownerId = defaultUserId;
        if (keyParts.length > 1 && mongoose.Types.ObjectId.isValid(keyParts[0])) {
          ownerId = new mongoose.Types.ObjectId(keyParts[0]);
        }

        const rawFileName = keyParts[keyParts.length - 1];
        const cleanName = rawFileName.replace(/^\d{10,13}-/, '');
        const mimeType = getMimeType(cleanName);

        let thumbnailKey = null;
        if (mimeType.startsWith('image/')) {
          try {
            const getObj = await s3Client.send(new GetObjectCommand({
              Bucket: bucketName,
              Key: s3Key,
            }));

            const streamToBuffer = (stream) =>
              new Promise((resolve, reject) => {
                const chunks = [];
                stream.on('data', (c) => chunks.push(c));
                stream.on('error', reject);
                stream.on('end', () => resolve(Buffer.concat(chunks)));
              });

            const imgBuffer = await streamToBuffer(getObj.Body);

            const thumbBuffer = await sharp(imgBuffer, { failOnError: false })
              .rotate()
              .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 78 })
              .toBuffer();

            thumbnailKey = `thumbnails/${ownerId}/${Date.now()}-legacy.webp`;
            await s3Client.send(new PutObjectCommand({
              Bucket: bucketName,
              Key: thumbnailKey,
              Body: thumbBuffer,
              ContentType: 'image/webp',
            }));
          } catch (thumbErr) {
            console.warn(`Could not generate thumbnail for ${cleanName}:`, thumbErr.message);
          }
        }

        await File.create({
          name: cleanName,
          originalName: cleanName,
          sanitizedName: cleanName.replace(/[^a-zA-Z0-9._-]/g, '_'),
          size: obj.Size || 0,
          mimeType,
          s3Key,
          thumbnailKey,
          userId: ownerId,
          folder: null,
          folderId: null,
          isTrash: false,
          isMalicious: false,
          securityStatus: 'clean',
          uploadedAt: obj.LastModified || new Date(),
        });

        console.log(`+ Reconciled legacy file: ${cleanName} (${s3Key})`);
        importedCount++;
      }
    } while (continuationToken);

    // Reconcile storage used across all active users
    const users = await User.find({});
    for (const u of users) {
      const stats = await File.aggregate([
        {
          $match: {
            userId: u._id,
            isTrash: false,
            securityStatus: { $ne: 'threat_purged' },
          },
        },
        {
          $group: {
            _id: null,
            totalBytes: { $sum: { $ifNull: ['$size', 0] } },
          },
        },
      ]);

      const actualBytes = stats[0]?.totalBytes || 0;
      await User.findByIdAndUpdate(u._id, { storageUsed: actualBytes });
      console.log(`User ${u.email}: Storage usage resynced to ${actualBytes} bytes.`);
    }

    console.log(`\nReconciliation summary:`);
    console.log(`- Existing registered files checked: ${existingCount}`);
    console.log(`- Newly registered legacy files: ${importedCount}`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Reconciliation execution error:', err);
    process.exit(1);
  }
}

reconcileS3();

