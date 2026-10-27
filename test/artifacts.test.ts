// Artifacts: the SigV4 signer against AWS's published example, the local store, and publishing against a fake bucket.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactService } from '../src/agent/artifacts';
import { ObjectStorage } from '../src/agent/storage';
import { EMPTY_PAYLOAD_SHA256, objectUrl, signV4 } from '../src/agent/s3';
import { artifactKey, publishState } from '../src/shared/artifacts';
import { storageUrl } from '../src/shared/storage';

describe('signV4', () => {
  it('matches the GET Object example in the AWS documentation', () => {
    const auth = signV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256, 'x-amz-date': '20130524T000000Z' },
      payloadHash: EMPTY_PAYLOAD_SHA256,
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      amzDate: '20130524T000000Z',
    });
    expect(auth).toContain('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(auth).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date');
  });
});

describe('objectUrl', () => {
  const t = { endpoint: 'https://s3.example.com', region: 'r', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's', pathStyle: true };
  it('builds path-style and virtual-hosted URLs and encodes the key', () => {
    expect(objectUrl(t, 'a b/c.html').href).toBe('https://s3.example.com/b/a%20b/c.html');
    expect(objectUrl({ ...t, pathStyle: false }, 'x/y.html').href).toBe('https://b.s3.example.com/x/y.html');
  });
});

describe('storageUrl / artifactKey / publishState', () => {
  it('joins base, prefix and an encoded key', () => {
    expect(storageUrl({ publicBaseUrl: 'https://cdn.example.com/', prefix: '/pd/' }, artifactKey('demo-1', 'a b/index.html'))).toBe(
      'https://cdn.example.com/pd/artifacts/demo-1/a%20b/index.html',
    );
    expect(storageUrl({ publicBaseUrl: 'https://cdn.example.com', prefix: '' }, artifactKey('demo-1', 'index.html'))).toBe(
      'https://cdn.example.com/artifacts/demo-1/index.html',
    );
  });
  it('tells draft, published and outdated apart', () => {
    expect(publishState({ version: 1, publishedVersion: null })).toBe('draft');
    expect(publishState({ version: 2, publishedVersion: 2 })).toBe('published');
    expect(publishState({ version: 3, publishedVersion: 2 })).toBe('outdated');
  });
});

describe('ArtifactService', () => {
  let tmp: string;
  let storage: ObjectStorage;
  let svc: ArtifactService;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-'));
    storage = new ObjectStorage(path.join(tmp, 'data'));
    svc = new ArtifactService(path.join(tmp, 'data'), storage);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const page = (name: string, html = '<h1>hi</h1>') => {
    const file = path.join(tmp, name);
    fs.writeFileSync(file, html);
    return file;
  };

  it('saves a page, bumps the version on update and keeps the id', () => {
    const a = svc.save({ source: page('hello.html'), title: 'Hello page' });
    expect(a).toMatchObject({ title: 'Hello page', version: 1, files: ['index.html'], publishedVersion: null });
    expect(a.id).toMatch(/^hello-page-[0-9a-f]{4}$/);
    const b = svc.save({ id: a.id, source: page('hello.html', '<h1>v2</h1>') });
    expect(b).toMatchObject({ id: a.id, version: 2, title: 'Hello page' });
    expect(fs.readFileSync(path.join(svc.siteDir(a.id), 'index.html'), 'utf8')).toBe('<h1>v2</h1>');
    expect(svc.list().map((x) => x.id)).toEqual([a.id]);
  });

  it('takes a folder with an index.html, skipping node_modules', () => {
    const dir = path.join(tmp, 'site');
    fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<script src="js/app.js"></script>');
    fs.writeFileSync(path.join(dir, 'js', 'app.js'), '1');
    fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), '2');
    expect(svc.save({ source: dir }).files).toEqual(['index.html', 'js/app.js']);
  });

  it('rejects what is not a page', () => {
    expect(() => svc.save({ source: path.join(tmp, 'missing.html') })).toThrow(/Cannot find/);
    expect(() => svc.save({ source: page('notes.txt') })).toThrow(/not an HTML/);
    const empty = path.join(tmp, 'empty');
    fs.mkdirSync(empty);
    expect(() => svc.save({ source: empty })).toThrow(/index\.html/);
    expect(() => svc.get('../escape')).toThrow(/No artifact/);
  });

  it('refuses to publish until a bucket is configured', async () => {
    const a = svc.save({ source: page('p.html') });
    expect(storage.info().ready).toBe(false);
    await expect(svc.publish(a.id)).rejects.toThrow(/Settings → Storage/);
  });

  describe('publishing to an S3-compatible bucket', () => {
    let server: http.Server;
    let objects: Map<string, { body: string; type: string; auth: string }>;
    beforeEach(async () => {
      objects = new Map();
      server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const key = decodeURIComponent(req.url!.split('?')[0]);
          if (req.method === 'PUT') objects.set(key, { body: Buffer.concat(chunks).toString(), type: String(req.headers['content-type']), auth: String(req.headers.authorization) });
          else if (req.method === 'DELETE') objects.delete(key);
          res.statusCode = req.headers.authorization ? 200 : 403;
          res.end(req.headers.authorization ? '<ListBucketResult/>' : '<Error><Code>AccessDenied</Code><Message>no auth</Message></Error>');
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      storage.save({
        endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, region: 'auto', bucket: 'bkt', accessKeyId: 'AK',
        secretAccessKey: 'SK', publicBaseUrl: 'https://cdn.example.com', prefix: 'pub', pathStyle: true,
      });
    });
    afterEach(() => new Promise<void>((r) => server.close(() => r())));

    it('keeps the secret private and says the storage is ready', () => {
      const info = storage.info();
      expect(info).toMatchObject({ ready: true, secretSet: true, bucket: 'bkt' });
      expect(JSON.stringify(info)).not.toContain('SK');
      // an empty secret in a later save keeps the stored one
      expect(storage.save({ ...info, secretAccessKey: '' }).ready).toBe(true);
    });

    it('uploads with a signature and the right content type, and tests the connection', async () => {
      await storage.test();
      const dir = path.join(tmp, 'site');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'index.html'), '<p>x</p>');
      fs.writeFileSync(path.join(dir, 'a.css'), 'p{}');
      const a = await svc.publish(svc.save({ source: dir, title: 'Site' }).id);
      expect(a.publishedUrl).toBe(`https://cdn.example.com/pub/artifacts/${a.id}/index.html`);
      expect(publishState(a)).toBe('published');
      const html = objects.get(`/bkt/pub/artifacts/${a.id}/index.html`)!;
      expect(html).toMatchObject({ body: '<p>x</p>', type: 'text/html; charset=utf-8' });
      expect(html.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\//);
      expect(objects.get(`/bkt/pub/artifacts/${a.id}/a.css`)!.type).toBe('text/css; charset=utf-8');
    });

    it('removes files an update dropped, and everything on unpublish', async () => {
      const dir = path.join(tmp, 'site');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'index.html'), 'a');
      fs.writeFileSync(path.join(dir, 'old.js'), 'b');
      const { id } = svc.save({ source: dir });
      await svc.publish(id);
      fs.rmSync(path.join(dir, 'old.js'));
      expect(publishState(svc.save({ id, source: dir }))).toBe('outdated');
      await svc.publish(id);
      expect([...objects.keys()]).toEqual([`/bkt/pub/artifacts/${id}/index.html`]);
      await svc.unpublish(id);
      expect(objects.size).toBe(0);
      expect(svc.get(id).publishedUrl).toBeNull();
    });

    it('takes the upload down when the artifact is deleted', async () => {
      const { id } = svc.save({ source: page('d.html') });
      await svc.publish(id);
      await svc.remove(id);
      expect(objects.size).toBe(0);
      expect(svc.list()).toEqual([]);
    });
  });
});
