// Attachment ingestion lives in the main process. No clipboard polling, renderer
// filesystem access, remote downloads, or temporary attachment files are needed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { LIMITS, validateAttachments } = require('../renderer/attachments');

let imageSdk;
const getImageSdk = () => (imageSdk ||= import('@earendil-works/pi-coding-agent'));
const RASTER_EXT = /\.(?:png|jpe?g|gif|webp|bmp)$/i;
const MIME_EXT = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
  '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html', '.svg': 'image/svg+xml',
  '.zip': 'application/zip', '.js': 'text/javascript', '.ts': 'text/plain', '.py': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const INVALID_BASE64 = /[^A-Za-z0-9+/=]/;

function safeName(value, fallback = 'Attachment') {
  if (typeof value !== 'string') return fallback;
  return value.replace(/\\/g, '/').split('/').pop().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 255) || fallback;
}
function localPath(value, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (typeof value !== 'string' || !value || value.includes('\0') || /^[/\\]{2}/.test(value) || !paths.isAbsolute(value) || (platform === 'win32' && !/^[A-Za-z]:[/\\]/.test(value))) {
    throw new Error('Choose a local file with an absolute path; network paths and URLs are not supported.');
  }
  return paths.normalize(value);
}
function sniffImage(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && /^(GIF87a|GIF89a)$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 14 && bytes.toString('ascii', 0, 2) === 'BM') return 'image/bmp';
  return null;
}
function decodeBase64(data, limit = LIMITS.fileBytes) {
  if (typeof data !== 'string' || !data || data.length > Math.ceil(limit / 3) * 4 || data.length % 4 || INVALID_BASE64.test(data)) {
    throw new Error('Image data must be raw base64 within the attachment size limit.');
  }
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > limit || bytes.toString('base64') !== data) throw new Error('Invalid or oversized image data.');
  return bytes;
}
async function normalizeImage(bytes, mimeType) {
  const sdk = await getImageSdk();
  if (mimeType === 'image/bmp') {
    const converted = await sdk.convertToPng(bytes.toString('base64'), mimeType);
    if (!converted) throw new Error('This BMP image is damaged or could not be converted.');
    bytes = Buffer.from(converted.data, 'base64');
    mimeType = converted.mimeType;
  }
  const image = await sdk.resizeImage(bytes, mimeType, {
    maxWidth: LIMITS.dimension, maxHeight: LIMITS.dimension, maxBytes: LIMITS.imageBytes,
  });
  if (!image || !image.width || !image.height || image.width > LIMITS.dimension || image.height > LIMITS.dimension) {
    throw new Error('This image is damaged or could not be resized to a supported size.');
  }
  if (image.data.length > LIMITS.imageBytes || sniffImage(Buffer.from(image.data, 'base64')) !== image.mimeType) {
    throw new Error('This image could not be prepared within the 4.5 MiB image limit.');
  }
  return { data: image.data, mimeType: image.mimeType };
}

// Only small headers of ordinary files are read. Image bytes are read through
// the same descriptor that was stat'ed, so replacing a path cannot bypass limits.
async function readSource(source, remainingBytes) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Invalid attachment source.');
  if (Object.hasOwn(source, 'path')) {
    if (Object.keys(source).some((k) => k !== 'path')) throw new Error('A file source must contain only its path.');
    const abs = localPath(source.path);
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
  if (Object.keys(source).some((k) => !['name', 'mimeType', 'data'].includes(k))) throw new Error('Invalid image source.');
  if (typeof source.name !== 'string' || typeof source.mimeType !== 'string') throw new Error('An image source needs a name and MIME type.');
  const bytes = decodeBase64(source.data);
  if (bytes.length > remainingBytes) throw new Error('These attachments exceed the 50 MiB total source limit.');
  const mimeType = sniffImage(bytes);
  if (!mimeType) throw new Error('Only valid PNG, JPEG, GIF, WebP, or BMP images can be pasted. HTML and SVG cannot be attached as images.');
  return { name: safeName(source.name, 'Pasted image'), size: bytes.length, bytes, mimeType };
}

async function importAttachments(sources) {
  const attachments = [], errors = [];
  if (!Array.isArray(sources)) return { attachments, errors: [{ name: 'Attachments', message: 'Choose a list of files or images to attach.' }] };
  let sourceBytes = 0, imageBytes = 0;
  for (const source of sources.slice(0, LIMITS.count)) {
    const name = safeName(source?.name || source?.path);
    try {
      const input = await readSource(source, LIMITS.sourceBytes - sourceBytes);
      const { bytes, ...descriptor } = input;
      if (bytes) {
        delete descriptor.path; // Images are persisted inline, never as path references.
        const image = await normalizeImage(bytes, input.mimeType);
        if (imageBytes + image.data.length > LIMITS.totalImageBytes) throw new Error('These images exceed the 20 MiB total image limit. Remove an image and try again.');
        Object.assign(descriptor, image);
        imageBytes += image.data.length;
      }
      sourceBytes += input.size;
      attachments.push({ id: crypto.randomUUID(), kind: bytes ? 'image' : 'file', ...descriptor });
    } catch (error) {
      const message = error.code === 'ENOENT' ? 'This file no longer exists.'
        : ['EACCES', 'EPERM'].includes(error.code) ? 'This file could not be read. Check its permissions.'
          : error.message || 'This attachment could not be imported.';
      errors.push({ name, message });
    }
  }
  if (sources.length > LIMITS.count) errors.push({ name: 'Attachments', message: `Attach up to ${LIMITS.count} files at a time; the remaining ${sources.length - LIMITS.count} were not imported.` });
  return { attachments, errors };
}

async function pickAttachments(dialog, win) {
  const result = await dialog.showOpenDialog(win, { title: 'Add attachments', properties: ['openFile', 'multiSelections'] });
  return result.canceled ? { attachments: [], errors: [] } : importAttachments(result.filePaths.map((p) => ({ path: p })));
}

// Electron 45 exposes native clipboard formats as custom ClipboardItem MIME types.
function nativeFormat(type) {
  const match = /^electron application\/osclipboard;\s*format=(?:"([^"]+)"|([^;]+))$/i.exec(type);
  return (match ? match[1] || match[2] : type).toLowerCase();
}
function pathFromClipboard(value, platform) {
  const text = value.replace(/^﻿/, '').replace(/\0+$/, '').trim();
  try {
    if (/^file:/i.test(text)) {
      const url = new URL(text);
      if (url.hostname && url.hostname.toLowerCase() !== 'localhost') return null;
      if (url.search || url.hash) return null;
      return localPath(fileURLToPath(url, { windows: platform === 'win32' }), platform);
    }
    return localPath(text, platform);
  } catch { return null; }
}
function xmlText(text) {
  return text.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|amp|lt|gt|quot|apos);/gi, (entity, hex, dec) => {
    if (hex || dec) {
      const n = Number.parseInt(hex || dec, hex ? 16 : 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[entity.toLowerCase()] || entity;
  });
}
function clipboardPaths(format, bytes, platform = process.platform) {
  const name = nativeFormat(format);
  let values = [];
  if (name === 'nsfilenamespboardtype') {
    const xml = bytes.toString('utf8');
    // Never evaluate a plist or resolve its external DTD. Finder's XML string
    // array is all that is needed; unsupported binary plists remain untrusted.
    if (/<plist[\s>]/i.test(xml) && /<array[\s>]/i.test(xml)) values = [...xml.matchAll(/<string(?:\s[^>]*)?>([\s\S]*?)<\/string>/gi)].map((m) => xmlText(m[1]));
  } else if (name === 'filenamew' || name === 'cf_hdrop') {
    let offset = 0, wide = true;
    if (name === 'cf_hdrop') {
      if (bytes.length < 20) return [];
      offset = bytes.readUInt32LE(0);
      wide = bytes.readUInt32LE(16) !== 0;
      if (offset < 20 || offset >= bytes.length || (wide && offset % 2)) return [];
    }
    values = bytes.subarray(offset).toString(wide ? 'utf16le' : 'latin1').split('\0');
  } else if (['public.file-url', 'text/uri-list', 'x-special/gnome-copied-files'].includes(name)) {
    values = bytes.toString('utf8').split(/[\r\n\0]+/).filter((v) => v && !v.startsWith('#') && !/^(copy|cut)$/.test(v));
  }
  return values.map((value) => pathFromClipboard(value, platform)).filter(Boolean);
}
function isPathFormat(type) {
  return ['public.file-url', 'nsfilenamespboardtype', 'filenamew', 'cf_hdrop', 'text/uri-list', 'x-special/gnome-copied-files'].includes(nativeFormat(type));
}
async function clipboardBytes(item, type, maxBytes = LIMITS.fileBytes) {
  const blob = await item.getType(type);
  if (!blob || typeof blob.arrayBuffer !== 'function' || (typeof blob.size === 'number' && blob.size > maxBytes)) throw new Error('Clipboard data exceeds the attachment size limit.');
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error('Clipboard data exceeds the attachment size limit.');
  return bytes;
}
async function clipboardAttachments(clipboard) {
  // Called only from an explicit paste action. Do not retain ClipboardItems.
  const items = await clipboard.read();
  const paths = [], errors = [];
  let text = '', hasFiles = false;
  for (const item of items) {
    for (const type of item.types) {
      if (isPathFormat(type)) {
        try {
          const bytes = await clipboardBytes(item, type, 1024 * 1024);
          const format = nativeFormat(type);
          const isFiles = format !== 'text/uri-list' || /(?:^|[\r\n])(?:file:|\/|[A-Za-z]:[\\/])/i.test(bytes.toString('utf8'));
          hasFiles ||= isFiles;
          paths.push(...clipboardPaths(type, bytes));
        } catch (error) {
          hasFiles ||= nativeFormat(type) !== 'text/uri-list';
          errors.push({ name: 'Clipboard files', message: error.message });
        }
      } else if (type.toLowerCase() === 'text/plain' && !text) {
        try { text = (await clipboardBytes(item, type, 1024 * 1024)).toString('utf8'); } catch {}
      }
    }
  }
  // A Finder/Explorer copy often includes a preview image. Use the actual files,
  // even if one fails to import, rather than silently substituting that preview.
  if (hasFiles || paths.length) {
    const result = await importAttachments([...new Set(paths)].map((p) => ({ path: p })));
    if (!paths.length && !errors.length) errors.push({ name: 'Clipboard files', message: 'No supported local file paths were found. Network files and remote URLs cannot be attached.' });
    return { ...result, hasFiles: true, errors: [...errors, ...result.errors], ...(text ? { text } : {}) };
  }
  const sources = [];
  for (const item of items) {
    const type = item.types.find((t) => /^image\/(png|jpeg|gif|webp|bmp)$/i.test(t));
    if (!type) continue;
    try {
      const bytes = await clipboardBytes(item, type);
      sources.push({ name: `Pasted image.${type.toLowerCase().split('/')[1].replace('jpeg', 'jpg')}`, mimeType: type.toLowerCase(), data: bytes.toString('base64') });
    } catch (error) { errors.push({ name: 'Pasted image', message: error.message }); }
  }
  const result = await importAttachments(sources);
  return { ...result, hasFiles: false, errors: [...errors, ...result.errors], ...(text ? { text } : {}) };
}

async function validatePromptPayload(payload) {
  if (typeof payload === 'string') return { text: payload, attachments: [] };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some((k) => !['text', 'attachments', 'clientId'].includes(k))) throw new Error('Invalid prompt payload.');
  if (typeof payload.text !== 'string') throw new Error('Prompt text must be a string.');
  const attachments = payload.attachments ?? [];
  validateAttachments(attachments);
  let imageBytes = 0;
  for (const a of attachments) {
    if (a.path) localPath(a.path);
    if (a.kind === 'file') {
      const stat = await fs.promises.stat(a.path);
      if (!stat.isFile()) throw new Error(`${a.name}: only regular files can be attached.`);
      if (stat.size > LIMITS.fileBytes || stat.size !== a.size) throw new Error(`${a.name}: the file changed. Remove it and attach it again.`);
    } else {
      imageBytes += a.data.length;
      if (a.data.length > LIMITS.imageBytes || imageBytes > LIMITS.totalImageBytes) throw new Error('Images exceed the attachment payload size limits.');
      const bytes = decodeBase64(a.data, LIMITS.fileBytes);
      if (sniffImage(bytes) !== a.mimeType) throw new Error(`${a.name}: image data does not match its MIME type.`);
      const sdk = await getImageSdk();
      const checked = await sdk.resizeImage(bytes, a.mimeType, { maxWidth: LIMITS.dimension, maxHeight: LIMITS.dimension, maxBytes: LIMITS.imageBytes });
      if (!checked || checked.wasResized || checked.data !== a.data || !checked.width || !checked.height) throw new Error(`${a.name}: image is damaged or is not normalized. Please attach it again.`);
    }
  }
  if (payload.clientId !== undefined && (typeof payload.clientId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.clientId))) throw new Error('Invalid message identifier.');
  return { text: payload.text, attachments, ...(payload.clientId === undefined ? {} : { clientId: payload.clientId }) };
}

module.exports = { importAttachments, pickAttachments, clipboardAttachments, validatePromptPayload, clipboardPaths, sniffImage };
