import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appUploadsDir } from '../src/agent/app-paths';
import { pruneUploads, readArtifactSite, receiveUploads } from '../src/agent/remote/transfer';
import { REMOTE_UPLOAD_KEEP_MS } from '../src/shared/remote';
import { uploadAttachments } from '../src/main/remote-upload';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-transfer-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('receiveUploads', () => {
  it('saves a plain file under the uploads folder and attaches it by path', async () => {
    const result = await receiveUploads(dir, [{ name: 'notes.txt', data: Buffer.from('hello').toString('base64') }]);
    expect(result.errors).toEqual([]);
    const [file] = result.attachments;
    expect(file.kind).toBe('file');
    expect(fs.readFileSync((file as { path: string }).path, 'utf8')).toBe('hello');
    expect((file as { path: string }).path.startsWith(dir)).toBe(true);
  });

  it('reports a file that is not valid data and keeps the rest', async () => {
    const result = await receiveUploads(dir, [
      { name: 'bad.txt', data: 42 },
      { name: 'ok.txt', data: Buffer.from('x').toString('base64') },
    ]);
    expect(result.errors.map((e) => e.name)).toEqual(['bad.txt']);
    expect(result.attachments).toHaveLength(1);
  });

  it('never writes outside the uploads folder', async () => {
    const result = await receiveUploads(dir, [{ name: '../../escape.txt', data: Buffer.from('x').toString('base64') }]);
    const [file] = result.attachments as { path: string }[];
    expect(path.basename(file.path)).toBe('escape.txt');
    expect(file.path.startsWith(path.join(dir, 'uploads'))).toBe(true);
  });
});

describe('uploadAttachments', () => {
  it('sends local files as base64 and merges the remote answer with local errors', async () => {
    const file = path.join(dir, 'a.txt');
    fs.writeFileSync(file, 'abc');
    const calls: unknown[][] = [];
    const remote = {
      call: async <T>(method: string, ...args: unknown[]) => (
        calls.push([method, ...args]),
        { attachments: [], errors: [] } as T
      ),
    };
    const result = await uploadAttachments(remote, [{ path: file }, { path: path.join(dir, 'missing.txt') }]);
    expect(calls).toEqual([['attachments:upload', [{ name: 'a.txt', data: Buffer.from('abc').toString('base64') }]]]);
    expect(result.errors.map((e) => e.name)).toEqual(['missing.txt']);
  });
});

describe('readArtifactSite', () => {
  it('returns nothing for an unknown or malformed id', () => {
    expect(readArtifactSite(dir, 'nope', -1)).toBeNull();
    expect(readArtifactSite(dir, '../x', -1)).toBeNull();
  });
});

describe('pruneUploads', () => {
  it('removes upload folders older than the keep time and leaves recent ones', async () => {
    const folder = path.join(appUploadsDir(dir), 'one');
    fs.mkdirSync(folder, { recursive: true });
    await pruneUploads(dir);
    expect(fs.existsSync(folder)).toBe(true);
    await pruneUploads(dir, Date.now() + REMOTE_UPLOAD_KEEP_MS + 60_000);
    expect(fs.existsSync(folder)).toBe(false);
  });
});
