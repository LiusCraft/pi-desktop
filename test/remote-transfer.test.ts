import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { appUploadsDir } from '../src/agent/app-paths';
import { pruneUploads, readArtifactSite, receiveUploads, transferCall } from '../src/agent/remote/transfer';
import { ArtifactService } from '../src/agent/artifacts';
import { ObjectStorage } from '../src/agent/storage';
import type { AttachmentImportResult, HostInternal } from '../src/shared/protocol';
import { REMOTE_UPLOAD_KEEP_MS, type RemoteTransferMethod, type RemoteTransferResult } from '../src/shared/remote';
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
    if (file.kind !== 'file') throw new Error('Expected a file attachment.');
    expect(fs.readFileSync(file.path, 'utf8')).toBe('hello');
    expect(file.path.startsWith(dir)).toBe(true);
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
    const [file] = result.attachments;
    if (file.kind !== 'file') throw new Error('Expected a file attachment.');
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
      call: async (method: string, ...args: unknown[]): Promise<AttachmentImportResult> => {
        calls.push([method, ...args]);
        return { attachments: [], errors: [] };
      },
    };
    const result = await uploadAttachments(remote, [{ path: file }, { path: path.join(dir, 'missing.txt') }]);
    expect(calls).toEqual([['attachments:upload', [{ name: 'a.txt', data: Buffer.from('abc').toString('base64') }]]]);
    expect(result.errors.map((e) => e.name)).toEqual(['missing.txt']);
  });
});

describe('transferCall', () => {
  it('declares the finite transfer methods and domain replies in the host contract', () => {
    expectTypeOf<Parameters<HostInternal['host:transfer']>[0]>().toEqualTypeOf<RemoteTransferMethod>();
    expectTypeOf<ReturnType<HostInternal['host:transfer']>>().toEqualTypeOf<RemoteTransferResult>();
    expectTypeOf<ReturnType<typeof transferCall>>().toEqualTypeOf<Promise<RemoteTransferResult>>();
  });

  it('dispatches uploads and missing artifact lookups', async () => {
    const result = await transferCall(dir, 'attachments:upload', [
      [{ name: 'notes.txt', data: Buffer.from('hello').toString('base64') }],
    ]);
    expect(result).toMatchObject({ attachments: [{ kind: 'file', name: 'notes.txt' }], errors: [] });
    await expect(transferCall(dir, 'artifacts:site', ['missing', -1])).resolves.toBeNull();
  });
});

describe('readArtifactSite', () => {
  it('returns nothing for an unknown or malformed id', () => {
    expect(readArtifactSite(dir, 'nope', -1)).toBeNull();
    expect(readArtifactSite(dir, '../x', -1)).toBeNull();
  });

  it('returns base64 site files, omitting them only when the client has the current version', async () => {
    const source = path.join(dir, 'page.html');
    fs.writeFileSync(source, '<h1>hello</h1>');
    const service = new ArtifactService(dir, new ObjectStorage(dir));
    const meta = service.save({ source });
    const expected = {
      version: meta.version,
      files: [{ rel: 'index.html', data: Buffer.from('<h1>hello</h1>').toString('base64') }],
    };
    expect(readArtifactSite(dir, meta.id, -1)).toEqual(expected);
    expect(readArtifactSite(dir, meta.id, meta.version)).toEqual({ version: meta.version });
    await expect(transferCall(dir, 'artifacts:site', [meta.id, -1])).resolves.toEqual(expected);
    await expect(transferCall(dir, 'artifacts:site', [meta.id, meta.version])).resolves.toEqual({
      version: meta.version,
    });
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
