import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeBuiltinSkills } from '../src/agent/builtin-skills';
import { scaffoldPlugin, type ScaffoldInput } from '../src/agent/plugin-scaffold';
import { parseDesktopManifest } from '../src/shared/plugin-manifest';
import { setActiveLocale } from '../src/shared/i18n/runtime';

// These assertions read the messages the scaffold writes.
setActiveLocale('zh');

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-plugin-scaffold-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const input = (over: Partial<ScaffoldInput> = {}): ScaffoldInput => ({
  dataDir: root,
  id: 'todo-board',
  title: 'Todo',
  description: 'A board of todos',
  permissions: ['session:read', 'storage', 'host:call'],
  ...over,
});
const packageJson = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

describe('plugin scaffold', () => {
  it('writes a package that already reads as a plugin', () => {
    const made = scaffoldPlugin(input());
    expect(made).toMatchObject({ id: 'todo-board', host: true });
    expect(path.basename(made.dir)).toBe('todo-board');
    expect(parseDesktopManifest(packageJson(made.dir))).toEqual({
      kind: 'ok',
      manifest: {
        apiVersion: 1,
        id: 'todo-board',
        permissions: ['session:read', 'storage', 'host:call'],
        host: 'host.js',
        contributions: { pages: [{ id: 'home', title: 'Todo', entry: 'ui/index.html' }] },
      },
    });
    for (const file of ['host.js', 'ui/index.html', 'ui/page.js', 'ui/page.css']) {
      expect(fs.existsSync(path.join(made.dir, file))).toBe(true);
    }
    // The page talks to the app through the SDK, never through a bridge of its own.
    expect(fs.readFileSync(path.join(made.dir, 'ui/index.html'), 'utf8')).toContain('/sdk/pidesk.js');
  });

  it('leaves the host entry out when the plugin does not ask for one', () => {
    const made = scaffoldPlugin(input({ id: 'static', permissions: ['session:read'] }));
    expect(made.host).toBe(false);
    expect(fs.existsSync(path.join(made.dir, 'host.js'))).toBe(false);
    expect(packageJson(made.dir).piDesktop.host).toBeUndefined();
    expect(fs.readFileSync(path.join(made.dir, 'ui/page.js'), 'utf8')).not.toContain('host.call');
  });

  it('refuses an id that could not be a plugin, and a folder that is already there', () => {
    expect(() => scaffoldPlugin(input({ id: '../escape' }))).toThrow('id 只能用小写字母、数字和 -');
    scaffoldPlugin(input({ id: 'taken' }));
    expect(() => scaffoldPlugin(input({ id: 'taken' }))).toThrow('已经有名为 taken 的插件文件夹');
  });

  it('escapes the title it writes into the page', () => {
    const made = scaffoldPlugin(input({ id: 'quoted', title: '<script>alert(1)</script>' }));
    const html = fs.readFileSync(path.join(made.dir, 'ui/index.html'), 'utf8');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('built-in skills', () => {
  it('writes the authoring skill with its frontmatter, and refreshes a stale copy', () => {
    writeBuiltinSkills(root);
    const file = path.join(root, 'plugin-author', 'SKILL.md');
    const written = fs.readFileSync(file, 'utf8');
    expect(written.startsWith('---\nname: plugin-author\n')).toBe(true);
    expect(written).toContain('pidesk_plugin_create');

    fs.writeFileSync(file, 'old copy');
    writeBuiltinSkills(root);
    expect(fs.readFileSync(file, 'utf8')).toBe(written);
  });
});
