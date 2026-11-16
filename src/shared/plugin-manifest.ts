// Reading the `piDesktop` section of a package.json. Pure — no filesystem, no process — so the agent
// host, the main process and the tests all judge a manifest the same way. Whether the files it names
// exist is the caller's check (they live in an installed package, which only the caller knows).
import { tr } from './i18n/runtime';
import {
  PLUGIN_API_VERSION,
  isPluginPermission,
  type DesktopPluginManifest,
  type PluginPage,
  type PluginPermission,
  type SessionKind,
} from './protocol';

/** A plugin id: it ends up in `plugin:<id>:<method>` and `pidesk-plugin://<id>/`, so it stays URL-safe. */
export const PLUGIN_ID = /^[a-z][a-z0-9-]{1,31}$/;
const PAGE_ID = /^[a-z][a-z0-9-]{0,31}$/;
/** A path inside the package: relative, forward slashes, no `..` and no leading slash. */
const ENTRY = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const VIEWS: readonly SessionKind[] = ['code', 'work'];

/**
 * The path a plugin may name, cleaned: inside its own package, never somewhere else on disk. A leading
 * `./` is what people write, so it is accepted and dropped; everything else that could escape is not.
 */
export function insidePath(entry: string): string | null {
  const relative = entry.startsWith('./') ? entry.slice(2) : entry;
  if (!ENTRY.test(relative) || relative.split('/').some((part) => part === '.' || part === '..')) return null;
  return relative;
}

/** Whether a plugin may name this path at all. */
export const isInsidePackage = (entry: string) => insidePath(entry) !== null;

export type ManifestParse =
  /** The package is not a desktop plugin. */
  | { kind: 'none' }
  | { kind: 'ok'; manifest: DesktopPluginManifest }
  /** It says it is one, but the section cannot be used; the message is already translated. */
  | { kind: 'error'; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (error: string): ManifestParse => ({ kind: 'error', error });

function parsePages(raw: unknown): PluginPage[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return tr('plugins.err.badManifest');
  const pages: PluginPage[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return tr('plugins.err.badManifest');
    const id = typeof item.id === 'string' && PAGE_ID.test(item.id) ? item.id : '';
    if (!id) return tr('plugins.err.badPage', { id: String(item.id) });
    if (pages.some((p) => p.id === id)) return tr('plugins.err.duplicatePage', { id });
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (typeof item.entry !== 'string' || !item.entry || !title) return tr('plugins.err.badPage', { id });
    const entry = insidePath(item.entry);
    if (!entry) return tr('plugins.err.badEntry', { value: item.entry });
    // An unknown view is dropped rather than rejected: a page that names a mode this app does not
    // have still works in the ones it does.
    const views = Array.isArray(item.views)
      ? item.views.filter((v): v is SessionKind => VIEWS.includes(v as SessionKind))
      : [];
    pages.push({ id, title, entry, ...(views.length ? { views } : {}) });
  }
  return pages;
}

/** `pkg` is a parsed package.json. */
export function parseDesktopManifest(pkg: unknown): ManifestParse {
  if (!isRecord(pkg) || pkg.piDesktop === undefined) return { kind: 'none' };
  const raw = pkg.piDesktop;
  if (!isRecord(raw)) return fail(tr('plugins.err.badManifest'));

  const version = raw.apiVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    return fail(tr('plugins.err.badApiVersion'));
  if (version > PLUGIN_API_VERSION) return fail(tr('plugins.err.apiVersion', { version }));

  const id = typeof raw.id === 'string' && PLUGIN_ID.test(raw.id) ? raw.id : '';
  if (!id) return fail(tr('plugins.err.badId', { value: String(raw.id) }));

  const permissions: PluginPermission[] = [];
  if (raw.permissions !== undefined) {
    if (!Array.isArray(raw.permissions))
      return fail(tr('plugins.err.badPermission', { value: String(raw.permissions) }));
    for (const value of raw.permissions) {
      if (!isPluginPermission(value)) return fail(tr('plugins.err.badPermission', { value: String(value) }));
      if (!permissions.includes(value)) permissions.push(value);
    }
  }

  if (raw.contributions !== undefined && !isRecord(raw.contributions)) return fail(tr('plugins.err.badManifest'));
  const pages = parsePages(raw.contributions?.pages);
  if (typeof pages === 'string') return fail(pages);

  // The module that runs in the agent host; a package may bring only pages, so it is optional.
  let host: string | null = null;
  if (raw.host !== undefined) {
    host = typeof raw.host === 'string' ? insidePath(raw.host) : null;
    if (!host) return fail(tr('plugins.err.badEntry', { value: String(raw.host) }));
  }

  return { kind: 'ok', manifest: { apiVersion: version, id, permissions, host, contributions: { pages } } };
}
