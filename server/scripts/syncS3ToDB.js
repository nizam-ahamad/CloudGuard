import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'eu-central-003',
  ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.AWS_BUCKET_NAME || 'cloudguard-vault-mumbai-2026';

async function sync() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const filesCol = db.collection('files');
  const usersCol = db.collection('users');

  // Find active primary user
  const user = await usersCol.findOne({ email: 'tenben9210@gmail.com' });
  if (!user) {
    console.error('User tenben9210@gmail.com not found in DB');
    process.exit(1);
  }

  console.log(`Auditing S3 for user: ${user._id} (${user.email})...`);

  // List all objects in uploads/
  let continuationToken = null;
  let alreadySynced = 0;
  let newlyImported = 0;

  do {
    const list = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: 'uploads/',
      ContinuationToken: continuationToken,
    }));

    const contents = list.Contents || [];

    for (const item of contents) {
      if (item.Key.endsWith('/')) continue;

      // Check if key exists in MongoDB
      const existing = await filesCol.findOne({
        $or: [{ s3Key: item.Key }, { key: item.Key }]
      });

      if (existing) {
        alreadySynced++;
      } else {
        // Extract file name
        const fileName = item.Key.split('/').pop().replace(/^\d{10,14}-/, '');
        const ext = fileName.split('.').pop().toLowerCase();
        const isVideo = ['mp4', 'mov', 'mkv', 'webm'].includes(ext);
        const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);

        await filesCol.insertOne({
          name: fileName,
          originalName: fileName,
          size: item.Size,
          mimeType: isVideo ? `video/${ext}` : isImage ? `image/${ext}` : 'application/octet-stream',
          s3Key: item.Key,
          key: item.Key,
          userId: user._id,
          user: user._id,
          folder: null,
          folderId: null,
          isTrash: false,
          securityStatus: 'clean',
          status: 'safe',
          uploadedAt: item.LastModified || new Date(),
          createdAt: item.LastModified || new Date(),
          updatedAt: item.LastModified || new Date(),
        });
        console.log(`+ Registered missing file to DB: ${fileName} (${item.Key})`);
        newlyImported++;
      }
    }

    continuationToken = list.NextContinuationToken;
  } while (continuationToken);

  console.log(`\nAudit Complete:`);
  console.log(`- Files already tracked in DB: ${alreadySynced}`);
  console.log(`- Missing files imported to DB: ${newlyImported}`);

  await mongoose.disconnect();
  process.exit(0);
}

sync().catch(console.error);

