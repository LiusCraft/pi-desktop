// Attachment ingestion and prompt validation, done where the pi SDK lives (image
// resizing). No remote downloads or temporary attachment files are ever created.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { convertToPng, resizeImage } from '@earendil-works/pi-coding-agent';
import { LIMITS, validateAttachments, type Attachment, type PromptSubmission } from '@shared/attachments';
import type { AttachmentImportResult, AttachmentSource } from '@shared/protocol';
import { localPath } from './local-path';

export { localPath };

const RASTER_EXT = /\.(?:png|jpe?g|gif|webp|bmp)$/i;
const MIME_EXT: Record<string, string> = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
  '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html', '.svg': 'image/svg+xml',
  '.zip': 'application/zip', '.js': 'text/javascript', '.ts': 'text/plain', '.py': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const INVALID_BASE64 = /[^A-Za-z0-9+/=]/;

export function safeName(value: unknown, fallback = 'Attachment') {
  if (typeof value !== 'string') return fallback;
  return value.replace(/\\/g, '/').split('/').pop()!.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 255) || fallback;
}

export function sniffImage(bytes: Buffer) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && /^(GIF87a|GIF89a)$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 14 && bytes.toString('ascii', 0, 2) === 'BM') return 'image/bmp';
  return null;
}

function decodeBase64(data: unknown, limit: number = LIMITS.fileBytes) {
  if (typeof data !== 'string' || !data || data.length > Math.ceil(limit / 3) * 4 || data.length % 4 || INVALID_BASE64.test(data)) {
    throw new Error('Image data must be raw base64 within the attachment size limit.');
  }
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > limit || bytes.toString('base64') !== data) throw new Error('Invalid or oversized image data.');
  return bytes;
}

async function normalizeImage(bytes: Buffer, mimeType: string) {
  if (mimeType === 'image/bmp') {
    const converted = await convertToPng(bytes.toString('base64'), mimeType);
    if (!converted) throw new Error('This BMP image is damaged or could not be converted.');
    bytes = Buffer.from(converted.data, 'base64');
    mimeType = converted.mimeType;
  }
  const image = await resizeImage(bytes, mimeType, { maxWidth: LIMITS.dimension, maxHeight: LIMITS.dimension, maxBytes: LIMITS.imageBytes });
  if (!image || !image.width || !image.height || image.width > LIMITS.dimension || image.height > LIMITS.dimension) {
    throw new Error('This image is damaged or could not be resized to a supported size.');
  }
  if (image.data.length > LIMITS.imageBytes || sniffImage(Buffer.from(image.data, 'base64')) !== image.mimeType) {
    throw new Error('This image could not be prepared within the 4.5 MiB image limit.');
  }
  return { data: image.data, mimeType: image.mimeType };
}

interface SourceInput {
  name: string;
  path?: string;
  size: number;
  mimeType: string;
  bytes?: Buffer;
}

// Only small headers of ordinary files are read. Image bytes are read through
// the same descriptor that was stat'ed, so replacing a path cannot bypass limits.
async function readSource(source: unknown, remainingBytes: number): Promise<SourceInput> {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Invalid attachment source.');
  const src = source as Record<string, unknown>;
  if (Object.hasOwn(src, 'path')) {
    if (Object.keys(src).some((k) => k !== 'path')) throw new Error('A file source must contain only its path.');
    const abs = localPath(src.path);
    const file = await fs.promises.open(abs, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error('Only regular files can be attached, not folders or special files.');
      if (stat.size > LIMITS.fileBytes) throw new Error('This file exceeds the 20 MiB attachment limit.');
      if (stat.size > remainingBytes) throw new Error('These attachments exceed the 50 MiB total source limit.');
      const header = Buffer.alloc(Math.min(512, stat.size));
      await file.read(header, 0, header.length, 0);
      const mimeType = sniffImage(header);
      const name = safeName(path.basename(abs));
      if (!mimeType) {
        if (RASTER_EXT.test(name)) throw new Error('This image is damaged or is not a supported PNG, JPEG, GIF, WebP, or BMP.');
        return { name, path: abs, size: stat.size, mimeType: MIME_EXT[path.extname(name).toLowerCase()] || 'application/octet-stream' };
      }
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new Error('The file changed while it was being attached. Please try again.');
        offset += bytesRead;
      }
      const after = await file.stat();
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('The file changed while it was being attached. Please try again.');
      return { name, path: abs, size: stat.size, bytes, mimeType };
    } finally {
      await file.close();
    }
  }
  if (Object.keys(src).some((k) => !['name', 'mimeType', 'data'].includes(k))) throw new Error('Invalid image source.');
  if (typeof src.name !== 'string' || typeof src.mimeType !== 'string') throw new Error('An image source needs a name and MIME type.');
  const bytes = decodeBase64(src.data);
  if (bytes.length > remainingBytes) throw new Error('These attachments exceed the 50 MiB total source limit.');
  const mimeType = sniffImage(bytes);
  if (!mimeType) throw new Error('Only valid PNG, JPEG, GIF, WebP, or BMP images can be pasted. HTML and SVG cannot be attached as images.');
  return { name: safeName(src.name, 'Pasted image'), size: bytes.length, bytes, mimeType };
}

export async function importAttachments(sources: AttachmentSource[]): Promise<AttachmentImportResult> {
  const attachments: Attachment[] = [], errors: AttachmentImportResult['errors'] = [];
  if (!Array.isArray(sources)) return { attachments, errors: [{ name: 'Attachments', message: 'Choose a list of files or images to attach.' }] };
  let sourceBytes = 0, imageBytes = 0;
  for (const source of sources.slice(0, LIMITS.count)) {
    const name = safeName((source as any)?.name || (source as any)?.path);
    try {
      const input = await readSource(source, LIMITS.sourceBytes - sourceBytes);
      if (input.bytes) {
        // Images are persisted inline, never as path references.
        const image = await normalizeImage(input.bytes, input.mimeType);
        if (imageBytes + image.data.length > LIMITS.totalImageBytes) throw new Error('These images exceed the 20 MiB total image limit. Remove an image and try again.');
        imageBytes += image.data.length;
        attachments.push({ id: crypto.randomUUID(), kind: 'image', name: input.name, size: input.size, ...image });
      } else {
        attachments.push({ id: crypto.randomUUID(), kind: 'file', name: input.name, size: input.size, mimeType: input.mimeType, path: input.path! });
      }
      sourceBytes += input.size;
    } catch (error: any) {
      const message = error.code === 'ENOENT' ? 'This file no longer exists.'
        : ['EACCES', 'EPERM'].includes(error.code) ? 'This file could not be read. Check its permissions.'
          : error.message || 'This attachment could not be imported.';
      errors.push({ name, message });
    }
  }
  if (sources.length > LIMITS.count) errors.push({ name: 'Attachments', message: `Attach up to ${LIMITS.count} files at a time; the remaining ${sources.length - LIMITS.count} were not imported.` });
  return { attachments, errors };
}

/** Re-check a prompt from the renderer: file refs still match, images are normalized. */
export async function validatePromptPayload(payload: unknown): Promise<PromptSubmission> {
  if (typeof payload === 'string') return { text: payload, attachments: [] };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some((k) => !['text', 'attachments', 'clientId'].includes(k))) throw new Error('Invalid prompt payload.');
  const p = payload as Record<string, unknown>;
  if (typeof p.text !== 'string') throw new Error('Prompt text must be a string.');
  const attachments = validateAttachments(p.attachments ?? []);
  let imageBytes = 0;
  for (const a of attachments) {
    if (a.kind === 'file') {
      localPath(a.path);
      const stat = await fs.promises.stat(a.path);
      if (!stat.isFile()) throw new Error(`${a.name}: only regular files can be attached.`);
      if (stat.size > LIMITS.fileBytes || stat.size !== a.size) throw new Error(`${a.name}: the file changed. Remove it and attach it again.`);
    } else {
      imageBytes += a.data.length;
      if (a.data.length > LIMITS.imageBytes || imageBytes > LIMITS.totalImageBytes) throw new Error('Images exceed the attachment payload size limits.');
      const bytes = decodeBase64(a.data, LIMITS.fileBytes);
      if (sniffImage(bytes) !== a.mimeType) throw new Error(`${a.name}: image data does not match its MIME type.`);
      const checked = await resizeImage(bytes, a.mimeType, { maxWidth: LIMITS.dimension, maxHeight: LIMITS.dimension, maxBytes: LIMITS.imageBytes });
      if (!checked || checked.wasResized || checked.data !== a.data || !checked.width || !checked.height) throw new Error(`${a.name}: image is damaged or is not normalized. Please attach it again.`);
    }
  }
  if (p.clientId !== undefined && (typeof p.clientId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(p.clientId))) throw new Error('Invalid message identifier.');
  return { text: p.text, attachments, ...(p.clientId === undefined ? {} : { clientId: p.clientId as string }) };
}
