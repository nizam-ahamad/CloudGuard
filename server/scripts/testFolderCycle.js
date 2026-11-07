const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();
const mongoose = require('mongoose');
const { buildTenantQuery } = require('../utils/tenantQuery');

async function testFolderLifecycle() {
  console.log('[Test Runner] Starting Folder Create -> Delete -> Re-create Lifecycle Test...\n');

  const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('MONGO_URI is missing from environment.');
    process.exit(1);
  }

  await mongoose.connect(mongoURI);
  const Folder = require('../models/Folder');
  const User = require('../models/User');

  try {
    // 1. Sync indexes to guarantee partialFilterExpression is active
    await Folder.syncIndexes();

    // 2. Locate an active user
    const testUser = await User.findOne({}).lean();
    if (!testUser) {
      throw new Error('No user found in database to execute test.');
    }
    const userId = testUser._id;
    const testFolderName = `__auto_test_folder_${Date.now()}`;

    // Clean up any stale test records
    await Folder.deleteMany({ name: testFolderName });

    // Step A: Create folder
    const folder1 = await Folder.create({
      name: testFolderName,
      userId: userId,
      parentId: null,
      isTrash: false,
    });
    console.log(`✅ Step 1: Created folder "${testFolderName}" (ID: ${folder1._id})`);

    // Step B: Duplicate check must catch active duplicate
    const activeDup = await Folder.findOne(
      buildTenantQuery(userId, {
        parentId: null,
        name: testFolderName,
        isTrash: { $ne: true },
      })
    );
    if (!activeDup) throw new Error('Active duplicate check failed to identify existing folder.');
    console.log('✅ Step 2: Active duplicate successfully detected.');

    // Step C: Soft delete folder
    folder1.isTrash = true;
    folder1.trashedAt = new Date();
    await folder1.save();
    console.log('✅ Step 3: Folder soft-deleted (isTrash: true).');

    // Step D: Duplicate check must IGNORE trashed folder
    const trashedDupCheck = await Folder.findOne(
      buildTenantQuery(userId, {
        parentId: null,
        name: testFolderName,
        isTrash: { $ne: true },
      })
    );
    if (trashedDupCheck) {
      throw new Error('Duplicate check incorrectly matched a trashed folder!');
    }
    console.log('✅ Step 4: Duplicate query correctly ignored trashed folder.');

    // Step E: Create second folder with the exact same name
    const folder2 = await Folder.create({
      name: testFolderName,
      userId: userId,
      parentId: null,
      isTrash: false,
    });
    console.log(`✅ Step 5: Successfully re-created folder with identical name "${testFolderName}" (ID: ${folder2._id})`);

    // Clean up test data
    await Folder.deleteMany({ _id: { $in: [folder1._id, folder2._id] } });
    console.log('\n[Test Runner] All checks passed. 409 Conflict issue resolved.');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ [Test Runner] Test Failed:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

testFolderLifecycle();
