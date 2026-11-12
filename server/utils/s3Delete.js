const { ListObjectVersionsCommand, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

/**
 * Permanently deletes all versions and delete markers for the specified S3/B2 keys.
 * In Backblaze B2, deleting without VersionId creates a 0-byte hidden delete marker;
 * specifying VersionId permanently erases every version and marker from storage.
 *
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client
 * @param {string} bucket
 * @param {string|string[]} keys
 */
async function permanentlyDeleteS3Keys(s3Client, bucket, keys) {
  if (!s3Client || !bucket || !keys) return;

  const rawList = Array.isArray(keys) ? keys : [keys];
  const stringKeys = rawList
    .map((k) => (typeof k === 'string' ? k : k?.Key))
    .filter((k) => typeof k === 'string' && k.trim().length > 0);

  const uniqueKeys = [...new Set(stringKeys)];
  if (uniqueKeys.length === 0) return;

  const objectsToDelete = [];

  // Concurrently inspect all versions for each key
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

  // Batch-delete all collected items in chunks of 1000
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < objectsToDelete.length; i += CHUNK_SIZE) {
    const chunk = objectsToDelete.slice(i, i + CHUNK_SIZE);
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

module.exports = { permanentlyDeleteS3Keys };
