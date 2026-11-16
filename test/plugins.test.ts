import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DesktopPlugins, type PluginPackage } from '../src/agent/plugins';
import { setActiveLocale } from '../src/shared/i18n/runtime';
import type { PluginPermission } from '../src/shared/protocol';

// These assertions read the messages the registry writes.
setActiveLocale('zh');

let root: string;
let file: string;
/** What the hub would hand in: the configured packages, by project. */
let packages: PluginPackage[];

const manifest = (over: Record<string, unknown> = {}) => ({
  apiVersion: 1,
  id: 'inbox',
  permissions: ['session:read', 'notify'],
  contributions: { pages: [{ id: 'inbox', title: 'Inbox', entry: 'ui/index.html' }] },
  ...over,
});

/** A package folder with a package.json and, unless told otherwise, the page it names. */
function makePackage(name: string, piDesktop: unknown, { page = true } = {}): string {
  const dir = path.join(root, name);
  // A fresh folder: an earlier test may have left a page this one says is missing.
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.2.3', description: `${name} description`, piDesktop }));
  if (page) fs.writeFileSync(path.join(dir, 'ui', 'index.html'), '<!doctype html><title>Inbox</title>');
  return dir;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-plugins-'));
  file = path.join(root, 'data', 'plugins.json');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  fs.rmSync(path.join(root, 'data'), { recursive: true, force: true });
  packages = [];
});

const service = () => new DesktopPlugins({ file, packages: () => packages });
const one = (list: ReturnType<DesktopPlugins['list']>) => {
  expect(list).toHaveLength(1);
  return list[0];
};

describe('desktop plugins', () => {
  it('lists a package that declares piDesktop, off until it is enabled', () => {
    packages = [{ source: 'npm:pi-plugin-inbox', scope: 'user', root: makePackage('inbox', manifest()) }];
    const plugin = one(service().list(null));
    expect(plugin).toMatchObject({
      id: 'inbox', name: 'inbox', version: '1.2.3', description: 'inbox description',
      source: 'npm:pi-plugin-inbox', scope: 'user',
      permissions: ['session:read', 'notify'], enabled: false, ready: false, needsGrant: false, error: null,
    });
    expect(plugin.contributions.pages.map((p) => p.title)).toEqual(['Inbox']);
  });

  it('ignores packages without a manifest and packages that are not installed', () => {
    packages = [
      { source: 'npm:pi-lens', scope: 'user', root: makePackage('lens', undefined) },
      { source: 'git:github.com/user/repo', scope: 'user', root: null },
    ];
    expect(service().list(null)).toEqual([]);
  });

  it('turns one on only with the permissions it asks for', () => {
    packages = [{ source: 'npm:pi-plugin-inbox', scope: 'user', root: makePackage('inbox', manifest()) }];
    const plugins = service();
    expect(() => plugins.setEnabled(null, 'inbox', true, [])).toThrow('启用时要一并确认它申请的权限');
    expect(() => plugins.setEnabled(null, 'inbox', true, ['session:read'])).toThrow('启用时要一并确认它申请的权限');
    const on = one(plugins.setEnabled(null, 'inbox', true, ['session:read', 'notify']));
    expect(on).toMatchObject({ enabled: true, ready: true, granted: ['session:read', 'notify'] });
    // The registry is the only state: a second service reads the same answer back.
    expect(one(service().list(null))).toMatchObject({ enabled: true, ready: true });
    expect(one(service().setEnabled(null, 'inbox', false, null))).toMatchObject({ enabled: false, ready: false, granted: ['session:read', 'notify'] });
  });

  it('stops being ready when an upgrade asks for more than the user agreed to', () => {
    const dir = makePackage('inbox', manifest());
    packages = [{ source: 'npm:pi-plugin-inbox', scope: 'user', root: dir }];
    service().setEnabled(null, 'inbox', true, ['session:read', 'notify']);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'inbox', piDesktop: manifest({ permissions: ['session:read', 'notify', 'storage'] }) }));
    expect(one(service().list(null))).toMatchObject({ enabled: true, ready: false, needsGrant: true });
    // Agreeing again is what clears it.
    expect(one(service().setEnabled(null, 'inbox', true, ['session:read', 'notify', 'storage']))).toMatchObject({ ready: true, needsGrant: false });
  });

  it('reports a package whose page is missing instead of loading it', () => {
    packages = [{ source: 'npm:pi-plugin-inbox', scope: 'user', root: makePackage('inbox', manifest(), { page: false }) }];
    const plugin = one(service().list(null));
    expect(plugin.error).toBe('找不到入口文件：ui/index.html');
    expect(plugin.ready).toBe(false);
    expect(() => service().setEnabled(null, 'inbox', true, ['session:read', 'notify'])).toThrow('找不到入口文件');
    // It can still be turned off, so a package that broke after being enabled does not stay stuck on.
    expect(one(service().setEnabled(null, 'inbox', false, null))).toMatchObject({ enabled: false });
  });

  it('reports a manifest it cannot read, and keeps it out of the way', () => {
    packages = [{ source: 'npm:pi-plugin-inbox', scope: 'user', root: makePackage('inbox', manifest({ apiVersion: 9 })) }];
    const plugin = one(service().list(null));
    expect(plugin.error).toBe('需要更新的 Pi Desktop（manifest v9）');
    // Its id is unusable, so the row is keyed by the package name.
    expect(plugin.id).toBe('inbox');
  });

  it('lets the first package keep an id two of them claim', () => {
    packages = [
      { source: 'npm:a', scope: 'user', root: makePackage('a', manifest()) },
      { source: 'npm:b', scope: 'user', root: makePackage('b', manifest()) },
    ];
    const list = service().list(null);
    expect(list.map((p) => [p.source, p.error])).toEqual([['npm:a', null], ['npm:b', 'inbox 已被 npm:a 使用']]);
  });

  it('keeps a project package out of another project’s list', () => {
    packages = [{ source: 'npm:pi-plugin-inbox', scope: 'project', root: makePackage('inbox', manifest()) }];
    expect(service().list('/some/project')).toHaveLength(1);
    packages = [];
    expect(service().list('/other/project')).toEqual([]);
  });

  it('survives a broken registry file', () => {
    packages = [{ source: 'npm:pi-plugin-inbox', scope: 'user', root: makePackage('inbox', manifest()) }];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json');
    expect(one(service().list(null))).toMatchObject({ enabled: false });
    const granted: PluginPermission[] = ['session:read', 'notify'];
    expect(one(service().setEnabled(null, 'inbox', true, granted))).toMatchObject({ enabled: true });
  });

  it('says so when asked about a plugin that is not there', () => {
    expect(() => service().setEnabled(null, 'missing', true, [])).toThrow('没有桌面插件 missing');
  });
});
