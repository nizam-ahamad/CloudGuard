const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const File = require('../models/File');

async function syncPointers() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is missing from environment variables');
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB. Synchronizing folder pointers...');

  // 1. If folder has an ID but folderId is null/missing -> copy folder to folderId
  const res1 = await File.updateMany(
    { folder: { $ne: null }, folderId: null },
    [{ $set: { folderId: '$folder' } }]
  );

  // 2. If folderId has an ID but folder is null/missing -> copy folderId to folder
  const res2 = await File.updateMany(
    { folderId: { $ne: null }, folder: null },
    [{ $set: { folder: '$folderId' } }]
  );

  console.log(`Synced folder pointers: ${res1.modifiedCount + res2.modifiedCount} files updated.`);
  await mongoose.disconnect();
}

syncPointers().catch(console.error);

