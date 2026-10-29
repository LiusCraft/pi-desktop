// @ts-nocheck -- ported from untyped JS; these tests feed deliberately malformed input to runtime validators.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll as after, beforeAll as before, describe, it } from 'vitest';
import { MAX_FILE_BYTES, readSessionFile, readSessionImage } from '../src/agent/files';

// Creating symlinks on Windows needs Developer Mode or admin rights.
const canSymlink = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-symlink-probe-'));
  try {
    fs.symlinkSync(dir, path.join(dir, 'link'), 'dir');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

describe('session current-file reader', () => {
  let temp, root, sibling;
  before(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-file-reader-'));
    root = path.join(temp, 'session');
    sibling = path.join(temp, 'session-other');
    fs.mkdirSync(root);
    fs.mkdirSync(sibling);
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
    for (const rel of [
      '../session-other/private.txt',
      path.join(sibling, 'private.txt'),
      'nested/../../session-other/private.txt',
    ]) {
      assert.throws(() => readSessionFile(root, rel), /outside the session/);
    }
    for (const rel of ['', null, 'bad\0path']) assert.throws(() => readSessionFile(root, rel), /Invalid/);
    assert.throws(() => readSessionFile(root, 'missing'), /ENOENT/);
  });
  it.skipIf(!canSymlink)(
    'rejects realpath escapes for file and directory symlinks but allows internal symlinks',
    () => {
      fs.symlinkSync(path.join(sibling, 'private.txt'), path.join(root, 'outside-file'));
      fs.symlinkSync(sibling, path.join(root, 'outside-dir'), 'dir');
      fs.symlinkSync(path.join(root, 'nested/file.txt'), path.join(root, 'inside-file'));
      for (const rel of ['outside-file', 'outside-dir/private.txt'])
        assert.throws(() => readSessionFile(root, rel), /outside the session/);
      assert.equal(readSessionFile(root, 'inside-file'), 'line 1\n你好\n');
      const alias = path.join(temp, 'session-alias');
      fs.symlinkSync(root, alias, 'dir');
      assert.equal(readSessionFile(alias, 'nested/file.txt'), 'line 1\n你好\n');
      assert.throws(() => readSessionFile(alias, 'outside-file'), /outside the session/);
    },
  );
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
    const original = fs.openSync,
      realVictim = fs.realpathSync(victim);
    fs.openSync = function (file, flags, ...rest) {
      if (file === realVictim) {
        fs.unlinkSync(victim);
        fs.symlinkSync(path.join(sibling, 'private.txt'), victim);
      }
      return original.call(fs, file, flags, ...rest);
    };
    try {
      assert.throws(() => readSessionFile(root, 'swapped'));
    } finally {
      fs.openSync = original;
    }
  });
  it('rejects special files without hanging on a named pipe', { skip: process.platform === 'win32' }, () => {
    const fifo = path.join(root, 'pipe');
    execFileSync('mkfifo', [fifo]);
    assert.equal(readSessionFile(root, 'pipe'), null);
  });
});

describe('session image reader', () => {
  let root;
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-image-reader-'));
    fs.writeFileSync(path.join(root, 'shot.png'), png);
    fs.writeFileSync(path.join(root, 'fake.png'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(path.join(root, 'notes.txt'), 'hello');
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it('returns raster images as data URLs typed by their bytes', () => {
    assert.deepEqual(readSessionImage(root, 'shot.png'), {
      mimeType: 'image/png',
      src: `data:image/png;base64,${png.toString('base64')}`,
    });
  });

  it('refuses non-images, disguised files and paths outside the session', () => {
    assert.equal(readSessionImage(root, 'fake.png'), null);
    assert.equal(readSessionImage(root, 'notes.txt'), null);
    assert.throws(() => readSessionImage(root, '../outside.png'), /outside the session/);
  });
});
