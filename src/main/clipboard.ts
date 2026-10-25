// Clipboard → attachment sources. Called only from an explicit paste; nothing is
// retained or polled, and the files themselves are imported by the agent host.
import { fileURLToPath } from 'node:url';
import { LIMITS } from '@shared/attachments';
import type { AttachmentImportResult, AttachmentSource, ClipboardImportResult } from '@shared/protocol';
import { localPath } from '../agent/local-path';

// Electron 45 exposes native clipboard formats as custom ClipboardItem MIME types.
export function nativeFormat(type: string) {
  const match = /^electron application\/osclipboard;\s*format=(?:"([^"]+)"|([^;]+))$/i.exec(type);
  return (match ? match[1] || match[2] : type).toLowerCase();
}

function pathFromClipboard(value: string, platform: NodeJS.Platform) {
  const text = value.replace(/^﻿/, '').replace(/\0+$/, '').trim();
  try {
    if (/^file:/i.test(text)) {
      const url = new URL(text);
      if (url.hostname && url.hostname.toLowerCase() !== 'localhost') return null;
      if (url.search || url.hash) return null;
      return localPath(fileURLToPath(url, { windows: platform === 'win32' }), platform);
    }
    return localPath(text, platform);
  } catch {
    return null;
  }
}

const XML_ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
function xmlText(text: string) {
  return text.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|amp|lt|gt|quot|apos);/gi, (entity, hex, dec) => {
    if (hex || dec) {
      const n = Number.parseInt(hex || dec, hex ? 16 : 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return XML_ENTITIES[entity.toLowerCase()] || entity;
  });
}

/** Local file paths in one native clipboard format (Finder, Explorer, GTK, uri-list). */
export function clipboardPaths(format: string, bytes: Buffer, platform: NodeJS.Platform = process.platform): string[] {
  const name = nativeFormat(format);
  let values: string[] = [];
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
  return values.map((value) => pathFromClipboard(value, platform)).filter((p): p is string => !!p);
}

function isPathFormat(type: string) {
  return ['public.file-url', 'nsfilenamespboardtype', 'filenamew', 'cf_hdrop', 'text/uri-list', 'x-special/gnome-copied-files'].includes(nativeFormat(type));
}

export interface ClipboardItemLike {
  types: readonly string[];
  getType(type: string): Promise<{ size?: number; arrayBuffer(): Promise<ArrayBuffer> }>;
}

async function clipboardBytes(item: ClipboardItemLike, type: string, maxBytes: number = LIMITS.fileBytes) {
  const blob = await item.getType(type);
  if (!blob || typeof blob.arrayBuffer !== 'function' || (typeof blob.size === 'number' && blob.size > maxBytes)) throw new Error('Clipboard data exceeds the attachment size limit.');
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error('Clipboard data exceeds the attachment size limit.');
  return bytes;
}

export async function clipboardAttachments(
  read: () => Promise<ClipboardItemLike[]>,
  importSources: (sources: AttachmentSource[]) => Promise<AttachmentImportResult>,
): Promise<ClipboardImportResult> {
  const items = await read();
  const paths: string[] = [];
  const errors: AttachmentImportResult['errors'] = [];
  let text = '';
  let hasFiles = false;
  for (const item of items) {
    for (const type of item.types) {
      if (isPathFormat(type)) {
        try {
          const bytes = await clipboardBytes(item, type, 1024 * 1024);
          const format = nativeFormat(type);
          hasFiles ||= format !== 'text/uri-list' || /(?:^|[\r\n])(?:file:|\/|[A-Za-z]:[\\/])/i.test(bytes.toString('utf8'));
          paths.push(...clipboardPaths(type, bytes));
        } catch (error) {
          hasFiles ||= nativeFormat(type) !== 'text/uri-list';
          errors.push({ name: 'Clipboard files', message: (error as Error).message });
        }
      } else if (type.toLowerCase() === 'text/plain' && !text) {
        try {
          text = (await clipboardBytes(item, type, 1024 * 1024)).toString('utf8');
        } catch {}
      }
    }
  }
  // A Finder/Explorer copy often includes a preview image. Use the actual files,
  // even if one fails to import, rather than silently substituting that preview.
  if (hasFiles || paths.length) {
    const result = await importSources([...new Set(paths)].map((p) => ({ path: p })));
    if (!paths.length && !errors.length) errors.push({ name: 'Clipboard files', message: 'No supported local file paths were found. Network files and remote URLs cannot be attached.' });
    return { ...result, hasFiles: true, errors: [...errors, ...result.errors], ...(text ? { text } : {}) };
  }
  const sources: AttachmentSource[] = [];
  for (const item of items) {
    const type = item.types.find((t) => /^image\/(png|jpeg|gif|webp|bmp)$/i.test(t));
    if (!type) continue;
    try {
      const bytes = await clipboardBytes(item, type);
      const ext = type.toLowerCase().split('/')[1].replace('jpeg', 'jpg');
      sources.push({ name: `Pasted image.${ext}`, mimeType: type.toLowerCase(), data: bytes.toString('base64') });
    } catch (error) {
      errors.push({ name: 'Pasted image', message: (error as Error).message });
    }
  }
  const result = await importSources(sources);
  return { ...result, hasFiles: false, errors: [...errors, ...result.errors], ...(text ? { text } : {}) };
}
