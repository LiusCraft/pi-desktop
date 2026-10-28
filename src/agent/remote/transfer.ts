// File contents a remote client needs from, or hands to, the machine that serves it: attachments for a
// prompt (the session reads them by path, so they must sit on this disk) and the pages of artifacts (which
// the client previews in its own window).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACT_ID_PATTERN } from '@shared/artifacts';
import { LIMITS } from '@shared/attachments';
import type { AttachmentImportResult, AttachmentSource } from '@shared/protocol';
import { REMOTE_ARTIFACT_MAX_BYTES, REMOTE_UPLOAD_KEEP_MS, REMOTE_UPLOAD_MAX_BYTES, type RemoteArtifactSite, type RemoteTransferMethod, type RemoteUpload } from '@shared/remote';
import { tr } from '@shared/i18n/runtime';
import { appUploadsDir } from '../app-paths';
import { ArtifactService } from '../artifacts';
import { importAttachments, safeName, sniffImage } from '../attachments';
import { ObjectStorage } from '../storage';

/** Removes the upload folders nobody has touched for `REMOTE_UPLOAD_KEEP_MS`; the session folders that referenced them keep working, only the old files are gone. */
export async function pruneUploads(dataDir: string, now = Date.now()): Promise<void> {
  const root = appUploadsDir(dataDir);
  let names: string[];
  try {
    names = await fs.promises.readdir(root);
  } catch {
    return;
  }
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      if (now - (await fs.promises.stat(dir)).mtimeMs > REMOTE_UPLOAD_KEEP_MS) await fs.promises.rm(dir, { recursive: true, force: true });
    } catch {
      // Gone or busy: the next upload tries again.
    }
  }
}

/** Images go in as pasted data; anything else is saved under the uploads folder and attached by path. */
export async function receiveUploads(dataDir: string, uploads: unknown): Promise<AttachmentImportResult> {
  if (!Array.isArray(uploads)) return importAttachments([]);
  await pruneUploads(dataDir);
  const sources: AttachmentSource[] = [];
  const errors: AttachmentImportResult['errors'] = [];
  let total = 0;
  for (const upload of uploads as RemoteUpload[]) {
    const name = safeName(upload?.name);
    try {
      if (typeof upload?.data !== 'string') throw new Error(tr('remote.upload.invalid'));
      const bytes = Buffer.from(upload.data, 'base64');
      total += bytes.length;
      if (bytes.length > LIMITS.fileBytes || total > REMOTE_UPLOAD_MAX_BYTES) throw new Error(tr('remote.upload.tooBig'));
      const mimeType = sniffImage(bytes);
      if (mimeType) {
        sources.push({ name, mimeType, data: bytes.toString('base64') });
        continue;
      }
      const dir = path.join(appUploadsDir(dataDir), crypto.randomUUID());
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, name);
      await fs.promises.writeFile(file, bytes);
      sources.push({ path: file });
    } catch (err) {
      errors.push({ name, message: (err as Error).message });
    }
  }
  const result = await importAttachments(sources);
  return { attachments: result.attachments, errors: [...errors, ...result.errors] };
}

/** The files of one artifact; none when the client already holds `have`. */
export function readArtifactSite(dataDir: string, id: unknown, have: unknown): RemoteArtifactSite | null {
  if (typeof id !== 'string' || !ARTIFACT_ID_PATTERN.test(id)) return null;
  const service = new ArtifactService(dataDir, new ObjectStorage(dataDir));
  const meta = service.find(id);
  if (!meta) return null;
  if (have === meta.version) return { version: meta.version };
  const site = service.siteDir(id);
  let total = 0;
  const files = meta.files.map((rel) => {
    const abs = path.resolve(site, rel);
    if (abs !== site && !abs.startsWith(site + path.sep)) throw new Error(tr('remote.artifact.invalid'));
    const bytes = fs.readFileSync(abs);
    total += bytes.length;
    if (total > REMOTE_ARTIFACT_MAX_BYTES) throw new Error(tr('remote.artifact.tooBig'));
    return { rel, data: bytes.toString('base64') };
  });
  return { version: meta.version, files };
}

export async function transferCall(dataDir: string, method: RemoteTransferMethod, args: unknown[]): Promise<unknown> {
  switch (method) {
    case 'attachments:upload': return receiveUploads(dataDir, args[0]);
    case 'artifacts:site': return readArtifactSite(dataDir, args[0], args[1]);
  }
}
