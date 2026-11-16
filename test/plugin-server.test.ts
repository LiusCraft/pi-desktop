import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PluginServer } from '../src/main/plugins';
import { setActiveLocale } from '../src/shared/i18n/runtime';
import type { DesktopPluginInfo, JsonValue } from '../src/shared/protocol';

// These assertions read the messages the server writes.
setActiveLocale('zh');

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makePlugin(over: Partial<DesktopPluginInfo> = {}): DesktopPluginInfo {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-plugin-serve-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ui', 'index.html'), '<!doctype html><title>Example</title>');
  fs.writeFileSync(path.join(root, 'ui', 'page.js'), 'console.log(1);');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'not for pages');
  return {
    id: 'example',
    source: 'npm:pi-plugin-example',
    scope: 'user',
    root,
    name: 'example',
    description: '',
    version: '1.0.0',
    permissions: ['host:call'],
    host: null,
    contributions: { pages: [{ id: 'home', title: 'Example', entry: 'ui/index.html' }] },
    enabled: true,
    granted: ['host:call'],
    ready: true,
    needsGrant: false,
    error: null,
    ...over,
  };
}

function makeServer(info: DesktopPluginInfo, call?: (method: string, args: unknown[]) => Promise<JsonValue>) {
  const server = new PluginServer({ call: async (_plugin, method, args) => (call ? call(method, args) : null) });
  server.remember([info]);
  return server;
}

describe('plugin file server', () => {
  it('serves a page of the package with a content type and a CSP', async () => {
    const server = makeServer(makePlugin());
    const response = server.handle('pidesk-plugin://example/ui/index.html');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'none'");
    expect(await response.text()).toContain('Example');
  });

  it('serves the shared SDK to every plugin', async () => {
    const server = makeServer(makePlugin());
    const response = server.handle('pidesk-plugin://example/sdk/pidesk.js');
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await response.text()).toContain('window.pidesk');
  });

  it('serves nothing outside the package, or for a plugin it does not know', async () => {
    const server = makeServer(makePlugin());
    // An encoded `..` survives URL normalization and is refused after decoding.
    expect(server.handle('pidesk-plugin://example/%2e%2e%2fsecret.txt').status).toBe(404);
    expect(server.handle('pidesk-plugin://example/secret.txt').status).toBe(200);
    expect(server.handle('pidesk-plugin://other/ui/index.html').status).toBe(404);
    expect(server.handle('pidesk-plugin://example/ui/missing.js').status).toBe(404);
    expect(server.handle('pidesk-plugin://example/').status).toBe(404);
    expect(server.handle('not a url').status).toBe(404);
  });

  it('relays a call only for a plugin that is ready', async () => {
    const info = makePlugin();
    const seen: [string, unknown[]][] = [];
    const server = makeServer(info, async (method, args) => {
      seen.push([method, args]);
      return 'ok';
    });
    await expect(server.call('example', 'greet', ['Ada'])).resolves.toBe('ok');
    expect(seen).toEqual([['greet', ['Ada']]]);
    await expect(server.call('other', 'greet', [])).rejects.toThrow('未知插件 other');
    await expect(server.call('example', '', [])).rejects.toThrow('方法名');

    const off = makeServer(makePlugin({ ready: false }));
    await expect(off.call('example', 'greet', [])).rejects.toThrow('还没准备好');
  });

  it('keeps serving a plugin that a later listing did not mention', async () => {
    // Listings are per project, so a page may still be open for a plugin another listing left out.
    const server = makeServer(makePlugin());
    server.remember([makePlugin({ id: 'other' })]);
    expect(server.handle('pidesk-plugin://example/ui/index.html').status).toBe(200);
  });
});
