import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PluginHosts } from '../src/agent/plugin-host';
import { setActiveLocale } from '../src/shared/i18n/runtime';
import type { DesktopPluginInfo, HostEvent, PluginPermission } from '../src/shared/protocol';

// These assertions read the messages the runtime writes.
setActiveLocale('zh');

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const PERMISSIONS: PluginPermission[] = ['session:read', 'notify', 'storage', 'host:call'];

/** A package folder with a host entry, and the info the registry would report for it. */
function makePlugin(host: string, over: Partial<DesktopPluginInfo> = {}): DesktopPluginInfo {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-plugin-host-'));
  dirs.push(root);
  if (host) fs.writeFileSync(path.join(root, 'host.js'), host, 'utf8');
  return {
    id: `example${dirs.length}`,
    source: 'npm:pi-plugin-example',
    scope: 'user',
    root,
    name: 'example',
    description: '',
    version: '1.0.0',
    permissions: PERMISSIONS,
    host: host ? 'host.js' : null,
    contributions: { pages: [] },
    enabled: true,
    granted: PERMISSIONS,
    ready: true,
    needsGrant: false,
    error: null,
    ...over,
  };
}

/** A runtime over a throwaway data folder, with the events it emits collected. */
function makeHosts(info: DesktopPluginInfo, decision?: { enabled: boolean; granted: PluginPermission[] }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-plugin-data-'));
  dirs.push(dataDir);
  const events: HostEvent[] = [];
  const service = new PluginHosts({
    dataDir,
    decision: () => decision ?? { enabled: true, granted: info.granted },
    emit: (event) => events.push(event),
  });
  return { service, dataDir, events };
}

describe('plugin host entries', () => {
  it('answers the methods the entry registered', async () => {
    const info = makePlugin('export default function (desktop) { desktop.handle("add", (a, b) => a + b); }');
    await expect(makeHosts(info).service.call(info, 'add', [2, 3])).resolves.toBe(5);
  });

  it('says so when the plugin has no such method', async () => {
    const info = makePlugin('export default function (desktop) { desktop.handle("add", () => 1); }');
    await expect(makeHosts(info).service.call(info, 'remove', [])).rejects.toThrow('没有方法 remove');
  });

  it('keeps a key/value store of its own, with or without a host entry', async () => {
    const info = makePlugin('');
    const { service, dataDir } = makeHosts(info);
    await expect(service.call(info, '#storage.get', ['name'])).resolves.toBeNull();
    await expect(service.call(info, '#storage.set', ['name', 'Ada'])).resolves.toBeNull();
    await expect(service.call(info, '#storage.get', ['name'])).resolves.toBe('Ada');
    const file = path.join(dataDir, info.id, 'storage.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ name: 'Ada' });
  });

  it('refuses a plugin the registry says is off', async () => {
    const info = makePlugin('export default function (desktop) { desktop.handle("add", () => 1); }');
    await expect(makeHosts(info, { enabled: false, granted: PERMISSIONS }).service.call(info, 'add', [])).rejects.toThrow('未启用');
  });

  it('refuses a permission the user did not grant', async () => {
    const info = makePlugin('export default function (desktop) { desktop.handle("add", () => 1); }', { granted: ['session:read'] });
    await expect(makeHosts(info).service.call(info, 'add', [])).rejects.toThrow('没有获得');
    await expect(makeHosts(info).service.call(info, '#storage.get', ['name'])).rejects.toThrow('没有获得 storage 权限');
  });

  it('refuses a value that cannot be sent back', async () => {
    const info = makePlugin('export default function (desktop) { desktop.handle("loop", () => { const a = {}; a.self = a; return a; }); }');
    await expect(makeHosts(info).service.call(info, 'loop', [])).rejects.toThrow('无法传递的值');
  });

  it('sends notifications and data to the windows', async () => {
    const info = makePlugin('export default function (desktop) { desktop.handle("go", () => { desktop.notify("done", "warning"); desktop.emit("count", 7); }); }');
    const { service, events } = makeHosts(info);
    await service.call(info, 'go', []);
    expect(events).toEqual([
      { type: 'plugin', pluginId: info.id, event: { kind: 'notify', message: 'done', level: 'warning' } },
      { type: 'plugin', pluginId: info.id, event: { kind: 'data', name: 'count', payload: 7 } },
    ]);
  });

  it('reports an entry that does not export a function', async () => {
    const info = makePlugin('export default 42;');
    await expect(makeHosts(info).service.call(info, 'add', [])).rejects.toThrow('必须默认导出一个函数');
  });
});
