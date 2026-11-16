/**
 * The runtime of a desktop plugin's host entry (`piDesktop.host`): one module per plugin, imported once
 * in the agent process, answering the calls its pages make and pushing data back to them.
 *
 * A plugin's agent-side capabilities (tools, commands, hooks) are a plain pi extension
 * (`pi.extensions`) that pi loads per session as it always has — this file is only about the desktop
 * side, so the entry needs no session and keeps working while none is open.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tr } from '@shared/i18n/runtime';
import type { DesktopPluginInfo, HostEvent, JsonValue, PluginEvent, PluginPermission } from '@shared/protocol';

/** What a host entry receives when the plugin's code starts. */
export interface DesktopHostApi {
  /** A method the plugin's pages may call with `pidesk.host.call(method, …)`. */
  handle(method: string, fn: (...args: unknown[]) => unknown): void;
  /** Push data to the plugin's open pages (`pidesk.host.on(name, …)`). */
  emit(name: string, payload: JsonValue): void;
  notify(message: string, level?: 'info' | 'warning' | 'error'): void;
  /** The plugin's own key/value store; the pages reach the same one through `pidesk.storage`. */
  storage: { get(key: string): JsonValue | null; set(key: string, value: JsonValue): void };
  /** A folder the plugin may keep files in; created before the entry loads. */
  dataDir: string;
}

/** The method names the runtime answers itself; a plugin's own methods may not start with `#`. */
export const STORAGE_GET = '#storage.get';
export const STORAGE_SET = '#storage.set';
const OWN_METHOD = /^[A-Za-z][A-Za-z0-9_.-]*$/;

type Handler = (...args: unknown[]) => unknown;
type PluginHostEvent = Extract<HostEvent, { type: 'plugin' }>;

export interface PluginHostsOptions {
  /** Where per-plugin data lives: `<dataDir>/plugin-data/<id>.json`. */
  dataDir: string;
  /** What the registry says right now: a disabled or ungranted plugin must not answer. */
  decision: (id: string) => { enabled: boolean; granted: PluginPermission[] } | null;
  emit: (event: PluginHostEvent) => void;
}

/** One JSON file per plugin. Writes are whole-file: these are settings, not a database. */
class PluginStorage {
  constructor(readonly dir: string, private readonly file: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  get(key: string): JsonValue | null {
    const all = this.read();
    return key in all ? all[key] : null;
  }

  set(key: string, value: JsonValue) {
    const all = this.read();
    all[key] = value;
    fs.writeFileSync(this.file, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  }

  private read(): Record<string, JsonValue> {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, JsonValue>) : {};
    } catch {
      return {};
    }
  }
}

/** What a handler returned, as the JSON that crosses the IPC and postMessage boundary. */
function toJson(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
  } catch {
    // A circular or otherwise unsendable value is the plugin's bug: say so instead of sending nothing.
    throw new Error(tr('plugins.err.notJson'));
  }
}

export class PluginHosts {
  private runtimes = new Map<string, { handlers: Map<string, Handler>; storage: PluginStorage }>();
  private loading = new Map<string, Promise<{ handlers: Map<string, Handler>; storage: PluginStorage }>>();

  constructor(private readonly opts: PluginHostsOptions) {}

  /**
   * Run one method of a plugin's host entry. Storage works for every plugin (a page-only plugin may
   * still keep settings); everything else needs the entry, loaded on first use.
   */
  async call(plugin: DesktopPluginInfo, method: string, args: unknown[]): Promise<JsonValue> {
    if (method === STORAGE_GET || method === STORAGE_SET) {
      this.allow(plugin, 'storage');
      const storage = this.storageFor(plugin);
      if (method === STORAGE_GET) return storage.get(String(args[0] ?? ''));
      storage.set(String(args[0] ?? ''), toJson(args[1]));
      return null;
    }
    const runtime = await this.load(plugin);
    const handler = runtime.handlers.get(method);
    if (!handler) throw new Error(tr('plugins.err.noMethod', { id: plugin.id, method }));
    return toJson(await handler(...args));
  }

  /** The plugin's own store, whether or not it has a host entry. */
  private storageFor(plugin: DesktopPluginInfo): PluginStorage {
    const dir = path.join(this.opts.dataDir, plugin.id);
    return new PluginStorage(dir, path.join(dir, 'storage.json'));
  }

  private allow(plugin: DesktopPluginInfo, permission: PluginPermission) {
    if (!plugin.permissions.includes(permission)) throw new Error(tr('plugins.err.notGranted', { id: plugin.id, permission }));
    // The registry, not the listing: a switch the user just flipped applies to the next call.
    const decision = this.opts.decision(plugin.id);
    if (!decision?.enabled) throw new Error(tr('plugins.err.notEnabled', { id: plugin.id }));
    if (!decision.granted.includes(permission)) throw new Error(tr('plugins.err.notGranted', { id: plugin.id, permission }));
  }

  private async load(plugin: DesktopPluginInfo) {
    const ready = this.runtimes.get(plugin.id);
    if (ready) return ready;
    const pending = this.loading.get(plugin.id);
    if (pending) return pending;
    const run = this.start(plugin).finally(() => this.loading.delete(plugin.id));
    this.loading.set(plugin.id, run);
    return run;
  }

  private async start(plugin: DesktopPluginInfo) {
    const decision = this.opts.decision(plugin.id);
    if (!decision?.enabled) throw new Error(tr('plugins.err.notEnabled', { id: plugin.id }));
    const ungranted = plugin.permissions.find((p) => !decision.granted.includes(p));
    if (ungranted) throw new Error(tr('plugins.err.notGranted', { id: plugin.id, permission: ungranted }));
    if (!plugin.host) throw new Error(tr('plugins.err.noHost', { id: plugin.id }));
    const file = path.join(plugin.root, plugin.host);
    // SAFETY: the module is the plugin's own ESM entry; only `default` is read, and it is checked below.
    const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
    if (typeof mod.default !== 'function') throw new Error(tr('plugins.err.badHost', { id: plugin.id }));

    const storage = this.storageFor(plugin);
    const runtime = { handlers: new Map<string, Handler>(), storage };
    await mod.default(this.api(plugin, runtime));
    this.runtimes.set(plugin.id, runtime);
    return runtime;
  }

  private api(plugin: DesktopPluginInfo, runtime: { handlers: Map<string, Handler>; storage: PluginStorage }): DesktopHostApi {
    const emit = (event: PluginEvent) => this.opts.emit({ type: 'plugin', pluginId: plugin.id, event });
    return {
      handle: (method, fn) => {
        this.allow(plugin, 'host:call');
        if (!OWN_METHOD.test(method)) throw new Error(tr('plugins.err.badMethod', { method }));
        runtime.handlers.set(method, fn);
      },
      emit: (name, payload) => emit({ kind: 'data', name, payload: toJson(payload) }),
      notify: (message, level = 'info') => emit({ kind: 'notify', message, level }),
      storage: {
        get: (key) => {
          this.allow(plugin, 'storage');
          return runtime.storage.get(key);
        },
        set: (key, value) => {
          this.allow(plugin, 'storage');
          runtime.storage.set(key, toJson(value));
        },
      },
      dataDir: runtime.storage.dir,
    };
  }
}
