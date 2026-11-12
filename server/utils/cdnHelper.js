/**
 * Cloudflare CDN URL Transformer for Presigned S3/B2 GET Requests
 *
 * Rewrites S3 presigned GET URLs to use the Cloudflare CDN origin (CDN_DOWNLOAD_URL)
 * while preserving the full pathname and authorization signatures (X-Amz-* query parameters).
 */
const applyCdnToUrl = (url) => {
  if (!url || !process.env.CDN_DOWNLOAD_URL) return url;
  const cdnBase = process.env.CDN_DOWNLOAD_URL.replace(/\/$/, '');

  if (process.env.AWS_ENDPOINT) {
    const s3Endpoint = process.env.AWS_ENDPOINT.replace(/\/$/, '');
    if (url.startsWith(s3Endpoint)) {
      return url.replace(s3Endpoint, cdnBase);
    }
  }

  try {
    const parsed = new URL(url);
    const cdnUrl = new URL(cdnBase);
    parsed.protocol = cdnUrl.protocol;
    parsed.host = cdnUrl.host;
    parsed.port = cdnUrl.port;
    return parsed.toString();
  } catch {
    return url;
  }
};

module.exports = { applyCdnToUrl };
