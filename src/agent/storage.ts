/**
 * The app's one connection to the user's S3-compatible bucket: `<app data>/object-storage.json`,
 * secret included, kept private to the user the way pi keeps its own auth.json. Features that
 * store something remotely (artifacts today) use `put` / `remove` / `url` with a key of their own
 * and never see the credentials; the Settings page edits the connection.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  EMPTY_STORAGE, STORAGE_NOT_CONFIGURED, missingStorageField, storageUrl,
  type ObjectStorageConfig, type ObjectStorageDraft, type ObjectStorageInfo,
} from '@shared/storage';
import { appObjectStorageFile } from './app-paths';
import { checkBucket, contentTypeFor, deleteObject, putObject, type S3Target } from './s3';

type Stored = Partial<ObjectStorageConfig> & { secretAccessKey?: string };

export class ObjectStorage {
  constructor(private readonly dataDir: string) {}

  private read(): { config: ObjectStorageConfig; secret: string } {
    try {
      const { secretAccessKey, ...rest } = JSON.parse(fs.readFileSync(appObjectStorageFile(this.dataDir), 'utf8')) as Stored;
      return { config: { ...EMPTY_STORAGE, ...rest }, secret: secretAccessKey ?? '' };
    } catch {
      return { config: { ...EMPTY_STORAGE }, secret: '' };
    }
  }

  info(): ObjectStorageInfo {
    const { config, secret } = this.read();
    return { ...config, secretSet: !!secret, ready: missingStorageField(config, !!secret) === null };
  }

  save(draft: ObjectStorageDraft): ObjectStorageInfo {
    const { secret: saved } = this.read();
    const config: ObjectStorageConfig = {
      endpoint: draft.endpoint.trim().replace(/\/+$/, ''),
      region: draft.region.trim() || EMPTY_STORAGE.region,
      bucket: draft.bucket.trim(),
      accessKeyId: draft.accessKeyId.trim(),
      publicBaseUrl: draft.publicBaseUrl.trim().replace(/\/+$/, ''),
      prefix: draft.prefix.trim().replace(/^\/+|\/+$/g, ''),
      pathStyle: !!draft.pathStyle,
    };
    for (const [name, value] of [['endpoint', config.endpoint], ['publicBaseUrl', config.publicBaseUrl]] as const) {
      if (value && !/^https?:\/\//i.test(value)) throw new Error(`${name} must start with http:// or https://`);
    }
    const file = appObjectStorageFile(this.dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...config, secretAccessKey: draft.secretAccessKey.trim() || saved }, null, 2), { mode: 0o600 });
    return this.info();
  }

  /** Sign a one-key listing with the saved settings (or an unsaved draft); resolves when the bucket answers. */
  async test(draft?: ObjectStorageDraft): Promise<void> {
    const saved = this.read();
    const target = draft ? { ...draft, secretAccessKey: draft.secretAccessKey.trim() || saved.secret } : { ...saved.config, secretAccessKey: saved.secret };
    const missing = missingStorageField(target, !!target.secretAccessKey);
    // The public URL is not used by the test, so it may still be empty here.
    if (missing && missing !== 'publicBaseUrl') throw new Error(`Fill in ${missing} first`);
    await checkBucket(this.target(target, target.secretAccessKey));
  }

  private target(c: ObjectStorageConfig, secretAccessKey: string): S3Target {
    return { endpoint: c.endpoint, region: c.region, bucket: c.bucket, accessKeyId: c.accessKeyId, secretAccessKey, pathStyle: c.pathStyle };
  }

  /** The configuration to use, or the message that says how to get one. */
  private ready() {
    const { config, secret } = this.read();
    if (missingStorageField(config, !!secret)) throw new Error(STORAGE_NOT_CONFIGURED);
    return { config, target: this.target(config, secret) };
  }

  private key(config: ObjectStorageConfig, key: string) {
    return [config.prefix, key].filter(Boolean).join('/');
  }

  /** Store `body` at `key` (relative to the configured prefix); the content type follows the file name. */
  async put(key: string, body: Buffer): Promise<void> {
    const { config, target } = this.ready();
    await putObject(target, this.key(config, key), body, contentTypeFor(key));
  }

  async remove(key: string): Promise<void> {
    const { config, target } = this.ready();
    await deleteObject(target, this.key(config, key));
  }

  /** Where `key` can be opened from a browser. */
  url(key: string): string {
    return storageUrl(this.ready().config, key);
  }
}
