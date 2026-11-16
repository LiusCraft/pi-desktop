/**
 * The user's own S3-compatible bucket (AWS S3, Cloudflare R2, Aliyun OSS, Tencent COS, MinIO …).
 * One connection for the whole app: whatever Pi Desktop keeps outside this machine (published
 * artifacts today) goes through it, each feature under its own folder in the bucket.
 */

export interface ObjectStorageConfig {
  /** Service endpoint, e.g. https://s3.us-east-1.amazonaws.com or https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  /** Where the uploaded files are reachable from a browser (public bucket URL or CDN), no trailing slash. */
  publicBaseUrl: string;
  /** Key prefix shared by everything the app stores; empty uses the bucket's root. */
  prefix: string;
  /** `endpoint/bucket/key` (most S3-compatible services) instead of `bucket.endpoint/key`. */
  pathStyle: boolean;
}

/** What the renderer sees: the secret itself never leaves the host. */
export interface ObjectStorageInfo extends ObjectStorageConfig {
  secretSet: boolean;
  /** True once the app can store things there. */
  ready: boolean;
}

/** What the renderer sends; an empty secret keeps the saved one. */
export interface ObjectStorageDraft extends ObjectStorageConfig {
  secretAccessKey: string;
}

export const EMPTY_STORAGE: ObjectStorageConfig = {
  endpoint: '',
  region: 'auto',
  bucket: '',
  accessKeyId: '',
  publicBaseUrl: '',
  prefix: '',
  pathStyle: true,
};

/** The first missing setting, or null when the config is complete enough to use. */
export function missingStorageField(c: ObjectStorageConfig, secretSet: boolean): string | null {
  if (!c.endpoint.trim()) return 'endpoint';
  if (!c.bucket.trim()) return 'bucket';
  if (!c.accessKeyId.trim()) return 'accessKeyId';
  if (!secretSet) return 'secretAccessKey';
  if (!c.publicBaseUrl.trim()) return 'publicBaseUrl';
  return null;
}

export const STORAGE_NOT_CONFIGURED =
  'This needs an S3-compatible bucket. Ask the user to set one up in Settings → Storage (endpoint, bucket, access key, public URL).';

/** Where an object is reachable from a browser; `key` is relative to the configured prefix. */
export function storageUrl(c: Pick<ObjectStorageConfig, 'publicBaseUrl' | 'prefix'>, key: string): string {
  const base = c.publicBaseUrl.trim().replace(/\/+$/, '');
  const prefix = c.prefix.trim().replace(/^\/+|\/+$/g, '');
  return [base, prefix, key.split('/').map(encodeURIComponent).join('/')].filter(Boolean).join('/');
}
