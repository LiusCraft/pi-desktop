/**
 * Desktop plugins: the pi packages whose package.json carries a `piDesktop` section (see docs/plugins.md).
 *
 * This module only reads manifests and keeps the registry — `~/.pi-desktop/plugins.json`, one entry per
 * plugin id with whether the user turned it on and which permissions they agreed to. Nothing here runs
 * plugin code; the host entries (a later step) load exactly the plugins this reports as `ready`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { tr } from '@shared/i18n/runtime';
import { parseDesktopManifest } from '@shared/plugin-manifest';
import type { DesktopPluginInfo, DesktopPluginManifest, PluginPermission } from '@shared/protocol';

/** A configured pi package and the folder it is installed in; `root` is null when it is not installed. */
export interface PluginPackage {
  source: string;
  scope: 'user' | 'project';
  root: string | null;
}

interface RegistryEntry {
  source: string;
  enabled: boolean;
  granted: PluginPermission[];
}
interface Registry {
  plugins: Record<string, RegistryEntry>;
}

export interface DesktopPluginsOptions {
  /** The registry file. */
  file: string;
  /** The packages configured for a project (the page's scope). */
  packages: (project: string | null) => PluginPackage[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Every permission the manifest asks for has been agreed to. */
const covers = (granted: PluginPermission[], asked: PluginPermission[]) => asked.every((p) => granted.includes(p));

function readObject(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export class DesktopPlugins {
  constructor(private readonly opts: DesktopPluginsOptions) {}

  /** Every desktop plugin of the configured packages, with the reason one cannot load when it cannot. */
  list(project: string | null): DesktopPluginInfo[] {
    const registry = this.read();
    const taken = new Map<string, string>();
    const out: DesktopPluginInfo[] = [];
    for (const pkg of this.opts.packages(project)) {
      const info = this.describe(pkg, registry, taken);
      if (info) out.push(info);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Turn one on (with the permissions the user just agreed to) or off. Enabling asks for every
   * permission in the manifest: a plugin that was granted a subset after an upgrade must be reviewed
   * again, which is what `needsGrant` reports until the user does.
   */
  setEnabled(project: string | null, id: string, enabled: boolean, granted: PluginPermission[] | null): DesktopPluginInfo[] {
    const plugin = this.list(project).find((p) => p.id === id);
    if (!plugin) throw new Error(tr('plugins.err.notFound', { id }));
    // A broken package cannot be turned on, but it can always be turned off.
    if (enabled && plugin.error) throw new Error(plugin.error);
    if (enabled && !covers(granted ?? [], plugin.permissions)) throw new Error(tr('plugins.err.needGrants'));
    const registry = this.read();
    // What the user agreed to is the manifest's list at this moment; a later manifest that adds a
    // permission no longer matches, and the plugin stops being `ready` until it is reviewed.
    registry.plugins[id] = { source: plugin.source, enabled, granted: enabled ? plugin.permissions : (registry.plugins[id]?.granted ?? []) };
    this.write(registry);
    return this.list(project);
  }

  /**
   * What the user decided for a plugin id, whatever project its package came from; null when the
   * registry has never seen it. The plugin runtime asks this on every call, so a switch takes effect
   * without a restart.
   */
  decision(id: string): { enabled: boolean; granted: PluginPermission[] } | null {
    const entry = this.read().plugins[id];
    return entry ? { enabled: entry.enabled, granted: entry.granted } : null;
  }

  /** The registry: a missing or unreadable file is an empty one, so a broken file never hides the page. */
  private read(): Registry {
    const raw = readObject(this.opts.file);
    const plugins: Record<string, RegistryEntry> = {};
    const entries = raw && isRecord(raw.plugins) ? raw.plugins : {};
    for (const [id, value] of Object.entries(entries)) {
      if (!isRecord(value) || typeof value.source !== 'string') continue;
      plugins[id] = {
        source: value.source,
        enabled: value.enabled === true,
        granted: Array.isArray(value.granted) ? value.granted.filter((p): p is PluginPermission => typeof p === 'string') : [],
      };
    }
    return { plugins };
  }

  private write(registry: Registry) {
    fs.mkdirSync(path.dirname(this.opts.file), { recursive: true });
    fs.writeFileSync(this.opts.file, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  }

  /** One configured package as a plugin, or null when it is not installed or declares no `piDesktop`. */
  private describe(pkg: PluginPackage, registry: Registry, taken: Map<string, string>): DesktopPluginInfo | null {
    if (!pkg.root) return null;
    const pkgJson = readObject(path.join(pkg.root, 'package.json'));
    const parsed = parseDesktopManifest(pkgJson);
    if (parsed.kind === 'none') return null;
    const meta = pkgJson ?? {};
    const name = typeof meta.name === 'string' ? meta.name : pkg.source;
    const manifest = parsed.kind === 'ok' ? parsed.manifest : null;
    // A manifest that cannot be parsed still gets a row, so the user sees why it does nothing. Its id is
    // the package name: nothing can be enabled by it anyway.
    const id = manifest?.id ?? name;
    const entry = registry.plugins[id];
    const enabled = entry?.enabled === true;
    const granted = entry?.granted ?? [];
    const missing = manifest ? missingEntry(pkg.root, manifest) : null;
    const error = parsed.kind === 'error' ? parsed.error
      : missing ? tr('plugins.err.missingEntry', { value: missing })
        : taken.has(id) ? tr('plugins.err.idTaken', { id, source: taken.get(id)! })
          : null;
    if (!error) taken.set(id, pkg.source);
    const needsGrant = enabled && !!manifest && !covers(granted, manifest.permissions);
    return {
      id,
      source: pkg.source,
      scope: pkg.scope,
      root: pkg.root,
      name,
      description: typeof meta.description === 'string' ? meta.description : '',
      version: typeof meta.version === 'string' ? meta.version : '',
      permissions: manifest?.permissions ?? [],
      host: manifest?.host ?? null,
      contributions: manifest?.contributions ?? { pages: [] },
      enabled,
      granted,
      ready: enabled && !needsGrant && !error,
      needsGrant,
      error,
    };
  }
}

/** The first file the manifest names but the package does not have; null when every one of them is there. */
function missingEntry(root: string, manifest: DesktopPluginManifest): string | null {
  const files = [...(manifest.host ? [manifest.host] : []), ...manifest.contributions.pages.map((p) => p.entry)];
  for (const file of files) {
    try {
      if (!fs.statSync(path.join(root, file)).isFile()) return file;
    } catch {
      return file;
    }
  }
  return null;
}
