// Read-only, bounded text access for the session's actual cwd (including worktrees).
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const MAX_FILE_BYTES = 1024 * 1024;

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
function readSessionFile(root, rel) {
  if (typeof root !== 'string' || typeof rel !== 'string' || !rel || rel.includes('\0')) throw new Error('Invalid session file path');
  const base = path.resolve(root), absolute = path.resolve(base, rel);
  if (!inside(base, absolute)) throw new Error('Path outside the session');
  const realRoot = fs.realpathSync(base), realFile = fs.realpathSync(absolute);
  if (!inside(realRoot, realFile)) throw new Error('Path outside the session');
  // NONBLOCK prevents special files (e.g. named pipes) from hanging before fstat.
  const fd = fs.openSync(realFile, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    // Recheck after opening, so a swapped symlink cannot supply an outside file.
    const current = fs.realpathSync(absolute);
    if (!inside(realRoot, current) || current !== realFile) throw new Error('Path outside the session');
    const currentStat = fs.statSync(current);
    if (currentStat.dev !== stat.dev || currentStat.ino !== stat.ino) throw new Error('File changed while opening');
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > MAX_FILE_BYTES) return null;
    const content = buffer.subarray(0, length);
    if (content.includes(0)) return null;
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content); }
    catch { return null; }
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { readSessionFile, MAX_FILE_BYTES };
