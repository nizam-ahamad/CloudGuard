require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const File = require('../models/File');
const User = require('../models/User');

async function resync() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI is not set in environment or server/.env');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log('Synchronizing CloudGuard system...');

  // 1. Purge orphaned scan_failed files
  const purged = await File.deleteMany({
    securityStatus: 'scan_failed',
    size: { $in: [0, null, undefined] },
  });
  console.log(`Purged ${purged.deletedCount} corrupted/failed scan records.`);

  // 2. Reconcile storageUsed across all users
  const users = await User.find({});
  for (const user of users) {
    const stats = await File.aggregate([
      {
        $match: {
          $or: [{ userId: user._id }, { user: user._id }],
          isTrash: { $ne: true },
          securityStatus: { $ne: 'threat_purged' },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ['$size', 0] } },
        },
      },
    ]);

    const actualBytes = stats[0]?.total || 0;
    await User.findByIdAndUpdate(user._id, { storageUsed: actualBytes });
    console.log(`User ${user.email}: Storage resynced to ${actualBytes} bytes.`);
  }

  console.log('System synchronization complete.');
  await mongoose.disconnect();
}

resync().catch(console.error);

