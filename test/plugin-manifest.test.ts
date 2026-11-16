import { beforeAll, describe, expect, it } from 'vitest';
import { insidePath, isInsidePackage, parseDesktopManifest } from '../src/shared/plugin-manifest';
import { setActiveLocale } from '../src/shared/i18n/runtime';

// These assertions read the messages the parser writes.
setActiveLocale('zh');
beforeAll(() => setActiveLocale('zh'));

/** The shortest valid section, spread into the cases that change one field. */
const base = {
  apiVersion: 1,
  id: 'inbox',
  permissions: ['session:read'],
  contributions: { pages: [{ id: 'inbox', title: 'Inbox', entry: 'ui/index.html' }] },
};

const parse = (piDesktop: unknown) => parseDesktopManifest({ name: 'pkg', piDesktop });

describe('plugin manifest', () => {
  it('treats a package without piDesktop as no plugin at all', () => {
    expect(parseDesktopManifest({ name: 'pkg' })).toEqual({ kind: 'none' });
    expect(parseDesktopManifest({ name: 'pkg', pi: { extensions: ['./host.js'] } })).toEqual({ kind: 'none' });
  });

  it('reads a valid section', () => {
    const result = parse(base);
    expect(result).toEqual({
      kind: 'ok',
      manifest: {
        apiVersion: 1,
        id: 'inbox',
        permissions: ['session:read'],
        host: null,
        contributions: { pages: [{ id: 'inbox', title: 'Inbox', entry: 'ui/index.html' }] },
      },
    });
  });

  it('defaults permissions and pages to empty', () => {
    const result = parse({ apiVersion: 1, id: 'inbox' });
    expect(result).toEqual({
      kind: 'ok',
      manifest: { apiVersion: 1, id: 'inbox', permissions: [], host: null, contributions: { pages: [] } },
    });
  });

  it('drops duplicate permissions', () => {
    const result = parse({ ...base, permissions: ['notify', 'notify', 'session:read'] });
    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' && result.manifest.permissions).toEqual(['notify', 'session:read']);
  });

  it('rejects a version it does not know', () => {
    expect(parse({ ...base, apiVersion: 2 })).toEqual({ kind: 'error', error: '需要更新的 Pi Desktop（manifest v2）' });
    expect(parse({ ...base, apiVersion: undefined })).toEqual({ kind: 'error', error: 'apiVersion 必须是 1' });
    expect(parse({ ...base, apiVersion: 1.5 })).toEqual({ kind: 'error', error: 'apiVersion 必须是 1' });
  });

  it('rejects a section that is not an object', () => {
    expect(parse('yes')).toEqual({ kind: 'error', error: 'piDesktop 必须是对象' });
    expect(parse([])).toEqual({ kind: 'error', error: 'piDesktop 必须是对象' });
  });

  it('rejects an id the protocol could not carry', () => {
    expect(parse({ ...base, id: 'GitHub_Inbox' })).toEqual({
      kind: 'error',
      error: 'id 只能用小写字母、数字和 -：GitHub_Inbox',
    });
    expect(parse({ ...base, id: undefined })).toEqual({
      kind: 'error',
      error: 'id 只能用小写字母、数字和 -：undefined',
    });
  });

  it('rejects an unknown permission', () => {
    expect(parse({ ...base, permissions: ['shell:any'] })).toEqual({ kind: 'error', error: '未知权限：shell:any' });
    expect(parse({ ...base, permissions: 'notify' })).toEqual({ kind: 'error', error: '未知权限：notify' });
  });

  it('keeps every entry inside the package', () => {
    expect(isInsidePackage('ui/index.html')).toBe(true);
    expect(insidePath('./ui/index.html')).toBe('ui/index.html');
    expect(isInsidePackage('../outside.html')).toBe(false);
    expect(isInsidePackage('/etc/passwd')).toBe(false);
    expect(isInsidePackage('ui/../../x.html')).toBe(false);
    expect(parse({ ...base, contributions: { pages: [{ id: 'inbox', title: 'Inbox', entry: '../x.html' }] } })).toEqual(
      { kind: 'error', error: '入口必须是包内的文件：../x.html' },
    );
  });

  it('rejects a page without a title or with a taken id', () => {
    expect(parse({ ...base, contributions: { pages: [{ id: 'inbox', title: ' ', entry: 'ui/index.html' }] } })).toEqual(
      { kind: 'error', error: '页面 inbox 需要标题和入口' },
    );
    expect(
      parse({
        ...base,
        contributions: {
          pages: [
            { id: 'inbox', title: 'A', entry: 'a.html' },
            { id: 'inbox', title: 'B', entry: 'b.html' },
          ],
        },
      }),
    ).toEqual({ kind: 'error', error: '两个页面用了同一个 id：inbox' });
  });

  it('drops a view this app does not have instead of rejecting the page', () => {
    const result = parse({
      ...base,
      contributions: { pages: [{ id: 'inbox', title: 'Inbox', entry: 'ui/index.html', views: ['code', 'mobile'] }] },
    });
    expect(result.kind === 'ok' && result.manifest.contributions.pages[0].views).toEqual(['code']);
  });
});
