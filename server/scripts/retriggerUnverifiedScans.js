const mongoose = require('mongoose');
const { S3Client, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios');
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
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';
const EICAR_SIG = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE';

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('[Repair] Connected to MongoDB.');

  const File = mongoose.model('File', new mongoose.Schema({}, { strict: false }));
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));

  const files = await File.find({
    $or: [
      { securityStatus: 'unverified' },
      { name: 'ei.txt' }
    ]
  });

  console.log(`[Repair] Found ${files.length} file(s) to process.`);

  for (const file of files) {
    let isThreat = false;
    let threatReason = '';

    // Step A: Check raw bytes for EICAR signature
    try {
      const res = await s3.send(new GetObjectCommand({
        Bucket: BUCKET,
        Key: file.s3Key,
        Range: 'bytes=0-1024'
      }));
      const chunks = [];
      for await (const chunk of res.Body) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      if (buf.toString('utf8').includes(EICAR_SIG)) {
        isThreat = true;
        threatReason = 'EICAR signature in payload';
      }
    } catch (e) {
      console.warn(`[Byte Check] ${file.name}: ${e.message}`);
    }

    // Step B: Query AI Scanner if not already identified as a threat
    if (!isThreat) {
      try {
        const scan = await axios.post(`${AI_SERVICE_URL}/scan`, {
          s3Key: file.s3Key,
          fileName: file.name,
          sha256: file.sha256 || null,
        }, { timeout: 15000 });

        if (scan.data?.isMalicious) {
          isThreat = true;
          threatReason = scan.data?.reason || 'Flagged by AI Scanner';
        }
      } catch (scanErr) {
        console.error(`[Scan Error] ${file.name}: ${scanErr.message}`);
      }
    }

    // Step C: Purge or Promote
    if (isThreat) {
      console.log(`[PURGE] Threat confirmed for "${file.name}" (${threatReason}). Deleting...`);
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: file.s3Key }));
      } catch (s3Err) {
        console.error(`S3 Delete error: ${s3Err.message}`);
      }
      await File.deleteOne({ _id: file._id });
      console.log(`[Purged] "${file.name}" completely removed.`);
    } else {
      console.log(`[SAFE] Promoting "${file.name}" to Safe...`);
      await File.updateOne(
        { _id: file._id },
        { $set: { securityStatus: 'clean', isMalicious: false, status: 'safe' } }
      );
      if (file.userId && file.size) {
        await User.findByIdAndUpdate(file.userId, { $inc: { storageUsed: file.size } });
      }
      console.log(`[Clean] "${file.name}" marked Safe.`);
    }
  }

  console.log('[Repair] Complete.');
  process.exit(0);
}

run().catch((err) => {
  console.error('[Fatal Error]:', err);
  process.exit(1);
});
