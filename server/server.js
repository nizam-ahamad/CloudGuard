require('node:dns/promises').setServers(['1.1.1.1', '8.8.8.8']);
require('dotenv').config();

const requiredEnv = ['JWT_SECRET', 'RESEND_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_BUCKET_NAME', 'MONGO_URI'];
const missing = requiredEnv.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`FATAL ERROR: Missing critical environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const FormData = require('form-data');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, ListObjectVersionsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { buildTenantQuery } = require('./utils/tenantQuery');
const { permanentlyDeleteS3Keys } = require('./utils/s3Delete');
const { apiLimiter } = require('./middleware/rateLimiter');
const { sendActivationOtp, sendResetOtp, sendWelcomeEmail } = require('./utils/emailService');

// Multer in-memory storage configuration (prevent EC2 disk space exhaustion)
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const WHITELISTED_HASHES = [
  '9b0c8e42758f48c426a39c1919281322381a77d7e526d5b7be7cdb63e1d2873a', // Antigravity.exe
  'df765a8ae84a673ae9e8c8e60eca8e7e839351029c58803a107b8f010ce7b736', // Antigravity IDE.exe
  '231d90772d0e26d4376e85bc35fb349c2341926cba84d800828791b33e1103ef',
  process.env.ANTIGRAVITY_SHA256?.toLowerCase().trim(),
].filter(Boolean).map(h => h.toLowerCase().trim());

const app = express();

// Trust first proxy hop (Nginx reverse proxy on EC2 / Vercel rewrite)
app.set('trust proxy', 1);

// Disable 304 Not Modified generation
app.set('etag', false);

const helmet = require('helmet');

// Security Headers (Configured to permit cross-origin S3 thumbnails and Vercel proxying)
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
  })
);

// Configure CORS for Vite frontend (Mounted before rate limiters to handle OPTIONS preflights cleanly)
app.use(cors({
  origin: ['http://localhost:5173', 'https://cloud-guard-self.vercel.app', 'https://cloudguard-app.duckdns.org', 'https://cloudguard.site', 'https://www.cloudguard.site'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true
}));

// Enforce dynamic freshness on all API routes
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

// Baseline API rate limiter to protect against DDoS and aggressive scraping
app.use('/api', apiLimiter);

const JWT_SECRET = process.env.JWT_SECRET;

app.use(express.json());

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'eu-central-003',
  ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});
const s3Client = s3;

// Use centralized Mongoose models from server/models/
const File = require('./models/File');
const Folder = require('./models/Folder');
const User = require('./models/User');

const FileModel = File;
const FolderModel = Folder;
const UserModel = User;

// Automatic database recovery and quota reconciliation routine
async function autoRecoverVaultData() {
  try {
    console.log('[CloudGuard Recovery] Reconciling tenant storage quotas...');

    // Recalculate true active storage quotas for all users (ignoring trashed & purged files)
    const users = await User.find({}).select('_id email').lean();
    for (const u of users) {
      const stats = await File.aggregate([
        {
          $match: {
            $or: [
              { userId: u._id },
              { user: u._id },
              { userId: String(u._id) },
              { user: String(u._id) },
            ],
            isTrash: { $ne: true },
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

      const trueBytes = stats[0]?.totalBytes || 0;
      await User.findByIdAndUpdate(u._id, { storageUsed: trueBytes });
    }
    console.log('[CloudGuard Recovery] Storage quotas successfully reconciled.');
  } catch (err) {
    console.error('[CloudGuard Recovery Error]:', err.message);
  }
}

// Scaled Connection Pool for High Concurrency
let isDbConnected = false;
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/cloudguard';
console.log("[DB] MONGO_URI loaded:", !!process.env.MONGO_URI);
mongoose.connect(mongoURI, {
  maxPoolSize: 100,                 // Scales connection pool from 20 to 100 concurrent sockets
  minPoolSize: 10,                  // Keeps 10 warm connections ready for instant execution
  serverSelectionTimeoutMS: 5000,   // Fail-fast timeout (5s) to prevent hanging requests
  socketTimeoutMS: 45000,           // Drops dead sockets after 45s of inactivity
})
  .then(async () => {
    console.log('[CloudGuard] Connected to MongoDB (Pool Size: 100)');
    isDbConnected = true;
    
    // DB Cleanup: Clear pending files from earlier crashes
    try {
      const deleted = await FileModel.deleteMany({ securityStatus: 'Pending' });
      console.log(`Cleaned up ${deleted.deletedCount} pending files from DB.`);
    } catch(err) {
      console.error("Cleanup error:", err.message);
    }

    // Execute automated self-healing vault data recovery
    await autoRecoverVaultData();

    // Synchronize Mongoose indexes with MongoDB to ensure partialFilterExpression is active
    try {
      await Folder.syncIndexes();
      await File.syncIndexes();
      console.log('[CloudGuard] Database indexes synchronized successfully.');
    } catch (indexErr) {
      console.warn('[CloudGuard Index Sync Warning]:', indexErr.message);
    }

    // Run subscription expiry reconciliation immediately upon successful DB connection
    reconcileExpiredSubscriptions();
  })
  .catch(err => {
    console.error("[DB Error]", err);
  });

/**
 * Daily Subscription Expiry, Trial Lifecycle & Hard Cloud Purge Reconciliation Runner
 * 1. Transitions expired trials (14-day window reached) to past_due with 7-day grace period.
 * 2. Evaluates expired paid plans, executes scheduled downgrades with Quota Gate,
 *    and sets 7-day past_due grace periods on over-quota accounts.
 * 3. Day 7 Hard Cloud Purge: Irreversibly purges S3 and MongoDB files for accounts whose
 *    grace period has expired, resetting them to the baseline 5 GB evaluation tier with 0 B overhead.
 */
async function reconcileExpiredSubscriptions() {
  try {
    const now = new Date();
    const { PLAN_CATALOG } = require('./routes/payments');
    const {
      sendSubscriptionEmail,
      generateQuotaGatePassEmail,
      generateQuotaGateBlockedEmail,
      sendAnnual7DayReminderEmail,
      sendPrepaidExpiryWarningEmail,
      send24HourPreExpiryEmail,
      sendGracePeriodStartedEmail,
      send24HourPurgeAlertEmail,
      sendHardPurgeCompletedEmail
    } = require('./utils/emailService');
    const bucketName = process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME || 'cloudguard-vault-storage';

    // -------------------------------------------------------------
    // STEP 1: (T-7 Days — Annual Only)
    // -------------------------------------------------------------
    const t7AnnualUsers = await User.find({
      'subscription.billingCycle': 'annual',
      'subscription.status': { $in: ['active', 'cancelled'] },
      'subscription.expiresAt': {
        $gt: new Date(now.getTime() + 3 * 86400000),
        $lte: new Date(now.getTime() + 7 * 86400000)
      },
      $or: [
        { 'subscription.dunningStep': { $exists: false } },
        { 'subscription.dunningStep': { $lt: 1 } }
      ]
    });

    for (const user of t7AnnualUsers) {
      await sendAnnual7DayReminderEmail(user);
      user.subscription.dunningStep = 1;
      await user.save();
      console.log(`[Subscription Manager] Step 1: Dispatched T-7 annual reminder for ${user.email}`);
    }

    // -------------------------------------------------------------
    // STEP 2: (T-3 Days — Yearly, Monthly & Trial)
    // -------------------------------------------------------------
    const t3Users = await User.find({
      'subscription.status': { $in: ['active', 'cancelled'] },
      $or: [
        {
          $or: [{ plan: 'trial' }, { 'subscription.planId': 'trial' }],
          trialExpiresAt: {
            $gt: new Date(now.getTime() + 24 * 3600 * 1000),
            $lte: new Date(now.getTime() + 3 * 86400000)
          }
        },
        {
          'subscription.planId': { $nin: ['free', 'trial', null] },
          'subscription.expiresAt': {
            $gt: new Date(now.getTime() + 24 * 3600 * 1000),
            $lte: new Date(now.getTime() + 3 * 86400000)
          }
        }
      ],
      $and: [
        {
          $or: [
            { 'subscription.dunningStep': { $exists: false } },
            { 'subscription.dunningStep': { $lt: 2 } }
          ]
        }
      ]
    });

    for (const user of t3Users) {
      await sendPrepaidExpiryWarningEmail(user);
      user.subscription.dunningStep = 2;
      await user.save();
      console.log(`[Subscription Manager] Step 2: Dispatched T-3 expiry warning for ${user.email}`);
    }

    // -------------------------------------------------------------
    // STEP 3: (T-24 Hours Pre-Expiry — Yearly, Monthly & Trial)
    // -------------------------------------------------------------
    const t24hUsers = await User.find({
      'subscription.status': { $in: ['active', 'cancelled'] },
      $or: [
        {
          $or: [{ plan: 'trial' }, { 'subscription.planId': 'trial' }],
          trialExpiresAt: {
            $gt: now,
            $lte: new Date(now.getTime() + 24 * 3600 * 1000)
          }
        },
        {
          'subscription.planId': { $nin: ['free', 'trial', null] },
          'subscription.expiresAt': {
            $gt: now,
            $lte: new Date(now.getTime() + 24 * 3600 * 1000)
          }
        }
      ],
      $and: [
        {
          $or: [
            { 'subscription.dunningStep': { $exists: false } },
            { 'subscription.dunningStep': { $lt: 3 } }
          ]
        }
      ]
    });

    for (const user of t24hUsers) {
      await send24HourPreExpiryEmail(user);
      user.subscription.dunningStep = 3;
      await user.save();
      console.log(`[Subscription Manager] Step 3: Dispatched T-24h pre-expiry warning for ${user.email}`);
    }

    // -------------------------------------------------------------
    // STEP 4: (Day 0 Expiry -> 7-Day Grace Transition)
    // -------------------------------------------------------------
    // 4a. Expired Trials
    const expiredTrials = await User.find({
      $or: [{ plan: 'trial' }, { 'subscription.planId': 'trial' }],
      trialExpiresAt: { $lte: now },
      'subscription.status': { $nin: ['past_due', 'expired'] }
    });

    for (const trialUser of expiredTrials) {
      const graceEnd = new Date(now.getTime() + 7 * 86400000);
      if (!trialUser.subscription) trialUser.subscription = {};
      trialUser.subscription.status = 'past_due';
      trialUser.subscription.gracePeriodExpiresAt = graceEnd;
      trialUser.subscription.dunningStep = 4;
      await trialUser.save();
      console.log(`[Subscription Manager] Step 4: 14-day trial expired for ${trialUser.email}. Set to past_due with 7-day grace.`);
      await sendGracePeriodStartedEmail(trialUser, graceEnd);
    }

    // 4b. Expired Paid Subscriptions (Quota Gate Evaluation)
    const expiredUsers = await User.find({
      'subscription.expiresAt': { $lte: now },
      'subscription.status': { $in: ['active', 'cancelled'] },
      'subscription.planId': { $nin: ['free', 'trial'] }
    });

    if (expiredUsers.length > 0) {
      console.log(`[Subscription Manager] Reconciling ${expiredUsers.length} expired paid subscription(s)...`);
      const FREE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB default

      for (const user of expiredUsers) {
        const scheduled = user.subscription?.scheduledDowngrade;
        const targetPlanId = scheduled?.targetPlanId || 'free';
        const targetCatalog = PLAN_CATALOG[targetPlanId];
        const targetQuotaBytes = targetCatalog ? targetCatalog.storageBytes : FREE_QUOTA_BYTES;
        const targetPlanName = targetCatalog ? targetCatalog.name : 'Free Vault (5 GB)';
        const currentStorageUsed = user.storageUsed || 0;

        // --- THE QUOTA GATE EVALUATION ---
        if (currentStorageUsed <= targetQuotaBytes) {
          // CASE A: Storage fits within target tier quota -> Execute downgrade cleanly (Scenario 5)
          user.plan = targetPlanId;
          user.storageLimit = targetQuotaBytes;
          user.subscription.planId = targetPlanId;
          user.subscription.status = targetPlanId === 'free' ? 'expired' : 'active';
          user.subscription.billingCycle = scheduled?.targetBillingCycle || 'none';
          user.subscription.scheduledDowngrade = { targetPlanId: null, targetBillingCycle: null, scheduledAt: null };
          user.subscription.gracePeriodExpiresAt = null;
          user.subscription.dunningStep = 0;

          await user.save();
          console.log(`[Subscription Manager] Downgrade cleanly executed for ${user.email} -> ${targetPlanName}`);

          const clientUrl = process.env.CLIENT_URL || 'https://cloudguard.site';
          const { subject, html } = generateQuotaGatePassEmail({
            user,
            targetPlanName,
            storageUsedGB: currentStorageUsed / (1024 ** 3),
            targetQuotaGB: targetQuotaBytes / (1024 ** 3),
            clientUrl
          });
          sendSubscriptionEmail({ to: user.email, subject, html }).catch(e => {
            console.error('[Quota Gate Pass Email Error]:', e.message);
          });
        } else {
          // CASE B: Storage EXCEEDS target quota -> Downgrade blocked, activate write-lock + 7-day grace period
          const graceEnd = new Date(now.getTime() + 7 * 86400000);
          user.subscription.status = 'past_due';
          user.subscription.gracePeriodExpiresAt = graceEnd;
          user.subscription.dunningStep = 4;
          await user.save();

          console.warn(`[Subscription Manager] Step 4: Downgrade BLOCKED for ${user.email}. Storage ${currentStorageUsed} exceeds ${targetQuotaBytes}. Past due grace set.`);
          await sendGracePeriodStartedEmail(user, graceEnd);
        }
      }
    }

    // -------------------------------------------------------------
    // STEP 5: (Day 6 of Grace -> 24h Final Purge Alert)
    // -------------------------------------------------------------
    const day6Users = await User.find({
      'subscription.status': 'past_due',
      'subscription.gracePeriodExpiresAt': {
        $gt: now,
        $lte: new Date(now.getTime() + 24 * 3600 * 1000)
      },
      $or: [
        { 'subscription.dunningStep': { $exists: false } },
        { 'subscription.dunningStep': { $lt: 5 } }
      ]
    });

    for (const dUser of day6Users) {
      const baselineQuota = 5 * 1024 * 1024 * 1024;
      const excessGB = Math.max(0, ((dUser.storageUsed || 0) - baselineQuota) / (1024 ** 3));
      const purgeDate = dUser.subscription?.gracePeriodExpiresAt;
      const deleteUrl = `${process.env.CLIENT_URL || 'https://cloudguard.site'}/pricing`;
      await send24HourPurgeAlertEmail(dUser, excessGB, purgeDate, deleteUrl);
      dUser.subscription.dunningStep = 5;
      await dUser.save();
      console.warn(`[Subscription Manager] Step 5: Dispatched 24-hr final purge alert for ${dUser.email}`);
    }

    // -------------------------------------------------------------
    // VERSION-AWARE & PAGINATED DAY 7 B2 PURGE
    // -------------------------------------------------------------
    const delinquentUsers = await User.find({
      'subscription.status': 'past_due',
      'subscription.gracePeriodExpiresAt': { $lte: now }
    });

    if (delinquentUsers.length > 0) {
      console.warn(`[Subscription Manager] Executing Day 7 Hard Cloud Purge on ${delinquentUsers.length} delinquent account(s)...`);

      for (const delinquentUser of delinquentUsers) {
        const uId = delinquentUser._id;
        const prefixes = [`uploads/${uId}/`, `thumbnails/${uId}/`];

        // Batch delete S3/B2 object versions under user prefixes
        for (const prefix of prefixes) {
          try {
            let keyMarker = undefined;
            let versionIdMarker = undefined;
            let isTruncated = true;

            while (isTruncated) {
              const listVersionsCmd = new ListObjectVersionsCommand({
                Bucket: bucketName,
                Prefix: prefix,
                KeyMarker: keyMarker,
                VersionIdMarker: versionIdMarker,
              });
              const verRes = await s3.send(listVersionsCmd);
              const objectsToDelete = [];

              if (Array.isArray(verRes.Versions)) {
                for (const v of verRes.Versions) {
                  if (v.Key) {
                    objectsToDelete.push(v.VersionId ? { Key: v.Key, VersionId: v.VersionId } : { Key: v.Key });
                  }
                }
              }

              if (Array.isArray(verRes.DeleteMarkers)) {
                for (const dm of verRes.DeleteMarkers) {
                  if (dm.Key) {
                    objectsToDelete.push(dm.VersionId ? { Key: dm.Key, VersionId: dm.VersionId } : { Key: dm.Key });
                  }
                }
              }

              // Batch delete in chunks of 1000
              for (let i = 0; i < objectsToDelete.length; i += 1000) {
                const chunk = objectsToDelete.slice(i, i + 1000);
                if (chunk.length > 0) {
                  await s3.send(new DeleteObjectsCommand({
                    Bucket: bucketName,
                    Delete: { Objects: chunk, Quiet: true },
                  }));
                }
              }

              isTruncated = !!verRes.IsTruncated;
              if (isTruncated) {
                keyMarker = verRes.NextKeyMarker;
                versionIdMarker = verRes.NextVersionIdMarker;
              }
            }
          } catch (s3PurgeErr) {
            console.error(`[Subscription Manager B2 Purge Error] for ${delinquentUser.email} (prefix: ${prefix}):`, s3PurgeErr.message);
          }
        }

        // Delete MongoDB File and Folder records
        await File.deleteMany({ $or: [{ userId: uId }, { userId: String(uId) }, { user: uId }] });
        await Folder.deleteMany({ $or: [{ userId: uId }, { userId: String(uId) }, { user: uId }] });

        // Reset User document state to baseline ₹0 storage
        delinquentUser.plan = 'free';
        delinquentUser.storageLimit = 5 * 1024 * 1024 * 1024; // 5 GB baseline
        delinquentUser.storageUsed = 0;
        if (!delinquentUser.subscription) delinquentUser.subscription = {};
        delinquentUser.subscription.planId = 'free';
        delinquentUser.subscription.status = 'expired';
        delinquentUser.subscription.gracePeriodExpiresAt = null;
        delinquentUser.subscription.dunningStep = 0;
        delinquentUser.subscription.scheduledDowngrade = { targetPlanId: null, targetBillingCycle: null, scheduledAt: null };

        await delinquentUser.save();
        console.log(`[Subscription Manager] Successfully purged vault for ${delinquentUser.email} to 0 B storage used.`);

        // Final transactional notification email (Scenario 9)
        const clientUrl = process.env.CLIENT_URL || 'https://cloudguard.site';
        await sendHardPurgeCompletedEmail(delinquentUser, clientUrl).catch(e => {
          console.error('[Hard Purge Notice Error]:', e.message);
        });
      }
    }
  } catch (err) {
    console.error('[Subscription Manager Error]:', err.message);
  }
}

// Check every 6 hours
setInterval(reconcileExpiredSubscriptions, 6 * 60 * 60 * 1000);

/**
 * Automated Abandoned Upload Reaper
 * Purges orphaned S3 objects and MongoDB records for uploads that were
 * initiated (pending_scan) but never finalized due to network drops or tab closures.
 */
async function sweepAbandonedUploads() {
  try {
    const File = mongoose.models.File || require('./models/File') || require('./models/User').db.model('File');
    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;

    // Buffer window: 2 hours to protect in-flight active uploads
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    // Find upload tickets stuck in pending_scan older than 2 hours
    const abandonedFiles = await File.find({
      securityStatus: 'pending_scan',
      createdAt: { $lte: twoHoursAgo }
    }).select('_id s3Key thumbnailKey name').lean();

    if (!abandonedFiles || abandonedFiles.length === 0) return;

    console.log(`[Upload Reaper] Detected ${abandonedFiles.length} abandoned upload ticket(s) older than 2 hours. Purging...`);

    // 1. Collect S3 keys to purge
    const s3KeysToDelete = [];
    abandonedFiles.forEach((file) => {
      if (file.s3Key) s3KeysToDelete.push(file.s3Key);
      if (file.thumbnailKey) s3KeysToDelete.push(file.thumbnailKey);
    });

    // 2. Batch-delete objects from S3
    if (s3KeysToDelete.length > 0 && typeof s3Client !== 'undefined') {
      await permanentlyDeleteS3Keys(s3Client, bucket, s3KeysToDelete).catch((err) => console.error('[Upload Reaper] S3 batch delete warning:', err.message));
    }

    // 3. Delete orphaned metadata tickets from MongoDB
    const fileIds = abandonedFiles.map((f) => f._id);
    const dbResult = await File.deleteMany({ _id: { $in: fileIds } });

    console.log(`[Upload Reaper] Successfully purged ${s3KeysToDelete.length} S3 object(s) and ${dbResult.deletedCount} orphaned DB ticket(s).`);
  } catch (err) {
    console.warn('[Upload Reaper Error]:', err.message);
  }
}

// Run initial sweep 1 minute after server boot, then recur every 6 hours
setTimeout(sweepAbandonedUploads, 60 * 1000);
setInterval(sweepAbandonedUploads, 6 * 60 * 60 * 1000);



async function recalculateStorage(userId) {
    try {
    const result = await FileModel.aggregate([
      { $match: { $or: [{ userId: userId }, { userId: String(userId) }, { user: userId }], isTrash: false, securityStatus: { $ne: 'threat_purged' } } },
      { $group: { _id: null, totalSize: { $sum: "$size" } } }
    ]);
    const totalSize = result.length > 0 ? result[0].totalSize : 0;
    await User.findByIdAndUpdate(userId, { storageUsed: totalSize });
    return totalSize;
  } catch (err) {
    console.error('Error recalculating storage:', err);
  }
}

const GLOBAL_MAX_BYTES = 107374182400; // 100GB limit calculated to stay within the AWS $100 credit budget for 6 months

// In-memory JWT and User Session Cache (60s TTL) and in-flight lookup coalescing
const verifiedJwtCache = new Map();
const userAuthCache = new Map();
const inflightUserLookups = new Map();

// Auth Middleware
const verifyToken = async (req, res, next) => {
  req._startTime = performance.now();
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Access denied. Please log in.' });
  try {
    let verified = verifiedJwtCache.get(token);
    if (!verified || verified._cacheExpires < Date.now()) {
      verified = jwt.verify(token, JWT_SECRET);
      verified._cacheExpires = Date.now() + 60000;
      verifiedJwtCache.set(token, verified);
    }

    const userIdStr = String(verified._id);
    
    // Check if user still exists in database (cached in-memory for 60s with single-flight coalescing)
    const cached = userAuthCache.get(userIdStr);
    let user;
    if (cached && cached.expiresAt > Date.now()) {
      user = cached.user;
    } else {
      let lookupPromise = inflightUserLookups.get(userIdStr);
      if (!lookupPromise) {
        lookupPromise = User.findById(verified._id).lean().finally(() => {
          inflightUserLookups.delete(userIdStr);
        });
        inflightUserLookups.set(userIdStr, lookupPromise);
      }
      user = await lookupPromise;
      if (user) {
        userAuthCache.set(userIdStr, { user, expiresAt: Date.now() + 60000 });
      }
    }

    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });

    req.user = verified;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

// Health Check Route
app.get('/', (req, res) => {
  res.status(200).json({ status: 'active', message: 'CloudGuard Backend is running' });
});

// Server Memory / Metrics Route for Performance Auditing & Concurrency Benchmarks
app.get('/api/internal/memory', (req, res) => {
  const memory = process.memoryUsage();
  res.json({
    heapUsed: memory.heapUsed,
    heapTotal: memory.heapTotal,
    rss: memory.rss,
    external: memory.external,
    heapUsedMB: (memory.heapUsed / 1024 / 1024).toFixed(2),
    heapTotalMB: (memory.heapTotal / 1024 / 1024).toFixed(2),
    rssMB: (memory.rss / 1024 / 1024).toFixed(2)
  });
});

// Auth Routes
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const usersFilePath = path.join(dataDir, 'users.json');
if (!fs.existsSync(usersFilePath)) {
  fs.writeFileSync(usersFilePath, JSON.stringify([]));
}

async function getGlobalStorageUsed() {
    const result = await FileModel.aggregate([
    { $match: { securityStatus: { $in: ['Safe', 'unscanned_too_large'] } } },
    { $group: { _id: null, totalSize: { $sum: "$size" } } }
  ]);
  return result.length > 0 ? result[0].totalSize : 0;
  return 0;
}

// Auth & Files Modular Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/files', require('./routes/files'));
app.use('/api/folders', require('./routes/folders'));
app.use('/api/photos', require('./routes/photos'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api', require('./routes/photos'));

app.post('/api/auth/register', async (req, res) => {
  try {
    const globalUsed = await getGlobalStorageUsed();
    if (globalUsed > GLOBAL_MAX_BYTES) {
      return res.status(503).json({ error: "Registration disabled: CloudGuard global server capacity has been reached." });
    }

    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least 1 letter and 1 number' });
    }
    
    let existingUser = null;
    let users = [];
    let userIndex = -1;
    
        existingUser = await User.findOne({ email });
  
    
    if (existingUser) {
      if (!existingUser.password) {
        return res.status(409).json({
          error: 'An account with this email already exists via Google. Please use "Sign in with Google" to access your vault.',
        });
      }
      if (existingUser.isVerified !== false) {
        return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
      }
    }
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpire = new Date(Date.now() + 10 * 60000); // 10 minutes

        if (existingUser) {
      existingUser.name = name;
      existingUser.password = hashedPassword;
      existingUser.otpHash = otpHash;
      existingUser.otpExpire = otpExpire;
      existingUser.otpAttempts = 0;
      await existingUser.save();
    } else {
      const user = new User({ 
        name, 
        email, 
        password: hashedPassword, 
        isVerified: false,
        otpHash,
        otpExpire
      });
      await user.save();
    }
  

    sendActivationOtp(email, otp);
    
    res.json({ message: 'User created. Please verify your email.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp, type } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Missing email or OTP' });

    let user = null;
    let userIndex = -1;
    let users = [];
    
        user = await User.findOne({ email });
  

    if (!user) return res.status(400).json({ error: 'User not found' });
    
    if (type === 'reset') {
      if (!user.resetPasswordToken || user.resetPasswordToken !== otp) {
        return res.status(400).json({ error: 'Invalid reset code' });
      }
      if (!user.resetPasswordExpire || new Date(user.resetPasswordExpire) < new Date()) {
        return res.status(400).json({ error: 'Reset code expired' });
      }
      return res.status(200).json({ success: true, message: 'Reset code valid' });
    }

    if (user.isVerified) return res.status(400).json({ error: 'User already verified' });
    
    if (user.otpAttempts >= 3) {
      return res.status(400).json({ error: 'Too many failed attempts. Please request a new OTP.' });
    }

    if (!user.otpExpire || new Date(user.otpExpire) < new Date()) {
      return res.status(400).json({ error: 'OTP has expired' });
    }

    const isMatch = await bcrypt.compare(otp, user.otpHash);
    if (!isMatch) {
      const attempts = (user.otpAttempts || 0) + 1;
            user.otpAttempts = attempts;
      await user.save();
    
      return res.status(400).json({ error: 'Invalid OTP' });
    }

        user.isVerified = true;
    user.otpHash = undefined;
    user.otpExpire = undefined;
    user.otpAttempts = 0;
    await user.save();
  

    const secret = process.env.JWT_SECRET || 'development_fallback_secret_123';
    const token = jwt.sign({ _id: user._id, name: user.name, isAdmin: user.isAdmin || false }, secret, { expiresIn: '7d' });
    return res.status(200).json({ message: 'Email verified successfully!', token, user: { name: user.name, email: user.email, isAdmin: user.isAdmin || false } });
  } catch (error) {
    console.error("OTP Verification Crash:", error);
    return res.status(500).json({ message: "Server error during verification.", error: error.message });
  }
});

app.post('/api/auth/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    let user = null;
    let userIndex = -1;
    let users = [];
    
        user = await User.findOne({ email });
  

    if (!user) return res.status(400).json({ error: 'User not found' });
    if (user.isVerified) return res.status(400).json({ error: 'User is already verified' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpire = new Date(Date.now() + 10 * 60000); // 10 minutes

        user.otpHash = otpHash;
    user.otpExpire = otpExpire;
    user.otpAttempts = 0;
    await user.save();
  

    sendActivationOtp(email, otp);

    res.json({ message: 'A new verification code has been sent to your email.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    let user = null;
    
        user = await User.findOne({ email });
  
    
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    if (!user.password) {
      return res.status(400).json({
        error: 'This account was registered using Google. Please click "Sign in with Google", or use "Forgot Password" to create a password.',
        isOAuthUser: true,
      });
    }
    if (user.isVerified === false) {
      return res.status(403).json({ error: 'Please verify your email before logging in.', unverified: true });
    }
    
    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(400).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ _id: user._id, name: user.name, isAdmin: user.isAdmin || false }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { name: user.name, email: user.email, isAdmin: user.isAdmin || false } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forgot Password Route
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email, frontendUrl } = req.body;
    console.log('\n>>> FORGOT PASSWORD ROUTE HIT FOR:', email);
    let user = null;
    
        user = await User.findOne({ email });
  
    
    if (!user) {
      return res.status(404).json({ message: "No account found with this email" });
    }

    // Create reset OTP
    const resetOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes

    try {
            user.resetPasswordToken = resetOtp;
      user.resetPasswordExpire = resetPasswordExpire;
      await user.save();
    
    } catch (saveError) {
      console.warn("MongoDB save failed, falling back to users.json:", saveError.message);
      const users = JSON.parse(fs.readFileSync(usersFilePath));
      const userIndex = users.findIndex(u => u.email === email);
      if (userIndex !== -1) {
        users[userIndex].resetPasswordToken = resetOtp;
        users[userIndex].resetPasswordExpire = resetPasswordExpire;
        fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
      }
    }
    
    sendResetOtp(email, resetOtp);

    return res.status(200).json({ message: "Reset code sent" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
});

// Reset Password Route
app.put('/api/auth/reset-password/:token', async (req, res) => {
  try {
    let user = null;
    let userIndex = -1;
    let users = [];

        user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpire: { $gt: Date.now() }
    });
  

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Please provide a new password' });
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least 1 letter and 1 number' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

        user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();
  

    res.json({ message: 'Password has been reset successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/auth/password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'New password is required' });

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long and contain at least 1 letter and 1 number' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.password) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required' });
      }
      const validPass = await bcrypt.compare(currentPassword, user.password);
      if (!validPass) return res.status(400).json({ error: 'Invalid current password' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    await user.save();

    res.json({ message: 'Password updated successfully', hasPassword: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/auth/account', verifyToken, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: User identifier missing.' });
    }
    const userMatch = mongoose.Types.ObjectId.isValid(userId)
      ? { $in: [String(userId), new mongoose.Types.ObjectId(userId)] }
      : String(userId);

    // 1. Delete physical files from S3
    try {
      const listedObjects = await s3.send(new ListObjectsV2Command({ 
          Bucket: process.env.AWS_BUCKET_NAME, 
          Prefix: `${userId}/` 
      }));
      if (listedObjects.Contents && listedObjects.Contents.length > 0) {
          await permanentlyDeleteS3Keys(
              s3,
              process.env.AWS_BUCKET_NAME,
              listedObjects.Contents.map(obj => obj.Key)
          );
      }
    } catch (e) {
      console.error("Failed to delete from S3 during account removal", e.message);
    }

    // 2. Delete user and files from DB / JSON
        await FileModel.deleteMany({ userId: userId });
    await User.findByIdAndDelete(userId);
  

    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Universal Storage Stats Endpoint (mount on both /api/storage-stats and /api/users/storage-stats)
const getStorageStatsInServer = async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id;
    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    const userMatch = {
      $or: [
        { userId: userIdObj },
        { user: userIdObj },
        { userId: String(rawUserId) },
        { user: String(rawUserId) },
      ],
    };

    // Calculate real active storage
    const stats = await File.aggregate([
      {
        $match: {
          isTrash: { $ne: true },
          securityStatus: { $ne: 'threat_purged' },
          ...userMatch,
        },
      },
      {
        $group: {
          _id: null,
          actualUsedBytes: { $sum: { $ifNull: ['$size', 0] } },
        },
      },
    ]);

    const actualStorageUsed = stats[0]?.actualUsedBytes || 0;

    // Synchronize user record in background
    await User.findByIdAndUpdate(rawUserId, { storageUsed: actualStorageUsed });

    const user = await User.findById(rawUserId).select('storageLimit').lean();
    const storageLimit = user?.storageLimit || 5368709120; // 5 GB

    return res.status(200).json({
      storageUsed: actualStorageUsed,
      used: actualStorageUsed,
      usedBytes: actualStorageUsed,
      storageLimit,
      limit: storageLimit,
      totalLimitBytes: storageLimit,
      percentage: Math.min(100, (actualStorageUsed / storageLimit) * 100).toFixed(1),
      usedPercentage: Math.min(100, (actualStorageUsed / storageLimit) * 100).toFixed(1),
      success: true,
    });
  } catch (err) {
    console.error('Storage stats error:', err);
    return res.status(500).json({ error: 'Failed to retrieve storage stats' });
  }
};

app.get(['/api/storage-stats', '/api/users/storage-stats'], verifyToken, getStorageStatsInServer);

// Upload Endpoint
// Upload Endpoint
// Presign Endpoint
app.post('/api/presign', verifyToken, async (req, res) => {
  try {
    const { filename, contentType, folderId } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const userId = req.user?._id || req.user?.id || req.userId || 'anonymous';
    const fileKey = `uploads/${userId}/${Date.now()}-${filename}`;
    
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileKey,
      ContentType: contentType || 'application/octet-stream',
      ServerSideEncryption: 'AES256'
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 60 });
    
    const fileData = {
      userId: userId,
      folderId: folderId || null,
      name: filename,
      originalName: filename,
      s3Key: fileKey,
      mimetype: contentType || 'application/octet-stream',
      status: 'uploading',
      securityStatus: 'UPLOADING'
    };
    const newFile = new FileModel(fileData);
    await newFile.save();

    res.json({ signedUrl, fileKey, fileId: newFile._id });
  } catch (error) {
    console.error('AWS Presign Error:', error);
    res.status(500).json({ error: 'Failed to generate pre-signed URL' });
  }
});

// Upload Endpoint
app.post('/api/upload', verifyToken, async (req, res) => {
  const { fileKey, originalName, fileSize, folderId } = req.body;
  if (!fileKey || !originalName) return res.status(400).json({ error: "No file data provided" });

  const filesToProcess = [{ key: fileKey, originalname: originalName, size: fileSize || 0 }];
  console.log('[Upload Hit] File data for direct upload:', originalName);

  const userId = req.user._id;
  const incomingSize = filesToProcess.reduce((sum, f) => sum + f.size, 0);

  // Global Quota Check
  // const globalUsed = await getGlobalStorageUsed();
  // if (globalUsed > GLOBAL_MAX_BYTES) {
  //   for (const f of filesToProcess) {
  //     if (f.key) await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME, Key: f.key }));
  //   }
  //   return res.status(503).json({ error: "Upload failed: The server has reached its maximum global capacity limit." });
  // }

  // Check User Quota
  let currentStorageUsed = 0;
    const result = await FileModel.aggregate([
    { $match: { userId: userId, securityStatus: { $in: ['Safe', 'unscanned_too_large'] } } },
    { $group: { _id: null, totalSize: { $sum: "$size" } } }
  ]);
  if (result.length > 0) {
    currentStorageUsed = result[0].totalSize;
  }

  if (currentStorageUsed + incomingSize > 5368709120) {
    for (const f of filesToProcess) {
      if (f.key) await permanentlyDeleteS3Keys(s3, process.env.AWS_BUCKET_NAME, f.key);
    }
    return res.status(400).json({ error: "Upload Failed: Insufficient storage space. This file exceeds your 5 GB account limit." });
  }

  const uploadedFiles = [];
  const blockedFiles = [];

  for (let i = 0; i < filesToProcess.length; i++) {
    const targetFile = filesToProcess[i];
    const originalName = targetFile.originalname;
    
    let fileRecord = null;
    try {
      let scanResult = 'Unknown';
      let securityStatus = 'Pending';
      let isMalware = false;

      fileRecord = await FileModel.findOne({ s3Key: targetFile.key, userId: req.user._id, securityStatus: 'UPLOADING' });
      if (!fileRecord) {
        console.error('[Upload Error] Invalid or unauthorized file record for:', targetFile.key);
        if (targetFile.key) {
          try {
            await permanentlyDeleteS3Keys(s3, process.env.AWS_BUCKET_NAME, targetFile.key);
          } catch (e) {
            console.error('[Upload Error] S3 Cleanup Failed for orphaned object:', targetFile.key, 'Error:', e.message);
          }
        }
        return res.status(404).json({ error: "File record not found or already processed" });
      }
      
      if (folderId !== undefined) {
        fileRecord.folderId = folderId || null;
      }

      // 1. Calculate file metadata
      let relativePath = '';
      if (req.body.relativePaths) {
        relativePath = Array.isArray(req.body.relativePaths) ? req.body.relativePaths[i] : req.body.relativePaths;
      }
      let nestedRelativePath = targetFile.originalname;
      if (relativePath) {
        const relativeDir = path.dirname(relativePath);
        if (relativeDir && relativeDir !== '.') {
          nestedRelativePath = path.posix.join(relativeDir.split(path.sep).join('/'), targetFile.originalname);
        }
      }

      let exactFileSize = targetFile.size;
      if (!exactFileSize) {
          try {
              const headData = await s3.send(new HeadObjectCommand({
                  Bucket: process.env.AWS_BUCKET_NAME,
                  Key: targetFile.key || targetFile.s3Key
              }));
              exactFileSize = headData.ContentLength;
          } catch (err) {
              console.error("[S3 Size Check Error]:", err);
              exactFileSize = 0;
          }
      }

      // 1.5 Whitelist Hash Bypass
      let calculatedHash = (req.body.fileHash || '').toLowerCase().trim();
      if (!calculatedHash && targetFile.key) {
        try {
          const hashStream = await s3.send(new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: targetFile.key || targetFile.s3Key
          }));
          const hasher = crypto.createHash('sha256');
          for await (const chunk of hashStream.Body) {
            hasher.update(chunk);
          }
          calculatedHash = hasher.digest('hex').toLowerCase().trim();
        } catch (hashErr) {
          console.error('[Hash Computation Error]:', hashErr.message);
        }
      }

      if (calculatedHash && WHITELISTED_HASHES.includes(calculatedHash)) {
        console.log(`[WHITELIST BYPASS] Hash ${calculatedHash} matched. Skipping AI model and VirusTotal.`);
        fileRecord.diskName = nestedRelativePath;
        fileRecord.relativePath = relativePath;
        fileRecord.size = exactFileSize;
        fileRecord.status = 'safe';
        fileRecord.securityStatus = 'Safe';
        await fileRecord.save();
        uploadedFiles.push(fileRecord);
        continue;
      }

      // 2. Magic Byte Verification
      let isMZ = false;
      try {
        const getObjectParams = {
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: targetFile.key || targetFile.s3Key,
          Range: 'bytes=0-1'
        };
        const magicBytesResponse = await s3.send(new GetObjectCommand(getObjectParams));
        const chunks = [];
        for await (const chunk of magicBytesResponse.Body) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        if (buffer.length >= 2 && buffer[0] === 0x4D && buffer[1] === 0x5A) {
          isMZ = true;
        }
      } catch (mbErr) {
        console.error('[Magic Byte Check Error]:', mbErr.message);
      }

      const ext = path.extname(targetFile.originalname).toLowerCase();
      const execExtensions = ['.exe', '.dll', '.sys', '.scr'];
      const isExecExt = execExtensions.includes(ext);

      if (isMZ && !isExecExt) {
        console.error('[Spoofing Detected] File has MZ magic bytes but non-executable extension:', targetFile.originalname);
        if (targetFile.key) {
          try { await permanentlyDeleteS3Keys(s3, process.env.AWS_BUCKET_NAME, targetFile.key); } catch (e) {}
        }
        fileRecord.isMalicious = true;
        fileRecord.securityStatus = 'threat_purged';
        fileRecord.status = 'malicious';
        fileRecord.size = 0;
        await fileRecord.save();
        return res.status(200).json({ success: true, isMalicious: true, message: 'Security threat intercepted. File was automatically deleted.', file: fileRecord });
      }

      // 3. The 512MB Hard Cap & Safe Bypass
      if (exactFileSize > 512 * 1024 * 1024 && !isMZ) {
        console.log('[Bypass] Skipping ML scan for massive non-executable file:', targetFile.originalname);
        fileRecord.diskName = nestedRelativePath;
        fileRecord.relativePath = relativePath;
        fileRecord.size = exactFileSize;
        fileRecord.status = 'safe';
        fileRecord.securityStatus = 'unscanned_too_large';
        await fileRecord.save();
        uploadedFiles.push(fileRecord);
        continue;
      }

      // 4. Continue to AI Scanner if no bypass
      fileRecord.securityStatus = 'SCANNING';
      await fileRecord.save();

      console.log('[Routing] Processing through AI Microservice: ' + targetFile.originalname);
        const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
        try {
          const aiResponse = await axios.post(`${aiServiceUrl}/scan`, {
              fileKey: targetFile.key,
              filename: targetFile.originalname
          }, {
              timeout: 120000 // Increased to 2 minutes for processing large files
          });
          
          scanResult = aiResponse.data.status;

          if (scanResult === 'rate_limited' || scanResult === 'unverified_rate_limited') {
             console.warn('AI Scanner notice (handled - rate limited):', scanResult);
             fileRecord.diskName = nestedRelativePath;
             fileRecord.relativePath = relativePath;
             fileRecord.size = exactFileSize;
             fileRecord.status = 'safe';
             fileRecord.securityStatus = 'Safe';
             await fileRecord.save();
             uploadedFiles.push(fileRecord);
          }

          if (scanResult === 'malicious') {
             if (targetFile.key) {
               try { await permanentlyDeleteS3Keys(s3, process.env.AWS_BUCKET_NAME, targetFile.key); } catch (e) { console.error('[Upload Error] S3 Cleanup Failed for malicious object:', targetFile.key, 'Error:', e.message); }
             }
             fileRecord.isMalicious = true;
             fileRecord.securityStatus = 'threat_purged';
             fileRecord.status = 'malicious';
             fileRecord.size = 0;
             await fileRecord.save();
             return res.status(200).json({ success: true, isMalicious: true, message: 'Security threat intercepted. File was automatically deleted.', file: fileRecord });
          }

          if (scanResult !== 'safe') {
             throw new Error(`AI Service returned unexpected status: ${scanResult}`);
          }
          
          fileRecord.diskName = nestedRelativePath;
          fileRecord.relativePath = relativePath;
          fileRecord.size = exactFileSize;
          fileRecord.status = 'safe';
          fileRecord.securityStatus = 'Safe';
          await fileRecord.save();
          uploadedFiles.push(fileRecord);
          
        } catch (scanErr) {
          console.warn('[AI Connection Notice (handled)]:', scanErr.message);
          fileRecord.diskName = nestedRelativePath;
          fileRecord.relativePath = relativePath;
          fileRecord.size = exactFileSize;
          fileRecord.status = 'safe';
          fileRecord.securityStatus = 'Safe';
          await fileRecord.save();
          uploadedFiles.push(fileRecord);
        }

    } catch (error) {
      console.error('File processing error:', error);
      if (targetFile.key) {
        try {
          await permanentlyDeleteS3Keys(s3, process.env.AWS_BUCKET_NAME, targetFile.key);
        } catch (e) {
          console.error('[Upload Error] S3 Cleanup Failed during file processing error:', targetFile.key, 'Error:', e.message);
        }
      }
      if (fileRecord && fileRecord._id) {
        await FileModel.deleteOne({ _id: fileRecord._id });
      }
      return res.status(500).json({ error: "Upload failed: Security scan error" });
    }
  }
  
  const exactStorageUsed = await recalculateStorage(userId);
  invalidatePhotosCache(userId);

  // Attach signed S3 URLs to media files so frontend preview renders immediately
  const formattedUploadedFiles = await Promise.all(uploadedFiles.map(async (doc) => {
    const fileObj = doc.toObject ? doc.toObject() : { ...doc };
    const ext = (fileObj.originalName || fileObj.name || '').split('.').pop().toLowerCase();
    const isMedia = (fileObj.mimetype || fileObj.mimeType || '').startsWith('image/') ||
                    (fileObj.mimetype || fileObj.mimeType || '').startsWith('video/') ||
                    ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'mp4', 'webm', 'mov', 'mkv'].includes(ext);
    if (isMedia) {
      let targetKey = fileObj.s3Key;
      if (!targetKey && fileObj.location) {
        try {
          const urlObj = new URL(fileObj.location);
          targetKey = decodeURIComponent(urlObj.pathname.substring(1).replace(/\+/g, '%20'));
        } catch (e) {}
      }
      if (targetKey && process.env.AWS_BUCKET_NAME) {
        try {
          const command = new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: targetKey
          });
          const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
          fileObj.s3Url = signedUrl;
          fileObj.url = signedUrl;
        } catch (err) {
          console.error('Error signing URL for uploaded media asset:', err.message);
        }
      }
    }
    return fileObj;
  }));

  return res.status(formattedUploadedFiles.length > 0 ? 200 : 403).json({
    status: formattedUploadedFiles.length > 0 ? 'success' : 'blocked',
    uploadedFiles: formattedUploadedFiles,
    blockedFiles,
    message: formattedUploadedFiles.length > 0 ? 'Upload processed' : 'All files blocked',
    storageUsed: exactStorageUsed
  });
});



// View Endpoint (Inline)
app.get('/api/view/:filename(*)', verifyToken, async (req, res) => {
  const filename = req.params.filename;
  try {
    const fileRecord = await FileModel.findOne({ userId: req.user._id, diskName: filename, securityStatus: { $in: ['Safe', 'unscanned_too_large'] } });
    if (!fileRecord || !fileRecord.s3Key) return res.status(404).json({ error: 'File not found' });
    
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileRecord.s3Key,
    });
    
    const response = await s3.send(command);
    res.setHeader('Content-Type', response.ContentType);
    res.setHeader('Content-Disposition', 'inline');
    response.Body.pipe(res);
  } catch (error) {
    console.error('S3 View Error:', error);
    res.status(500).json({ error: 'Failed to fetch file' });
  }
});

// Download Endpoint (Attachment)
app.get('/api/download/:filename(*)', verifyToken, async (req, res) => {
  const filename = req.params.filename;
  try {
    const fileRecord = await FileModel.findOne({ userId: req.user._id, diskName: filename, securityStatus: { $in: ['Safe', 'unscanned_too_large'] } });
    if (!fileRecord || !fileRecord.s3Key) return res.status(404).json({ error: 'File not found' });
    
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileRecord.s3Key,
    });
    
    const response = await s3.send(command);
    res.setHeader('Content-Type', response.ContentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileRecord.originalName}"`);
    response.Body.pipe(res);
  } catch (error) {
    console.error('S3 Download Error:', error);
    res.status(500).json({ error: 'Failed to fetch file' });
  }
});

// List Files Endpoint
// Sync DB with S3
app.get('/api/files/sync', verifyToken, async (req, res) => {
  try {
    const files = await FileModel.find({ userId: req.user._id });
    const removedIds = [];

    for (const file of files) {
      const keyToCheck = file.s3Key || (file.location ? new URL(file.location).pathname.slice(1) : null);
      if (keyToCheck) {
        try {
          await s3.send(new HeadObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: keyToCheck
          }));
        } catch (s3Err) {
          if (s3Err.name === 'NotFound' || s3Err.$metadata?.httpStatusCode === 404) {
            console.log(`[Sync] S3 object missing for DB file ${file._id}, deleting from DB...`);
            await FileModel.deleteOne({ _id: file._id });
            removedIds.push(file._id);
          }
        }
      }
    }

    if (removedIds.length > 0) {
      await recalculateStorage(req.user._id);
    }

    return res.status(200).json({
      message: "Sync complete",
      removedMissingFiles: removedIds.length,
      removedIds
    });
  } catch (err) {
    console.error('[Sync Error]:', err);
    return res.status(500).json({ error: "Failed to sync files" });
  }
});

// --- NEW FOLDER ROUTES ---
app.post('/api/folders', verifyToken, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    const { name, parentId } = req.body;
    const trimmedName = (name || '').trim();
    if (!trimmedName) return res.status(400).json({ error: 'Folder name is required' });

    // Check if an active (non-trashed) folder with the same name already exists in this folder
    const duplicateQuery = buildTenantQuery(rawUserId, {
      parentId: parentId || null,
      name: trimmedName,
      isTrash: { $ne: true },
    });

    const existing = await FolderModel.findOne(duplicateQuery);

    if (existing) {
      return res.status(409).json({ error: 'A folder with this name already exists here' });
    }
    
    const newFolder = new FolderModel({
      name: trimmedName,
      userId: req.user._id,
      parentId: parentId || null,
      isTrash: false,
    });
    await newFolder.save();
    return res.status(201).json(newFolder);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A folder with this name already exists here' });
    }
    console.error('Error creating folder:', err);
    return res.status(500).json({ error: 'Failed to create folder' });
  }
});

app.get('/api/folders', verifyToken, async (req, res) => {
  try {
    let query = { userId: req.user._id };
    if (req.query.all !== 'true') {
      query.parentId = req.query.parentId || null;
    }
    const folders = await FolderModel.find(query).select('_id name parentId parentFolder userId createdAt updatedAt isTrash').sort({ createdAt: -1 }).lean();
    return res.json(folders);
  } catch (err) {
    console.error('Error fetching folders:', err);
    return res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

app.get('/api/folders/:id', verifyToken, async (req, res) => {
  try {
    const folderId = req.params.id;
    const folder = await FolderModel.findOne({ _id: folderId, userId: req.user._id });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    return res.json(folder);
  } catch (err) {
    console.error('Error fetching single folder:', err);
    return res.status(500).json({ error: 'Failed to fetch folder' });
  }
});

const handleFolderRename = async (req, res) => {
  try {
    const { newName, name, parentId, targetFolderId } = req.body;
    const trimmedName = (newName || name || '').trim();

    // If no name is provided, but destination is provided, execute move instead of throwing error
    if (!trimmedName && (parentId !== undefined || targetFolderId !== undefined)) {
      const dest = parentId !== undefined ? parentId : targetFolderId;
      const targetParentId = dest === 'null' || dest === 'root' || !dest ? null : dest;
      if (req.params.id === targetParentId) {
        return res.status(400).json({ error: 'Cannot move a folder into itself' });
      }
      const folder = await FolderModel.findOne({ _id: req.params.id, userId: req.user._id });
      if (!folder) return res.status(404).json({ error: 'Folder not found' });
      folder.parentId = targetParentId;
      await folder.save();
      return res.json({ success: true, folder });
    }

    if (!trimmedName) {
      return res.status(400).json({ error: 'Folder name cannot be empty' });
    }

    const folderId = req.params.id;
    const folder = await FolderModel.findOne({ _id: folderId, userId: req.user._id });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // If the name hasn't changed, return early
    if (folder.name === trimmedName) {
      return res.json(folder);
    }

    // Check for any OTHER folder in the SAME parent directory with the same name
    const existingDuplicate = await FolderModel.findOne({
      _id: { $ne: folderId },
      parentId: folder.parentId || null,
      name: trimmedName,
      userId: req.user._id,
    });

    if (existingDuplicate) {
      return res.status(409).json({
        error: `A folder named "${trimmedName}" already exists in this directory.`,
      });
    }

    folder.name = trimmedName;
    await folder.save();

    return res.json(folder);
  } catch (err) {
    console.error('Rename folder error:', err);
    return res.status(500).json({ error: 'Server error while renaming folder' });
  }
};

app.patch('/api/folders/:id/rename', verifyToken, handleFolderRename);
app.put('/api/folders/:id/rename', verifyToken, handleFolderRename);
app.patch('/api/folders/:id', verifyToken, handleFolderRename);
app.put('/api/folders/:id', verifyToken, handleFolderRename);

// Recursive helper to collect all descendant folder IDs
const getFolderDescendantIds = (parentFolderId, folderList) => {
  const ids = [];
  const visited = new Set();
  const rootIdStr = parentFolderId ? parentFolderId.toString() : '';
  if (!rootIdStr) return ids;

  visited.add(rootIdStr);
  const queue = [rootIdStr];

  while (queue.length > 0) {
    const currentParentId = queue.shift();
    const children = folderList.filter(
      f => f.parentId && f.parentId.toString() === currentParentId
    );
    for (const child of children) {
      const childIdStr = child._id.toString();
      if (!visited.has(childIdStr)) {
        visited.add(childIdStr);
        ids.push(child._id);
        queue.push(childIdStr);
      }
    }
  }
  return ids;
};

// Recursive Folder Details & Stats Handler
const handleFolderDetailsOrStats = async (req, res) => {
  try {
    const targetFolderId = req.params.id || req.params.folderId;
    if (!targetFolderId || !mongoose.Types.ObjectId.isValid(targetFolderId)) {
      return res.status(400).json({ success: false, message: 'Invalid folder ID' });
    }
    const targetObjectId = new mongoose.Types.ObjectId(targetFolderId);

    const folder = await FolderModel.findOne({
      _id: targetObjectId,
      $or: [
        { userId: req.user._id },
        { userId: req.user._id.toString() },
        { user: req.user._id }
      ]
    });
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });

    // 1. Fetch all user folders to build descendant tree, excluding trash/deleted
    const allUserFolders = await FolderModel.find({
      $or: [
        { userId: req.user._id },
        { userId: req.user._id.toString() },
        { user: req.user._id }
      ],
      isTrash: { $ne: true },
      isDeleted: { $ne: true }
    }).lean();

    const getDescendants = (parentId, list) => {
      let children = list.filter(f => {
        const pId = f.parentId || f.parentFolderId;
        return pId && pId.toString() === parentId.toString();
      });
      let ids = [];
      for (const child of children) {
        ids.push(child._id);
        ids = ids.concat(getDescendants(child._id, list));
      }
      return ids;
    };

    // 2. Collect all descendant folder IDs recursively
    const descendantIds = getDescendants(targetFolderId, allUserFolders);
    const allFolderObjectIds = [
      targetObjectId,
      ...descendantIds
        .filter(id => id && mongoose.Types.ObjectId.isValid(id.toString()))
        .map(id => new mongoose.Types.ObjectId(id.toString()))
    ];

    // 3. Strictly Scope the File Count AND Exclude Trash / Soft-deleted / Non-safe files
    const fileFilter = {
      $or: [
        { userId: req.user._id.toString() },
        { userId: req.user._id },
        { user: req.user._id }
      ],
      $and: [
        {
          $or: [
            { folderId: { $in: allFolderObjectIds } },
            { folder: { $in: allFolderObjectIds } }
          ]
        },
        { isTrash: { $ne: true } },
        { isDeleted: { $ne: true } },
        { status: { $ne: 'trash' } },
        { securityStatus: { $in: ['Safe', 'unscanned_too_large'] } }
      ]
    };

    // 4. Derive BOTH count and size from the exact same filtered query
    const totalFiles = await FileModel.countDocuments(fileFilter);

    const [sizeAgg] = await FileModel.aggregate([
      { $match: fileFilter },
      {
        $group: {
          _id: null,
          totalBytes: { $sum: '$size' }
        }
      }
    ]);

    const totalBytes = sizeAgg?.totalBytes || 0;

    const folderIdStr = folder._id.toString();
    const directSubfolders = allUserFolders.filter(f => {
      const pId = f.parentId || f.parentFolderId;
      return pId && pId.toString() === folderIdStr;
    }).length;

    const statsData = {
      name: folder.name,
      createdAt: folder.createdAt,
      totalFiles,
      totalBytes,
      fileCount: totalFiles,
      totalSizeBytes: totalBytes,
      subfolderCount: descendantIds.length,
      totalSubfolders: descendantIds.length,
      directSubfolders
    };

    return res.json({
      success: true,
      data: {
        totalFiles,
        totalBytes,
        subfolderCount: descendantIds.length,
        totalSubfolders: descendantIds.length,
        directSubfolders,
        name: folder.name,
        createdAt: folder.createdAt
      },
      ...statsData
    });
  } catch (err) {
    console.error('Error fetching folder stats/details:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch folder stats' });
  }
};

app.get('/api/folders/:id/stats', verifyToken, handleFolderDetailsOrStats);
app.get('/api/folders/:id/details', verifyToken, handleFolderDetailsOrStats);

app.delete('/api/folders/:id', verifyToken, async (req, res) => {
  try {
    const folderId = req.params.id;
    const folder = await FolderModel.findOne({ _id: folderId, userId: req.user._id });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Find all files in the folder
    const files = await FileModel.find({ folderId: folderId, userId: req.user._id });
    
    // Batch delete from S3
    const objectsToDelete = [];
    for (const file of files) {
      if (file.s3Key) objectsToDelete.push(file.s3Key);
      if (file.thumbnailKey) objectsToDelete.push(file.thumbnailKey);
      if (!file.s3Key && file.location) {
        try { objectsToDelete.push(new URL(file.location).pathname.slice(1)); } catch (_) {}
      }
    }

    if (objectsToDelete.length > 0) {
      await permanentlyDeleteS3Keys(s3, process.env.AWS_BUCKET_NAME, objectsToDelete);
    }

    // Delete all files in the DB
    await FileModel.deleteMany({ folderId: folderId, userId: req.user._id });
    
    // Delete the folder itself
    await FolderModel.deleteOne({ _id: folderId, userId: req.user._id });

    const exactStorageUsed = await recalculateStorage(req.user._id);

    return res.json({ message: 'Folder and all its contents deleted successfully', storageUsed: exactStorageUsed });
  } catch (err) {
    console.error('Error deleting folder:', err);
    return res.status(500).json({ error: 'Failed to delete folder' });
  }
});

app.get('/api/files', verifyToken, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const isRecent = req.query.recent === 'true';
    const searchQuery = req.query.search || '';
    const targetFolderId = req.query.folderId || req.query.folder || null;
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    let query = {
      $or: [{ userId: userId }, { user: userId }],
      isTrash: { $ne: true },
      securityStatus: { $in: ['clean', 'unverified'] }
    };
    
    if (searchQuery) {
      query.$and = [
        {
          $or: [
            { name: { $regex: searchQuery, $options: 'i' } },
            { originalName: { $regex: searchQuery, $options: 'i' } }
          ]
        }
      ];
    } else if (!isRecent) {
      if (!targetFolderId || targetFolderId === 'null' || targetFolderId === 'undefined') {
        // HOME (Root Directory):
        // A file belongs to Home ONLY if it is not inside ANY folder.
        // Both folder and folderId must be null/unset.
        query.folder = null;
        query.folderId = null;
      } else {
        // SUBFOLDER:
        // Match files assigned to targetFolderId via either field
        query.$and = [
          {
            $or: [{ folderId: targetFolderId }, { folder: targetFolderId }]
          }
        ];
      }
    }

    const limit = req.query.limit !== undefined 
      ? parseInt(req.query.limit, 10) 
      : (isRecent ? 10 : 0);
    const skip = parseInt(req.query.skip, 10) || 0;

    const totalCount = await FileModel.countDocuments(query);

    let dbFilesQuery = FileModel.find(query);
    if (isRecent) {
      dbFilesQuery = dbFilesQuery.sort({ uploadedAt: -1, createdAt: -1 });
    } else {
      dbFilesQuery = dbFilesQuery.sort({ uploadedAt: -1, createdAt: -1 });
    }

    if (skip > 0) {
      dbFilesQuery = dbFilesQuery.skip(skip);
    }
    if (limit > 0) {
      dbFilesQuery = dbFilesQuery.limit(limit);
    }
    
    const dbFiles = await dbFilesQuery.select('_id name originalName diskName folder folderId size securityStatus isMalicious mimetype mimeType uploadedAt createdAt').lean();
    
    const mappedFiles = dbFiles.map(file => ({
      ...file,
      id: file.diskName || file.name,
      _id: file._id.toString(),
      name: file.originalName || file.name,
      diskName: file.diskName || file.name,
      folderId: file.folderId ? file.folderId.toString() : (file.folder ? file.folder.toString() : null),
      isFolder: false,
      date: new Date(file.uploadedAt || file.createdAt || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      mtimeMs: new Date(file.uploadedAt || file.createdAt || Date.now()).getTime(),
      size: file.size,
      status: (file.securityStatus === 'clean' || file.securityStatus === 'Safe') ? 'Safe' : (file.securityStatus || 'Safe'),
      type: (file.originalName || file.name || '').split('.').pop()
    }));

    res.set('X-Total-Count', String(totalCount));

    if (isRecent) {
      return res.status(200).json({
        files: mappedFiles,
        total: totalCount,
        hasMore: skip + mappedFiles.length < totalCount,
      });
    }

    return res.status(200).json(mappedFiles);
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// In-memory response cache and single-flight request coalescing for photos endpoint
const photosResponseCache = new Map();
const inflightPhotosFetches = new Map();

function invalidatePhotosCache(userId) {
  if (userId) {
    const key = String(userId);
    photosResponseCache.delete(key);
    inflightPhotosFetches.delete(key);
  }
}

// Dedicated Photos & Media Endpoint (Optimized for Ultra-High-Concurrency)
app.get('/api/files/photos', verifyToken, async (req, res) => {
  // HTTP Caching: Disable caching so browser never holds stale S3 presigned URLs with HTTP 304
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: User identifier missing.' });
    }
    const userMatch = mongoose.Types.ObjectId.isValid(userId)
      ? { $in: [String(userId), new mongoose.Types.ObjectId(userId)] }
      : String(userId);
    const userKey = String(userId);

    // 1. Fast In-Memory Cache Check (< 1ms latency)
    const cached = photosResponseCache.get(userKey);
    if (cached && cached.expiresAt > Date.now()) {
      if (req._startTime) {
        res.setHeader('Server-Timing', 'app;dur=' + (performance.now() - req._startTime).toFixed(2));
      }
      // 304 disabled to ensure fresh presigned URLs
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', cached.jsonBuffer.length);
      return res.end(cached.jsonBuffer);
    }

    // 2. Single-Flight Coalescing: Prevents cache stampede / DB connection exhaustion under concurrent load
    let fetchPromise = inflightPhotosFetches.get(userKey);
    if (!fetchPromise) {
      fetchPromise = (async () => {
        // Field projection + .lean() to eliminate Mongoose hydration overhead and save ~70% server RAM
        const mediaFiles = await FileModel.find({
          $and: [
            {
              $or: [
                { userId: userMatch },
                { user: userMatch }
              ]
            },
            { isTrash: { $ne: true } },
            { isDeleted: { $ne: true } },
            { securityStatus: { $in: ['clean', 'unverified'] } },
            {
              $or: [
                { mimetype: { $regex: /^(image|video)\//i } },
                { mimeType: { $regex: /^(image|video)\//i } },
                { extension: { $in: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'mp4', 'webm', 'mov', 'mkv'] } },
                { originalName: { $regex: /\.(jpg|jpeg|png|webp|gif|svg|mp4|webm|mov|mkv)$/i } },
                { name: { $regex: /\.(jpg|jpeg|png|webp|gif|svg|mp4|webm|mov|mkv)$/i } }
              ]
            }
          ]
        })
        .select('_id name originalName s3Key location size mimetype mimeType uploadedAt createdAt')
        .sort({ uploadedAt: -1, createdAt: -1 })
        .lean();

        // Fast ETag generation: if user vault has not changed, respond with 304 Not Modified
        const latestTimestamp = mediaFiles.length > 0 
          ? new Date(mediaFiles[0].uploadedAt || mediaFiles[0].createdAt || 0).getTime() 
          : 0;
        const etag = `"${crypto.createHash('md5').update(`${userId}-${mediaFiles.length}-${latestTimestamp}`).digest('hex')}"`;

        const filesWithUrls = await Promise.all(mediaFiles.map(async (file) => {
          let targetKey = file.s3Key;
          if (!targetKey && file.location) {
            try {
              const urlObj = new URL(file.location);
              targetKey = decodeURIComponent(urlObj.pathname.substring(1).replace(/\+/g, '%20'));
            } catch (e) {}
          }

          let presignedUrl = '';
          if (targetKey && process.env.AWS_BUCKET_NAME) {
            try {
              const command = new GetObjectCommand({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: targetKey
              });
              presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
            } catch (err) {
              console.error('Error signing URL for media asset:', err.message);
            }
          }

          const finalUrl = presignedUrl || file.location || '';
          const ext = (file.originalName || file.name || '').split('.').pop().toLowerCase();
          const isVideo = (file.mimetype || file.mimeType || '').startsWith('video') || ['mp4', 'webm', 'mov', 'mkv'].includes(ext);
          const mimeType = file.mimetype || file.mimeType || (isVideo ? `video/${ext === 'mov' ? 'quicktime' : ext}` : `image/${ext === 'jpg' ? 'jpeg' : ext}`);

          return {
            _id: file._id.toString(),
            name: file.originalName || file.name,
            mimeType: mimeType,
            size: file.size || 0,
            createdAt: file.uploadedAt || file.createdAt || new Date(),
            s3Url: finalUrl,
            url: finalUrl
          };
        }));

        const payload = { success: true, count: filesWithUrls.length, files: filesWithUrls };
        const jsonBuffer = Buffer.from(JSON.stringify(payload));
        photosResponseCache.set(userKey, {
          payload,
          jsonBuffer,
          etag,
          expiresAt: Date.now() + 30000
        });

        return { payload, jsonBuffer, etag };
      })().finally(() => {
        inflightPhotosFetches.delete(userKey);
      });

      inflightPhotosFetches.set(userKey, fetchPromise);
    }

    const { payload, jsonBuffer, etag } = await fetchPromise;

    if (req._startTime) {
      res.setHeader('Server-Timing', 'app;dur=' + (performance.now() - req._startTime).toFixed(2));
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', jsonBuffer.length);
    return res.end(jsonBuffer);
  } catch (error) {
    console.error('Error fetching photos:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch media assets' });
  }
});

// Rename File Endpoint
app.patch('/api/files/:id/rename', verifyToken, async (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName || newName.trim() === '') {
      return res.status(400).json({ error: 'File name is required' });
    }
    const file = await FileModel.findOne({ _id: req.params.id, userId: req.user._id });
    if (!file) return res.status(404).json({ error: 'File not found' });
    
    file.originalName = newName.trim();
    file.name = newName.trim(); // updating both just in case
    await file.save();
    invalidatePhotosCache(req.user._id);
    
    res.json({ message: 'File renamed successfully', file });
  } catch (err) {
    console.error('Error renaming file:', err);
    res.status(500).json({ error: err.message });
  }
});

// Move Folder Endpoint (supports PUT and PATCH, parentId and targetFolderId)
const handleFolderMoveInServer = async (req, res) => {
  try {
    const rawUserId = req.user.id || req.user._id;
    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    const folderId = req.params.id;
    const { parentId, parentFolder, destinationId, targetFolderId } = req.body;

    const rawTarget = parentId !== undefined ? parentId : (parentFolder !== undefined ? parentFolder : (destinationId !== undefined ? destinationId : targetFolderId));
    const targetParentId = !rawTarget || rawTarget === 'null' || rawTarget === 'undefined' || rawTarget === 'root' ? null : rawTarget;

    if (targetParentId && targetParentId.toString() === folderId.toString()) {
      return res.status(400).json({ error: 'Cannot move folder into itself' });
    }

    const userQuery = [
      { userId: userIdObj },
      { user: userIdObj },
      { userId: String(rawUserId) },
      { user: String(rawUserId) },
    ];

    const folder = await FolderModel.findOne({
      _id: folderId,
      isTrash: { $ne: true },
      $or: userQuery,
    });

    if (!folder) {
      return res.status(404).json({ error: 'Folder not found or unauthorized' });
    }

    if (targetParentId) {
      const destinationFolder = await FolderModel.findOne({
        _id: targetParentId,
        isTrash: { $ne: true },
        $or: userQuery,
      });

      if (!destinationFolder) {
        return res.status(404).json({ error: 'Destination folder not found' });
      }
    }

    folder.parentId = targetParentId;
    folder.parentFolder = targetParentId;
    await folder.save();
    return res.status(200).json({ message: 'Folder moved successfully', success: true, folder });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'A folder with this name already exists in the destination' });
    }
    console.error('Error moving folder:', err);
    return res.status(500).json({ error: err.message || 'Failed to move folder' });
  }
};
app.patch('/api/folders/:id/move', verifyToken, handleFolderMoveInServer);
app.put('/api/folders/:id/move', verifyToken, handleFolderMoveInServer);

// Move File Endpoint (supports PUT and PATCH, folderId and targetFolderId)
const handleFileMoveInServer = async (req, res) => {
  try {
    let { targetFolderId, folderId, folder, parentId } = req.body;
    const rawTarget = folderId !== undefined ? folderId : (folder !== undefined ? folder : (parentId !== undefined ? parentId : targetFolderId));
    const targetParentId = (!rawTarget || rawTarget === "null" || rawTarget === "undefined" || rawTarget === "" || rawTarget === "root") ? null : rawTarget;

    const file = await FileModel.findOne({ _id: req.params.id, userId: req.user._id });
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    file.folderId = targetParentId;
    file.folder = targetParentId;
    await file.save();
    
    res.json({ message: 'File moved successfully', success: true, file });
  } catch (err) {
    console.error('Error moving file:', err);
    res.status(500).json({ error: err.message });
  }
};
app.patch('/api/files/:id/move', verifyToken, handleFileMoveInServer);
app.put('/api/files/:id/move', verifyToken, handleFileMoveInServer);

// Bulk Move Endpoint
app.patch('/api/files/bulk-move', verifyToken, async (req, res) => {
  try {
    let { fileIds, targetFolderId } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'No file IDs provided' });
    }

    if (!targetFolderId || targetFolderId === "null" || targetFolderId === "") {
      targetFolderId = null;
    }

    await FileModel.updateMany(
      { _id: { $in: fileIds }, userId: req.user._id },
      { $set: { folderId: targetFolderId } }
    );
    
    res.json({ message: 'Files moved successfully' });
  } catch (err) {
    console.error('Error in bulk move:', err);
    res.status(500).json({ error: err.message });
  }
});

// Multi-Item Batch Move Route (supports both folders and files)
const handleMoveBatch = async (req, res) => {
  try {
    let { folderIds = [], fileIds = [], targetFolderId = null } = req.body;
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: User identifier missing.' });
    }
    const userMatch = mongoose.Types.ObjectId.isValid(userId)
      ? { $in: [String(userId), new mongoose.Types.ObjectId(userId)] }
      : String(userId);

    if (!targetFolderId || targetFolderId === "null" || targetFolderId === "" || targetFolderId === "root") {
      targetFolderId = null;
    }

    let parsedTargetFolderId = null;
    if (targetFolderId) {
      if (!mongoose.Types.ObjectId.isValid(targetFolderId.toString())) {
        return res.status(400).json({ success: false, message: 'Invalid target folder ID' });
      }
      parsedTargetFolderId = new mongoose.Types.ObjectId(targetFolderId.toString());
      // Verify target folder exists and belongs to the user
      const targetFolder = await FolderModel.findOne({
        _id: parsedTargetFolderId,
        $or: [{ userId }, { userId: userId.toString() }, { user: userId }]
      });
      if (!targetFolder) {
        return res.status(404).json({ success: false, message: 'Target folder not found' });
      }
    }

    // Circular check: ensure targetFolderId is not among folderIds or any of their descendants
    if (parsedTargetFolderId && folderIds.length > 0) {
      const allUserFolders = await FolderModel.find({
        $or: [{ userId }, { userId: userId.toString() }, { user: userId }]
      }).lean();

      const getDescendants = (parentId, list) => {
        let children = list.filter(f => {
          const pId = f.parentId || f.parentFolderId;
          return pId && pId.toString() === parentId.toString();
        });
        let ids = [];
        for (const child of children) {
          ids.push(child._id.toString());
          ids = ids.concat(getDescendants(child._id, list));
        }
        return ids;
      };

      const invalidTargetIds = new Set();
      folderIds.forEach(fId => {
        if (!fId) return;
        const idStr = fId.toString();
        invalidTargetIds.add(idStr);
        getDescendants(idStr, allUserFolders).forEach(dId => invalidTargetIds.add(dId));
      });

      if (invalidTargetIds.has(parsedTargetFolderId.toString())) {
        return res.status(400).json({
          success: false,
          message: 'Cannot move a folder into itself or its own subfolder'
        });
      }
    }

    if (fileIds.length > 0) {
      const validFileIds = fileIds
        .filter(id => id && mongoose.Types.ObjectId.isValid(id.toString()))
        .map(id => new mongoose.Types.ObjectId(id.toString()));

      if (validFileIds.length > 0) {
        await FileModel.updateMany(
          {
            _id: { $in: validFileIds },
            $or: [{ userId }, { userId: userId.toString() }, { user: userId }]
          },
          { $set: { folderId: parsedTargetFolderId, folder: parsedTargetFolderId } }
        );
      }
    }

    if (folderIds.length > 0) {
      const validFolderIds = folderIds
        .filter(id => id && mongoose.Types.ObjectId.isValid(id.toString()))
        .map(id => new mongoose.Types.ObjectId(id.toString()));

      if (validFolderIds.length > 0) {
        await FolderModel.updateMany(
          {
            _id: { $in: validFolderIds },
            $or: [{ userId }, { userId: userId.toString() }, { user: userId }]
          },
          { $set: { parentId: parsedTargetFolderId } }
        );
      }
    }

    return res.json({ success: true, message: 'Items moved successfully' });
  } catch (err) {
    console.error('Error in batch move:', err);
    return res.status(500).json({ success: false, message: err.message, error: err.message });
  }
};

app.put('/api/folders/move-batch', verifyToken, handleMoveBatch);
app.post('/api/folders/move-batch', verifyToken, handleMoveBatch);
app.patch('/api/folders/move-batch', verifyToken, handleMoveBatch);
app.put('/api/folders/batch-move', verifyToken, handleMoveBatch);
app.post('/api/folders/batch-move', verifyToken, handleMoveBatch);
app.put('/api/files/move-batch', verifyToken, handleMoveBatch);
app.post('/api/files/move-batch', verifyToken, handleMoveBatch);
app.put('/api/files/batch-move', verifyToken, handleMoveBatch);
app.post('/api/files/batch-move', verifyToken, handleMoveBatch);

// Access File Endpoint (Presigned URL)
app.get('/api/files/:id/access', verifyToken, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id || req.user?.userId;
    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    let query = { 
      _id: req.params.id, 
      isTrash: { $ne: true },
      securityStatus: { $ne: 'threat_purged' } 
    };
    if (!req.user.isAdmin) {
      query.$or = [
        { userId: userIdObj },
        { user: userIdObj },
        { userId: String(rawUserId) },
        { user: String(rawUserId) },
      ];
    }
    const file = await FileModel.findOne(query);
    if (!file) return res.status(404).json({ error: 'File not found or unauthorized' });

    let targetKey = file.s3Key;
    if (!targetKey && file.location) {
      try {
        const urlObj = new URL(file.location);
        targetKey = decodeURIComponent(urlObj.pathname.substring(1).replace(/\+/g, '%20'));
      } catch (e) {
        console.error("URL parsing failed for location:", file.location);
      }
    }

    if (!targetKey) return res.status(400).json({ error: 'S3 Key missing and cannot be parsed from location' });

    const isDownload = req.query.download === 'true';
    const originalFileName = file.originalName || file.name;
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: targetKey,
      ResponseContentDisposition: isDownload ? `attachment; filename*=UTF-8''${encodeURIComponent(originalFileName)}` : 'inline'
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 60 });
    res.json({ url });
  } catch (error) {
    console.error('Access URL generation error:', error);
    res.status(500).json({ error: 'Failed to generate access URL' });
  }
});

// Dedicated Attachment Download Route
app.get('/api/files/:id/download', verifyToken, async (req, res) => {
  try {
    let query = {
      _id: req.params.id,
      $or: [
        { userId: req.user._id },
        { userId: String(req.user._id) },
        { user: req.user._id }
      ]
    };
    if (req.user.isAdmin) {
      query = { _id: req.params.id };
    }
    const file = await FileModel.findOne(query);
    if (!file) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    let targetKey = file.s3Key || file.key;
    if (!targetKey && file.location) {
      try {
        const urlObj = new URL(file.location);
        targetKey = decodeURIComponent(urlObj.pathname.substring(1).replace(/\+/g, '%20'));
      } catch (e) {
        console.error("URL parsing failed for location:", file.location);
      }
    }

    if (!targetKey) {
      return res.status(400).json({ success: false, message: 'S3 Key missing' });
    }

    const fileName = file.originalName || file.name || 'download';
    const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET_NAME;

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: targetKey,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    });

    // Valid for 5 minutes (300 seconds)
    const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    res.json({ success: true, downloadUrl });
  } catch (err) {
    console.error('Error generating download url:', err);
    res.status(500).json({ success: false, message: 'Download failed' });
  }
});

// GET /api/files/:id/download-url - Generates fresh on-demand S3 presigned download URL valid for 1 hour
app.get('/api/files/:id/download-url', verifyToken, async (req, res) => {
  try {
    let query = {
      _id: req.params.id,
      $or: [
        { userId: req.user._id },
        { userId: String(req.user._id) },
        { user: req.user._id }
      ]
    };
    if (req.user.isAdmin) {
      query = { _id: req.params.id };
    }
    const file = await FileModel.findOne(query);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    let targetKey = file.s3Key || file.key;
    if (!targetKey && file.location) {
      try {
        const urlObj = new URL(file.location);
        targetKey = decodeURIComponent(urlObj.pathname.substring(1).replace(/\+/g, '%20'));
      } catch (e) {
        console.error('URL parsing failed for location:', file.location);
      }
    }

    if (!targetKey) {
      return res.status(400).json({ error: 'S3 Key missing and cannot be parsed from location' });
    }

    const fileName = file.originalName || file.name || 'download';
    const bucket = process.env.AWS_S3_BUCKET_NAME || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET;

    // Generate fresh presigned URL valid for 1 hour (3600 seconds) with Content-Disposition: attachment
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: targetKey,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });

    const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    return res.json({ downloadUrl, name: fileName, size: file.size || 0 });
  } catch (err) {
    console.error('Failed to generate presigned download URL:', err);
    return res.status(500).json({ error: 'Failed to generate download link' });
  }
});

// Soft-Delete Single File
app.delete('/api/files/:id', verifyToken, async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id;
    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    const userMatch = {
      $or: [
        { userId: userIdObj },
        { user: userIdObj },
        { userId: String(rawUserId) },
        { user: String(rawUserId) },
      ],
    };

    const file = await FileModel.findOne({
      _id: req.params.id,
      ...userMatch,
    });

    if (!file) return res.status(404).json({ error: 'File not found or unauthorized' });

    file.isTrash = true;
    file.trashedAt = new Date();
    await file.save();

    if (file.size > 0 && file.securityStatus !== 'threat_purged') {
      await UserModel.findByIdAndUpdate(rawUserId, {
        $inc: { storageUsed: -Math.abs(file.size || 0) },
      });
    }

    invalidatePhotosCache(req.user._id);

    return res.status(200).json({
      success: true,
      message: 'File deleted',
      fileId: file._id,
      deletedId: file._id,
    });
  } catch (err) {
    console.error('[Delete Error]:', err);
    return res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Soft-Delete Batch Files & Folders
const handleServerBatchDelete = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id;
    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    const { fileIds = [], folderIds = [] } = req.body;

    const userMatch = {
      $or: [
        { userId: userIdObj },
        { user: userIdObj },
        { userId: String(rawUserId) },
        { user: String(rawUserId) },
      ],
    };

    if (fileIds.length > 0) {
      await FileModel.updateMany(
        { _id: { $in: fileIds }, ...userMatch },
        { $set: { isTrash: true, trashedAt: new Date() } }
      );
    }

    if (folderIds.length > 0) {
      await FolderModel.updateMany(
        { _id: { $in: folderIds }, ...userMatch },
        { $set: { isTrash: true, trashedAt: new Date() } }
      );
      await FileModel.updateMany(
        {
          $and: [
            userMatch,
            {
              $or: [
                { folder: { $in: folderIds } },
                { folderId: { $in: folderIds } },
              ],
            },
          ],
        },
        { $set: { isTrash: true, trashedAt: new Date() } }
      );
    }

    invalidatePhotosCache(req.user._id);
    await recalculateStorage(req.user._id);

    return res.status(200).json({ success: true, deletedCount: fileIds.length + folderIds.length });
  } catch (error) {
    console.error('Bulk deletion error:', error.message);
    return res.status(500).json({ error: 'Server error during bulk deletion' });
  }
};

app.post(['/api/files/delete-batch', '/api/files/bulk-delete', '/api/files/batch-delete', '/api/folders/delete-batch', '/api/folders/batch-delete'], verifyToken, handleServerBatchDelete);

// Restore Batch Files & Folders (Undo)
const handleServerBatchRestore = async (req, res) => {
  try {
    const rawUserId = req.user?.id || req.user?._id;
    const userIdObj = mongoose.Types.ObjectId.isValid(rawUserId)
      ? new mongoose.Types.ObjectId(rawUserId)
      : rawUserId;

    const { fileIds = [], folderIds = [] } = req.body;

    const userMatch = {
      $or: [
        { userId: userIdObj },
        { user: userIdObj },
        { userId: String(rawUserId) },
        { user: String(rawUserId) },
      ],
    };

    if (fileIds.length > 0) {
      await FileModel.updateMany(
        { _id: { $in: fileIds }, ...userMatch },
        { $set: { isTrash: false, trashedAt: null } }
      );
    }

    if (folderIds.length > 0) {
      await FolderModel.updateMany(
        { _id: { $in: folderIds }, ...userMatch },
        { $set: { isTrash: false, trashedAt: null } }
      );
      await FileModel.updateMany(
        {
          $and: [
            userMatch,
            {
              $or: [
                { folder: { $in: folderIds } },
                { folderId: { $in: folderIds } },
              ],
            },
          ],
        },
        { $set: { isTrash: false, trashedAt: null } }
      );
    }

    invalidatePhotosCache(req.user._id);
    await recalculateStorage(req.user._id);

    return res.status(200).json({ success: true, restoredCount: fileIds.length + folderIds.length });
  } catch (error) {
    console.error('Restore error:', error.message);
    return res.status(500).json({ error: 'Server error during restore' });
  }
};

app.post(['/api/files/restore-batch', '/api/files/batch-restore', '/api/folders/restore-batch', '/api/folders/batch-restore'], verifyToken, handleServerBatchRestore);


// Centralized Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Application Error:', err.message);
  if (res.headersSent) {
    return next(err);
  }
  const isProd = process.env.NODE_ENV === 'production';
  res.status(err.status || 500).json({
    success: false,
    error: isProd ? 'Internal server error. Please try again later.' : err.message,
    ...(isProd ? {} : { stack: err.stack }),
  });
});

const PORT = process.env.PORT || 5000;
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = {
  app,
  sweepAbandonedUploads
};
