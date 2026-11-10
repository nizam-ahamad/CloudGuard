const mongoose = require('mongoose');
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET;

async function executeSync() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('[Maintenance] Connected to MongoDB Atlas.');

  const File = mongoose.model('File', new mongoose.Schema({}, { strict: false }));
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));

  // 1. Remove duplicate file records with identical s3Key in DB
  const allActiveFiles = await File.find({
    isTrash: { $ne: true },
    securityStatus: { $ne: 'threat_purged' }
  });

  const seenKeys = new Set();
  let duplicatesDeleted = 0;
  for (const f of allActiveFiles) {
    if (f.s3Key && seenKeys.has(f.s3Key)) {
      await File.deleteOne({ _id: f._id });
      duplicatesDeleted++;
    } else if (f.s3Key) {
      seenKeys.add(f.s3Key);
    }
  }
  console.log(`[Maintenance] Purged ${duplicatesDeleted} duplicate DB file records.`);

  // 2. Fetch all valid registered keys from MongoDB
  const validFiles = await File.find({
    isTrash: { $ne: true },
    securityStatus: { $ne: 'threat_purged' }
  }).select('s3Key thumbnailKey').lean();

  const registeredKeys = new Set();
  for (const f of validFiles) {
    if (f.s3Key) registeredKeys.add(f.s3Key);
    if (f.thumbnailKey) registeredKeys.add(f.thumbnailKey);
  }

  // 3. Scan S3 bucket and find orphaned objects
  let continuationToken = null;
  const orphanedKeys = [];

  do {
    const listRes = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      ContinuationToken: continuationToken,
    }));

    const contents = listRes.Contents || [];
    for (const item of contents) {
      if (!registeredKeys.has(item.Key)) {
        orphanedKeys.push({ Key: item.Key });
      }
    }
    continuationToken = listRes.NextContinuationToken;
  } while (continuationToken);

  console.log(`[Maintenance] Found ${orphanedKeys.length} orphaned object(s) in S3.`);

  // 4. Batch delete orphaned objects from S3
  if (orphanedKeys.length > 0) {
    for (let i = 0; i < orphanedKeys.length; i += 1000) {
      const chunk = orphanedKeys.slice(i, i + 1000);
      await s3.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: chunk, Quiet: true }
      }));
      console.log(`[Maintenance] Deleted ${chunk.length} orphaned object(s) from S3.`);
    }
  }

  // 5. Clean up soft-deleted trash records in MongoDB
  const trashRes = await File.deleteMany({ isTrash: true });
  console.log(`[Maintenance] Removed ${trashRes.deletedCount} trashed records from DB.`);

  // 6. Recalculate true storage quota for each user
  const users = await User.find({});
  for (const u of users) {
    const rawId = u._id;
    const stats = await File.aggregate([
      {
        $match: {
          isTrash: { $ne: true },
          securityStatus: { $ne: 'threat_purged' },
          $or: [{ userId: rawId }, { user: rawId }, { userId: String(rawId) }, { user: String(rawId) }]
        }
      },
      {
        $group: {
          _id: null,
          totalBytes: { $sum: { $ifNull: ['$size', 0] } }
        }
      }
    ]);

    const trueStorageUsed = stats[0]?.totalBytes || 0;
    await User.findByIdAndUpdate(rawId, { storageUsed: trueStorageUsed });
    console.log(`[Maintenance] User ${u.email}: Synced quota to ${(trueStorageUsed / 1024 / 1024).toFixed(2)} MB.`);
  }

  console.log('[Maintenance] Storage sync and S3 orphan cleanup completed successfully.');
  process.exit(0);
}

executeSync().catch((err) => {
  console.error('[Maintenance Error]:', err);
  process.exit(1);
});

