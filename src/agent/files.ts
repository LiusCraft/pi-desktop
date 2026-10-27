// Read-only, bounded text access for the session's actual cwd (including worktrees).
import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { findInText, SEARCH_MAX_MATCHES, type SearchResult } from '../shared/text-search';

export const MAX_FILE_BYTES = 1024 * 1024;

export function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

/** Resolve `rel` inside `root`, refusing anything that escapes it. */
export function resolveInside(root: string, rel: string) {
  const base = path.resolve(root), abs = path.resolve(base, rel || '.');
  if (!inside(base, abs)) throw new Error('Path outside the session');
  return abs;
}

/** Bytes of a regular file inside `root`, or null when it is not a file or larger than `max`. */
function readSessionBytes(root: string, rel: string, max: number): Buffer | null {
  if (typeof root !== 'string' || typeof rel !== 'string' || !rel || rel.includes('\0')) throw new Error('Invalid session file path');
  const absolute = resolveInside(root, rel);
  const realRoot = fs.realpathSync(path.resolve(root)), realFile = fs.realpathSync(absolute);
  if (!inside(realRoot, realFile)) throw new Error('Path outside the session');
  // NONBLOCK prevents special files (e.g. named pipes) from hanging before fstat.
  const fd = fs.openSync(realFile, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0) | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max) return null;
    // Recheck after opening, so a swapped symlink cannot supply an outside file.
    const current = fs.realpathSync(absolute);
    if (!inside(realRoot, current) || current !== realFile) throw new Error('Path outside the session');
    const currentStat = fs.statSync(current);
    if (currentStat.dev !== stat.dev || currentStat.ino !== stat.ino) throw new Error('File changed while opening');
    const buffer = Buffer.alloc(max + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    return length > max ? null : buffer.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
}

export function readSessionFile(root: string, rel: string): string | null {
  const content = readSessionBytes(root, rel, MAX_FILE_BYTES);
  if (!content || content.includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content); }
  catch { return null; }
}

/** Files read between breaks that let the host answer other calls. */
const SEARCH_BATCH_FILES = 40;

/** Every line of the given session files that contains `query`; unreadable, binary and oversized files are skipped. */
export async function searchSessionFiles(root: string, paths: string[], query: string, caseSensitive: boolean): Promise<SearchResult> {
  const matches: SearchResult['matches'] = [];
  if (!query) return { matches, truncated: false };
  for (let i = 0; i < paths.length; i++) {
    if (i % SEARCH_BATCH_FILES === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    let text: string | null = null;
    try { text = readSessionFile(root, paths[i]); } catch { /* moved or unreadable since the listing */ }
    if (text === null) continue;
    for (const hit of findInText(text, query, caseSensitive, SEARCH_MAX_MATCHES + 1 - matches.length)) {
      if (matches.length >= SEARCH_MAX_MATCHES) return { matches, truncated: true };
      matches.push({ path: paths[i], ...hit });
    }
  }
  return { matches, truncated: false };
}

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const MAGIC: [string, (b: Buffer) => boolean][] = [
  ['image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/gif', (b) => b.subarray(0, 4).toString('latin1') === 'GIF8'],
  ['image/webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
  ['image/bmp', (b) => b.subarray(0, 2).toString('latin1') === 'BM'],
];

export const isImagePath = (rel: string) => IMAGE_EXTENSIONS.has(path.extname(rel).slice(1).toLowerCase());

/** A raster image inside `root` as a data URL; the bytes, not the extension, decide the type. SVG is never served. */
export function readSessionImage(root: string, rel: string): { mimeType: string; src: string } | null {
  if (!isImagePath(rel)) return null;
  const content = readSessionBytes(root, rel, MAX_IMAGE_BYTES);
  const mimeType = content && MAGIC.find(([, test]) => test(content))?.[0];
  return mimeType ? { mimeType, src: `data:${mimeType};base64,${content!.toString('base64')}` } : null;
}
