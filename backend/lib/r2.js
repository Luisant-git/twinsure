'use strict';

/**
 * Cloudflare R2 Storage Helper
 * ─────────────────────────────────────────────────────────────
 * Cloudflare R2 is S3-compatible, so the AWS SDK S3 client is
 * used for all operations. All credentials and endpoints are
 * loaded exclusively from environment variables — no hardcoded
 * values anywhere in this file.
 *
 * Bucket layout (twinsure bucket):
 *   public/
 *     claim-forms/   ← admin-uploaded claim PDFs (publicly readable)
 *     partners/      ← partner profile photos  (publicly readable)
 *   private/
 *     aadhaar/       ← user KYC: Aadhaar documents
 *     pancard/       ← user KYC: PAN card documents
 *     voterid/       ← user KYC: Voter ID documents
 *     profile/       ← user KYC: profile photos
 *     policies/      ← user-uploaded policy PDF copies
 *   system/          ← reserved for future use (untouched)
 */

const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand
} = require('@aws-sdk/client-s3');

const { getSignedUrl: awsGetSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');

// ── R2 folder path constants ───────────────────────────────────────────────
const R2_PATHS = Object.freeze({
  // Public (no auth required to read)
  CLAIM_FORMS : 'public/claim-forms',
  PARTNERS    : 'public/partners',

  // Private (require signed URL or admin to read)
  AADHAAR     : 'private/aadhaar',
  PANCARD     : 'private/pancard',
  VOTERID     : 'private/voterid',
  PROFILE     : 'private/profile',
  POLICIES    : 'private/policies',
});

// Map KYC documentType values → R2 folder paths
const KYC_FOLDER_MAP = Object.freeze({
  aadhaar : R2_PATHS.AADHAAR,
  pan     : R2_PATHS.PANCARD,
  voterid : R2_PATHS.VOTERID,
  photo   : R2_PATHS.PROFILE,
});

// ── Client (lazy singleton) ────────────────────────────────────────────────
let _client = null;

/**
 * Returns (and lazily initialises) the singleton S3Client pointed at R2.
 * Throws clearly if any required env variable is absent.
 */
function getClient() {
  if (_client) return _client;

  const endpoint     = process.env.R2_ENDPOINT;
  const accessKeyId  = process.env.R2_ACCESS_KEY_ID;
  const secretKey    = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretKey) {
    throw new Error(
      'R2 configuration is incomplete. ' +
      'Ensure R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are set in .env'
    );
  }

  _client = new S3Client({
    region      : 'auto',
    endpoint,
    credentials : { accessKeyId, secretAccessKey: secretKey }
  });

  return _client;
}

/**
 * Returns the configured bucket name from env.
 * @returns {string}
 */
function getBucket() {
  const name = process.env.R2_BUCKET_NAME;
  if (!name) throw new Error('R2_BUCKET_NAME is not set in .env');
  return name;
}

// ── Content-type helper ────────────────────────────────────────────────────
/**
 * Derives a MIME content type from a file name.
 * @param {string} filename
 * @returns {string}
 */
function getContentType(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  const map = {
    '.pdf'  : 'application/pdf',
    '.jpg'  : 'image/jpeg',
    '.jpeg' : 'image/jpeg',
    '.png'  : 'image/png',
    '.mp4'  : 'video/mp4',
    '.webm' : 'video/webm',
  };
  return map[ext] || 'application/octet-stream';
}

// ── Core operations ────────────────────────────────────────────────────────

/**
 * Uploads a file buffer to Cloudflare R2.
 * @param {Buffer} buffer       - File contents.
 * @param {string} key          - Full R2 object key  (e.g. "private/aadhaar/123_doc.pdf").
 * @param {string} [contentType] - MIME type; auto-detected from key if omitted.
 * @returns {Promise<string>}   - Resolves with the key on success.
 */
async function uploadToR2(buffer, key, contentType) {
  const mime = contentType || getContentType(key);
  await getClient().send(new PutObjectCommand({
    Bucket      : getBucket(),
    Key         : key,
    Body        : buffer,
    ContentType : mime,
  }));
  return key;
}

/**
 * Permanently deletes an object from R2.
 * Silently no-ops if key is falsy (safe to call unconditionally).
 * @param {string} key
 * @returns {Promise<void>}
 */
async function deleteFromR2(key) {
  if (!key) return;
  await getClient().send(new DeleteObjectCommand({
    Bucket : getBucket(),
    Key    : key,
  }));
}

/**
 * Generates a pre-signed GET URL for a private R2 object.
 * @param {string} key
 * @param {number} [expiresInSeconds=900]  - Default: 15 minutes.
 * @returns {Promise<string>}
 */
async function getSignedUrl(key, expiresInSeconds = 900) {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key });
  return awsGetSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
}

/**
 * Returns the permanent public URL for an object stored under public/.
 * Requires R2_PUBLIC_URL to be set in .env.
 * @param {string} key
 * @returns {string}
 */
function getPublicUrl(key) {
  const base = process.env.R2_PUBLIC_URL;
  if (!base || base.includes('your-public-url.r2.dev')) {
    return `/${key}`;
  }
  return `${base.replace(/\/$/, '')}/${key}`;
}

/**
 * Returns true if the key lives in the public/ prefix (no auth needed).
 * @param {string} key
 * @returns {boolean}
 */
function isPublicKey(key) {
  return typeof key === 'string' && key.startsWith('public/');
}

/**
 * Resolves the correct access URL for any R2 key:
 *   - public/ → permanent public URL (no expiry)
 *   - private/ → pre-signed URL (expires in expiresInSeconds)
 * @param {string} key
 * @param {number} [expiresInSeconds=900]
 * @returns {Promise<string>}
 */
async function getFileUrl(key, expiresInSeconds = 900) {
  if (!key) return null;
  if (isPublicKey(key)) return getPublicUrl(key);
  return getSignedUrl(key, expiresInSeconds);
}

/**
 * Downloads an R2 object and returns its contents as a Buffer.
 * Used for email attachments where a file path is unavailable.
 * @param {string} key
 * @returns {Promise<Buffer>}
 */
async function getBufferFromR2(key) {
  const response = await getClient().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key })
  );

  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Returns a readable stream from Cloudflare R2 along with headers and statusCode.
 * Supports Range requests (Partial Content).
 * @param {string} key
 * @param {string} [rangeHeader]
 * @returns {Promise<{stream: any, headers: Object, statusCode: number}>}
 */
async function getStreamFromR2(key, rangeHeader) {
  const params = { Bucket: getBucket(), Key: key };
  if (rangeHeader) {
    params.Range = rangeHeader;
  }
  const response = await getClient().send(new GetObjectCommand(params));
  return {
    stream: response.Body,
    headers: {
      'Content-Type': response.ContentType,
      'Content-Length': response.ContentLength,
      'Content-Range': response.ContentRange,
      'Accept-Ranges': response.AcceptRanges,
      'ETag': response.ETag,
      'Last-Modified': response.LastModified
    },
    statusCode: response.$metadata.httpStatusCode || 200
  };
}

// ── Exports ────────────────────────────────────────────────────────────────
module.exports = {
  /** Folder path constants — use these when building R2 keys */
  R2_PATHS,

  /** Maps KYC documentType values to their R2 folder path */
  KYC_FOLDER_MAP,

  /** Derives MIME type from a filename */
  getContentType,

  /** Upload buffer → R2 */
  uploadToR2,

  /** Delete object from R2 */
  deleteFromR2,

  /** Pre-signed GET URL (private objects) */
  getSignedUrl,

  /** Permanent public URL (public/ objects) */
  getPublicUrl,

  /** Smart URL resolver — picks public or signed based on key prefix */
  getFileUrl,

  /** Download R2 object as Buffer (for email attachments) */
  getBufferFromR2,

  /** Streams R2 object directly for chunked/range downloads */
  getStreamFromR2,

  /** Returns true if key is under public/ */
  isPublicKey,
};
