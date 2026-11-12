import { 
  S3Client, 
  ListObjectsV2Command, 
  CopyObjectCommand, 
  HeadObjectCommand, 
  DeleteObjectCommand 
} from '@aws-sdk/client-s3';
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

const BUCKET_NAME = process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET || 'cloudguard-vault-mumbai-2026';

async function runMigration() {
  console.log('[Migration] Connecting to MongoDB...');
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('Neither MONGODB_URI nor MONGO_URI is defined in server/.env');
  }
  await mongoose.connect(mongoUri);
  console.log('[Migration] Connected to MongoDB.');

  const db = mongoose.connection.db;
  const filesCollection = db.collection('files');

  console.log(`[Migration] Scanning S3 bucket: ${BUCKET_NAME} for root objects...`);
  
  let continuationToken = null;
  let migratedCount = 0;
  let skippedCount = 0;

  do {
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      ContinuationToken: continuationToken,
    });

    const response = await s3.send(listCommand);
    const contents = response.Contents || [];

    for (const object of contents) {
      const oldKey = object.Key;

      // Skip objects already inside uploads/ or thumbnails/ or empty folder markers
      if (
        oldKey.startsWith('uploads/') || 
        oldKey.startsWith('thumbnails/') || 
        oldKey.endsWith('/')
      ) {
        skippedCount++;
        continue;
      }

      const newKey = `uploads/${oldKey}`;
      console.log(`\n[Migrating]: "${oldKey}" -> "${newKey}" (${object.Size} bytes)`);

      try {
        // Step A: Copy object to destination in S3
        // Preserves folder slashes while safely URI-encoding any special or non-ASCII characters
        const encodedCopySource = `${BUCKET_NAME}/${oldKey.split('/').map(segment => encodeURIComponent(segment)).join('/')}`;
        await s3.send(new CopyObjectCommand({
          Bucket: BUCKET_NAME,
          CopySource: encodedCopySource,
          Key: newKey,
        }));

        // Step B: Verify the copy exists in S3 and matches size
        const head = await s3.send(new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: newKey,
        }));

        if (head.ContentLength !== object.Size) {
          throw new Error(`Size mismatch: source ${object.Size} vs target ${head.ContentLength}`);
        }

        // Step C: Update MongoDB reference
        // Check both common field patterns: s3Key and key
        const updateResult = await filesCollection.updateMany(
          { $or: [{ s3Key: oldKey }, { key: oldKey }, { path: oldKey }] },
          { $set: { s3Key: newKey, key: newKey } }
        );

        console.log(`  └─ DB updated: ${updateResult.modifiedCount} document(s) matching old key.`);

        // Step D: Delete the old root object from S3
        await s3.send(new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: oldKey,
        }));
        console.log(`  └─ Cleaned up old root S3 object.`);

        migratedCount++;
      } catch (err) {
        console.error(`  [FAILED] Could not migrate "${oldKey}":`, err.message);
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  console.log(`\n==============================================`);
  console.log(`[Migration Complete]`);
  console.log(`Total Files Migrated: ${migratedCount}`);
  console.log(`Total Unaffected / Skipped: ${skippedCount}`);
  console.log(`==============================================\n`);

  await mongoose.disconnect();
  process.exit(0);
}

runMigration().catch((err) => {
  console.error('[Fatal Error]:', err);
  process.exit(1);
});

