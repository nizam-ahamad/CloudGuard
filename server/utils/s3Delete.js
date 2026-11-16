const {
  S3Client,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');

// Lazy shared default S3Client instance for when caller uses (keys, userId)
let defaultS3Client = null;
function getDefaultS3Client() {
  if (!defaultS3Client) {
    defaultS3Client = new S3Client({
      region: process.env.AWS_REGION || 'eu-central-003',
      ...(process.env.AWS_ENDPOINT ? { endpoint: process.env.AWS_ENDPOINT } : {}),
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return defaultS3Client;
}

function getDefaultBucket() {
  return (
    process.env.AWS_S3_BUCKET ||
    process.env.AWS_BUCKET_NAME ||
    process.env.AWS_S3_BUCKET_NAME
  );
}

/**
 * Permanently deletes all versions and delete markers for the specified S3/B2 keys.
 * In Backblaze B2, deleting without VersionId creates a 0-byte hidden delete marker;
 * specifying VersionId permanently erases every version and marker from storage.
 *
 * Supports both signatures:
 *   - permanentlyDeleteS3Keys(keys, [rawUserId])
 *   - permanentlyDeleteS3Keys(s3Client, bucket, keys, [rawUserId])
 *
 * Strict Tenant Key Prefix Verification:
 * Enforces that every key must match uploads/${rawUserId}/ or thumbnails/${rawUserId}/
 * (or valid uploads/ / thumbnails/ prefixes) before sending to DeleteObjectsCommand.
 *
 * @param {import('@aws-sdk/client-s3').S3Client|string|string[]} arg1 S3Client instance or keys
 * @param {string} [arg2] bucket or rawUserId
 * @param {string|string[]} [arg3] keys (if 4-arg signature)
 * @param {string} [arg4] rawUserId (if 4-arg signature)
 */
async function permanentlyDeleteS3Keys(arg1, arg2, arg3, arg4) {
  let s3Client;
  let bucket;
  let keys;
  let rawUserId;

  if (arg1 && (typeof arg1.send === 'function' || arg1 instanceof S3Client)) {
    // 4-arg or 3-arg legacy signature: (s3Client, bucket, keys, [rawUserId])
    s3Client = arg1;
    bucket = arg2;
    keys = arg3;
    rawUserId = arg4;
  } else {
    // 2-arg or 1-arg modern signature: (keys, [rawUserId])
    s3Client = getDefaultS3Client();
    bucket = getDefaultBucket();
    keys = arg1;
    rawUserId = arg2;
  }

  if (!s3Client) s3Client = getDefaultS3Client();
  if (!bucket) bucket = getDefaultBucket();
  if (!s3Client || !bucket || !keys) return;

  const rawList = Array.isArray(keys) ? keys : [keys];
  let stringKeys = rawList
    .map((k) => (typeof k === 'string' ? k : k?.Key))
    .filter((k) => typeof k === 'string' && k.trim().length > 0);

  // Strict Tenant Prefix Verification:
  // Keys must strictly match uploads/${rawUserId}/ or thumbnails/${rawUserId}/
  if (rawUserId) {
    const userPrefix = `uploads/${String(rawUserId)}/`;
    const thumbPrefix = `thumbnails/${String(rawUserId)}/`;
    stringKeys = stringKeys.filter(
      (k) => k.startsWith(userPrefix) || k.startsWith(thumbPrefix)
    );
  } else {
    stringKeys = stringKeys.filter(
      (k) => k.startsWith('uploads/') || k.startsWith('thumbnails/')
    );
  }

  const uniqueKeys = [...new Set(stringKeys)];
  if (uniqueKeys.length === 0) return;

  const objectsToDelete = [];

  // Concurrently inspect all versions and delete markers for each key
  await Promise.all(
    uniqueKeys.map(async (key) => {
      let foundAny = false;
      try {
        let keyMarker;
        let versionIdMarker;
        let isTruncated = true;

        while (isTruncated) {
          const listCmd = new ListObjectVersionsCommand({
            Bucket: bucket,
            Prefix: key,
            KeyMarker: keyMarker,
            VersionIdMarker: versionIdMarker,
          });

          const res = await s3Client.send(listCmd);

          if (Array.isArray(res.Versions)) {
            for (const v of res.Versions) {
              if (v.Key === key && v.VersionId) {
                objectsToDelete.push({ Key: v.Key, VersionId: v.VersionId });
                foundAny = true;
              }
            }
          }

          if (Array.isArray(res.DeleteMarkers)) {
            for (const dm of res.DeleteMarkers) {
              if (dm.Key === key && dm.VersionId) {
                objectsToDelete.push({ Key: dm.Key, VersionId: dm.VersionId });
                foundAny = true;
              }
            }
          }

          isTruncated = !!res.IsTruncated;
          if (isTruncated) {
            keyMarker = res.NextKeyMarker;
            versionIdMarker = res.NextVersionIdMarker;
          }
        }
      } catch (err) {
        console.warn(`[s3Delete] ListObjectVersions failed for "${key}":`, err.message);
      }

      // Fallback: If no versions or delete markers matched, include the plain key
      if (!foundAny) {
        objectsToDelete.push({ Key: key });
      }
    })
  );

  // Secondary Ironclad Guard: Filter every object key before sending to DeleteObjectsCommand
  const safeObjectsToDelete = objectsToDelete.filter((item) => {
    if (!item?.Key || typeof item.Key !== 'string') return false;
    if (rawUserId) {
      const userPrefix = `uploads/${String(rawUserId)}/`;
      const thumbPrefix = `thumbnails/${String(rawUserId)}/`;
      return item.Key.startsWith(userPrefix) || item.Key.startsWith(thumbPrefix);
    }
    return item.Key.startsWith('uploads/') || item.Key.startsWith('thumbnails/');
  });

  if (safeObjectsToDelete.length === 0) return;

  // Batch-delete all collected items in chunks of 1000
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < safeObjectsToDelete.length; i += CHUNK_SIZE) {
    const chunk = safeObjectsToDelete.slice(i, i + CHUNK_SIZE);
    try {
      await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: chunk,
            Quiet: true,
          },
        })
      );
    } catch (err) {
      console.error('[s3Delete] DeleteObjectsCommand error:', err.message);
    }
  }
}

/**
 * Iterates ListObjectVersionsCommand under a strict tenant prefix (uploads/<userId>/ or thumbnails/<userId>/)
 * with KeyMarker / VersionIdMarker pagination, permanently deleting every Version and DeleteMarker
 * in chunks of 1,000 via DeleteObjectsCommand.
 *
 * @param {string} prefix Directory prefix to purge
 * @param {string} [rawUserId] Optional tenant user ID to enforce strict isolation
 * @param {import('@aws-sdk/client-s3').S3Client} [customClient] Optional S3Client
 * @param {string} [customBucket] Optional bucket name
 */
async function purgeAllVersionsUnderPrefix(prefix, rawUserId, customClient, customBucket) {
  if (!prefix || typeof prefix !== 'string') return;

  const client = customClient || getDefaultS3Client();
  const bucket = customBucket || getDefaultBucket();
  if (!client || !bucket) return;

  const trimmedPrefix = prefix.trim();

  // Strict tenant restriction:
  if (rawUserId) {
    const userPrefix = `uploads/${String(rawUserId)}/`;
    const thumbPrefix = `thumbnails/${String(rawUserId)}/`;
    if (!trimmedPrefix.startsWith(userPrefix) && !trimmedPrefix.startsWith(thumbPrefix)) {
      console.warn(`[s3Delete] Blocked purge: prefix "${trimmedPrefix}" does not match user "${rawUserId}"`);
      return;
    }
  } else {
    // Must contain a non-empty user identifier segment after uploads/ or thumbnails/
    const validTenantPrefix = /^(uploads|thumbnails)\/[a-zA-Z0-9_\-]+\//;
    if (!validTenantPrefix.test(trimmedPrefix)) {
      console.warn(`[s3Delete] Blocked purge: prefix "${trimmedPrefix}" lacks tenant isolation segment`);
      return;
    }
  }

  let keyMarker;
  let versionIdMarker;
  let isTruncated = true;

  while (isTruncated) {
    try {
      const listCmd = new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: trimmedPrefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      });

      const res = await client.send(listCmd);
      const itemsToDelete = [];

      if (Array.isArray(res.Versions)) {
        for (const v of res.Versions) {
          if (v.Key && v.VersionId) {
            itemsToDelete.push({ Key: v.Key, VersionId: v.VersionId });
          }
        }
      }

      if (Array.isArray(res.DeleteMarkers)) {
        for (const dm of res.DeleteMarkers) {
          if (dm.Key && dm.VersionId) {
            itemsToDelete.push({ Key: dm.Key, VersionId: dm.VersionId });
          }
        }
      }

      // Safety check: ensure all keys start with the validated prefix
      const safeItems = itemsToDelete.filter((item) => item?.Key?.startsWith(trimmedPrefix));

      const CHUNK_SIZE = 1000;
      for (let i = 0; i < safeItems.length; i += CHUNK_SIZE) {
        const chunk = safeItems.slice(i, i + CHUNK_SIZE);
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: chunk,
              Quiet: true,
            },
          })
        );
      }

      isTruncated = !!res.IsTruncated;
      if (isTruncated) {
        keyMarker = res.NextKeyMarker;
        versionIdMarker = res.NextVersionIdMarker;
      }
    } catch (err) {
      console.error(`[s3Delete] purgeAllVersionsUnderPrefix error for "${trimmedPrefix}":`, err.message);
      break;
    }
  }
}

module.exports = { permanentlyDeleteS3Keys, purgeAllVersionsUnderPrefix };
