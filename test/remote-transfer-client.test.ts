import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { RemoteClient } from '../src/agent/remote/client';
import { newRemoteToken, RemoteServer, type RemoteBackend } from '../src/agent/remote/server';
import { transferCall } from '../src/agent/remote/transfer';
import { ArtifactService } from '../src/agent/artifacts';
import { ObjectStorage } from '../src/agent/storage';
import { uploadAttachments } from '../src/main/remote-upload';
import type { AttachmentImportResult } from '../src/shared/protocol';
import type { FileAttachment, ImageAttachment } from '../src/shared/attachments';
import type { RemoteArtifactSite } from '../src/shared/remote';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function connect(url: string, token: string): RemoteClient {
  return new RemoteClient({ url, token, onEvent: () => {}, onState: () => {} });
}

async function serve(call: RemoteBackend['call']): Promise<RemoteClient> {
  const token = newRemoteToken();
  const server = new RemoteServer({ token, port: 0, lan: false, backend: { kind: 'plugin', call } });
  await server.start();
  cleanups.push(() => server.stop());
  return connect(`http://127.0.0.1:${server.port}`, token);
}

async function serveRaw(body: string): Promise<RemoteClient> {
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address.');
  return connect(`http://127.0.0.1:${address.port}`, 'test-token');
}

const file: FileAttachment = {
  id: 'file-1',
  kind: 'file',
  name: 'notes.txt',
  mimeType: 'text/plain',
  size: 3,
  path: path.join(os.tmpdir(), 'remote', 'notes.txt'),
};
const image: ImageAttachment = {
  id: 'image-1',
  kind: 'image',
  name: 'dot.png',
  mimeType: 'image/png',
  size: 68,
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
};

describe('remote transfer responses', () => {
  it('round-trips uploads and artifact versions through the real handlers and HTTP client', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-transfer-client-'));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const client = await serve(async (method, args) => {
      if (method !== 'attachments:upload' && method !== 'artifacts:site') throw new Error('Unexpected method.');
      return transferCall(dir, method, args);
    });
    const source = path.join(dir, 'notes.txt');
    fs.writeFileSync(source, 'hello');
    const uploads = await uploadAttachments(client, [{ path: source }, { path: path.join(dir, 'missing.txt') }]);
    expect(uploads.errors.map((error) => error.name)).toEqual(['missing.txt']);
    const [attachment] = uploads.attachments;
    if (attachment.kind !== 'file') throw new Error('Expected a file attachment.');
    expect(fs.readFileSync(attachment.path, 'utf8')).toBe('hello');
    expect(attachment.path).not.toBe(source);

    const page = path.join(dir, 'page.html');
    fs.writeFileSync(page, '<h1>hello</h1>');
    const meta = new ArtifactService(dir, new ObjectStorage(dir)).save({ source: page });
    const site = await client.call('artifacts:site', meta.id, -1);
    expectTypeOf(site).toEqualTypeOf<RemoteArtifactSite | null>();
    expect(site).toEqual({
      version: meta.version,
      files: [{ rel: 'index.html', data: Buffer.from('<h1>hello</h1>').toString('base64') }],
    });
    await expect(client.call('artifacts:site', meta.id, meta.version)).resolves.toEqual({ version: meta.version });
    await expect(client.call('artifacts:site', 'missing', -1)).resolves.toBeNull();
  });

  it('accepts both attachment variants and preserves remote per-file errors', async () => {
    const reply: AttachmentImportResult = {
      attachments: [file, image],
      errors: [{ name: 'bad.txt', message: 'Could not read file.' }],
    };
    const client = await serve(async () => reply);
    const result = await client.call('attachments:upload', []);
    expectTypeOf(result).toEqualTypeOf<AttachmentImportResult>();
    expect(result).toEqual(reply);
  });

  it.each([
    { name: 'null upload reply', value: null },
    { name: 'array upload reply', value: [] },
    { name: 'wrong method reply', value: { version: 1 } },
    { name: 'missing attachments', value: { errors: [] } },
    { name: 'missing errors', value: { attachments: [] } },
    { name: 'non-array errors', value: { attachments: [], errors: {} } },
    { name: 'null error', value: { attachments: [], errors: [null] } },
    { name: 'non-string error name', value: { attachments: [], errors: [{ name: 42, message: 'bad' }] } },
    { name: 'missing error message', value: { attachments: [], errors: [{ name: 'bad.txt' }] } },
    { name: 'non-array attachments', value: { attachments: {}, errors: [] } },
    { name: 'incomplete file', value: { attachments: [{ kind: 'file' }], errors: [] } },
    { name: 'relative file path', value: { attachments: [{ ...file, path: 'relative.txt' }], errors: [] } },
    { name: 'invalid file size', value: { attachments: [{ ...file, size: '3' }], errors: [] } },
    { name: 'invalid image bytes', value: { attachments: [{ ...image, data: 'not base64' }], errors: [] } },
  ])('rejects $name at the HTTP boundary, even with an explicit type argument', async ({ value }) => {
    const client = await serve(async () => value);
    await expect(client.call<AttachmentImportResult>('attachments:upload', [])).rejects.toThrow(Error);
  });

  it.each([
    { name: 'primitive site', value: 'site' },
    { name: 'array site', value: [] },
    { name: 'wrong method reply', value: { attachments: [], errors: [] } },
    { name: 'missing version', value: { files: [] } },
    { name: 'string version', value: { version: '1' } },
    { name: 'zero version', value: { version: 0 } },
    { name: 'negative version', value: { version: -1 } },
    { name: 'fractional version', value: { version: 1.5 } },
    { name: 'unsafe version', value: { version: Number.MAX_SAFE_INTEGER + 1 } },
    { name: 'null files', value: { version: 1, files: null } },
    { name: 'non-array files', value: { version: 1, files: {} } },
    { name: 'null file', value: { version: 1, files: [null] } },
    { name: 'missing file path', value: { version: 1, files: [{ data: 'YQ==' }] } },
    { name: 'empty file path', value: { version: 1, files: [{ rel: '', data: 'YQ==' }] } },
    { name: 'non-string file data', value: { version: 1, files: [{ rel: 'index.html', data: 42 }] } },
  ])('rejects $name before returning an artifact site', async ({ value }) => {
    const client = await serve(async () => value);
    await expect(client.call('artifacts:site', 'page', -1)).rejects.toThrow(/Invalid remote artifact/);
  });

  it.each([
    'not JSON',
    'null',
    '[]',
    '{}',
    '{"ok":"true","value":null}',
    '{"ok":true}',
    '{"ok":false}',
    '{"ok":false,"error":42}',
  ])('rejects a malformed RPC envelope: %s', async (body) => {
    const client = await serveRaw(body);
    await expect(client.call('artifacts:site', 'page', -1)).rejects.toThrow(/invalid.*RPC response/i);
  });

  it('preserves a remote RPC failure instead of trying to decode it as a transfer result', async () => {
    const client = await serve(async () => {
      throw new Error('Transfer failed.');
    });
    await expect(client.call('attachments:upload', [])).rejects.toThrow('Transfer failed.');
  });
});
