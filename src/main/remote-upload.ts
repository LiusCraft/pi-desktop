// While a window drives a remote host, a prompt's attachments must sit on that host's disk: the session
// reads files by path. The files named here are read on this machine and sent over.
import fs from 'node:fs';
import path from 'node:path';
import { LIMITS } from '@shared/attachments';
import { tr } from '@shared/i18n/runtime';
import type { AttachmentImportResult, AttachmentSource } from '@shared/protocol';
import { REMOTE_UPLOAD_MAX_BYTES, type RemoteUpload } from '@shared/remote';

interface Caller {
  call<T>(method: string, ...args: unknown[]): Promise<T>;
}

async function readUpload(source: AttachmentSource, spent: number): Promise<RemoteUpload & { size: number }> {
  if (!('path' in source)) return { name: source.name, data: source.data, size: Buffer.byteLength(source.data, 'base64') };
  const stat = await fs.promises.stat(source.path);
  if (!stat.isFile()) throw new Error(tr('remote.upload.notFile'));
  if (stat.size > LIMITS.fileBytes || spent + stat.size > REMOTE_UPLOAD_MAX_BYTES) throw new Error(tr('remote.upload.tooBig'));
  return { name: path.basename(source.path), data: (await fs.promises.readFile(source.path)).toString('base64'), size: stat.size };
}

export async function uploadAttachments(remote: Caller, sources: AttachmentSource[]): Promise<AttachmentImportResult> {
  const uploads: RemoteUpload[] = [];
  const errors: AttachmentImportResult['errors'] = [];
  let spent = 0;
  for (const source of Array.isArray(sources) ? sources.slice(0, LIMITS.count) : []) {
    const name = path.basename('path' in source ? source.path : source.name);
    try {
      const { size, ...upload } = await readUpload(source, spent);
      spent += size;
      uploads.push(upload);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      errors.push({ name, message: code === 'ENOENT' ? tr('remote.upload.gone') : code === 'EACCES' || code === 'EPERM' ? tr('remote.upload.unreadable') : (err as Error).message });
    }
  }
  const result = uploads.length ? await remote.call<AttachmentImportResult>('attachments:upload', uploads) : { attachments: [], errors: [] };
  return { attachments: result.attachments, errors: [...errors, ...result.errors] };
}
