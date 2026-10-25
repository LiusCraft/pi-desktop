const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readSessionFile, MAX_FILE_BYTES } = require('../electron/files');

describe('session current-file reader', () => {
  let temp, root, sibling;
  before(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-file-reader-'));
    root = path.join(temp, 'session'); sibling = path.join(temp, 'session-other');
    fs.mkdirSync(root); fs.mkdirSync(sibling);
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, 'nested', 'file.txt'), 'line 1\n你好\n');
    fs.writeFileSync(path.join(sibling, 'private.txt'), 'outside');
  });
  after(() => fs.rmSync(temp, { recursive: true, force: true }));
  it('reads the actual session cwd, preserves empty files and accepts contained absolute paths', () => {
    fs.writeFileSync(path.join(root, 'empty'), '');
    assert.equal(readSessionFile(root, 'empty'), '');
    assert.equal(readSessionFile(root, './nested/../nested/file.txt'), 'line 1\n你好\n');
    assert.equal(readSessionFile(root, path.join(root, 'nested/file.txt')), 'line 1\n你好\n');
    fs.mkdirSync(path.join(temp, 'project'));
    fs.writeFileSync(path.join(temp, 'project', 'same.txt'), 'project version');
    fs.writeFileSync(path.join(root, 'same.txt'), 'worktree version');
    assert.equal(readSessionFile(root, 'same.txt'), 'worktree version');
  });
  it('rejects lexical escapes, sibling-prefix confusion and invalid paths', () => {
    for (const rel of ['../session-other/private.txt', path.join(sibling, 'private.txt'), 'nested/../../session-other/private.txt']) {
      assert.throws(() => readSessionFile(root, rel), /outside the session/);
    }
    for (const rel of ['', null, 'bad\0path']) assert.throws(() => readSessionFile(root, rel), /Invalid/);
    assert.throws(() => readSessionFile(root, 'missing'), /ENOENT/);
  });
  it('rejects realpath escapes for file and directory symlinks but allows internal symlinks', () => {
    fs.symlinkSync(path.join(sibling, 'private.txt'), path.join(root, 'outside-file'));
    fs.symlinkSync(sibling, path.join(root, 'outside-dir'), 'dir');
    fs.symlinkSync(path.join(root, 'nested/file.txt'), path.join(root, 'inside-file'));
    for (const rel of ['outside-file', 'outside-dir/private.txt']) assert.throws(() => readSessionFile(root, rel), /outside the session/);
    assert.equal(readSessionFile(root, 'inside-file'), 'line 1\n你好\n');
    const alias = path.join(temp, 'session-alias');
    fs.symlinkSync(root, alias, 'dir');
    assert.equal(readSessionFile(alias, 'nested/file.txt'), 'line 1\n你好\n');
    assert.throws(() => readSessionFile(alias, 'outside-file'), /outside the session/);
  });
  it('bounds text at 1 MiB and rejects binaries, malformed text and directories', () => {
    fs.writeFileSync(path.join(root, 'at-limit'), Buffer.alloc(MAX_FILE_BYTES, 97));
    fs.writeFileSync(path.join(root, 'too-large'), Buffer.alloc(MAX_FILE_BYTES + 1, 97));
    fs.writeFileSync(path.join(root, 'binary'), Buffer.from([97, 0, 98]));
    fs.writeFileSync(path.join(root, 'invalid-utf8'), Buffer.from([0xff, 0xfe, 0xfd]));
    assert.equal(readSessionFile(root, 'at-limit').length, MAX_FILE_BYTES);
    for (const rel of ['too-large', 'binary', 'invalid-utf8', 'nested']) assert.equal(readSessionFile(root, rel), null);
  });
  it('does not follow a leaf swapped to an outside symlink while opening', () => {
    const victim = path.join(root, 'swapped');
    fs.writeFileSync(victim, 'inside');
    const original = fs.openSync, realVictim = fs.realpathSync(victim);
    fs.openSync = function (file, flags, ...rest) {
      if (file === realVictim) { fs.unlinkSync(victim); fs.symlinkSync(path.join(sibling, 'private.txt'), victim); }
      return original.call(fs, file, flags, ...rest);
    };
    try { assert.throws(() => readSessionFile(root, 'swapped')); }
    finally { fs.openSync = original; }
  });
  it('rejects special files without hanging on a named pipe', { skip: process.platform === 'win32' }, () => {
    const fifo = path.join(root, 'pipe');
    execFileSync('mkfifo', [fifo]);
    assert.equal(readSessionFile(root, 'pipe'), null);
  });
});
