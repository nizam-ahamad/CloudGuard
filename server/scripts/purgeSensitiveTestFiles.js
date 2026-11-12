const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const File = require('../models/File');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-central-003',
  ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function purgeSensitiveFiles() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is missing from environment variables');
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB. Scanning for test secrets and threats...');

  const targets = await File.find({
    name: {
      $regex: /aws keys|mongo\.txt|google scripts|vt api|test virus|eicar|nfs13/i,
    },
  });

  console.log(`Found ${targets.length} sensitive/test files to purge.`);

  const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;

  for (const file of targets) {
    if (file.s3Key && bucket) {
      try {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: file.s3Key,
          })
        );
        console.log(`Deleted from S3: ${file.s3Key}`);
      } catch (err) {
        console.warn(`S3 delete skip (${file.s3Key}): ${err.message}`);
      }
    }
    await File.findByIdAndDelete(file._id);
    console.log(`Removed DB record: ${file.name}`);
  }

  console.log('Purge complete.');
  await mongoose.disconnect();
}

purgeSensitiveFiles().catch(console.error);

