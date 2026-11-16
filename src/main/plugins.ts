/**
 * The main process's side of desktop plugins: hand a plugin's own files to its sandboxed page, and
 * relay the calls that page makes. No plugin code runs here — the page is a web page and its host
 * entry lives in the agent process (see `src/agent/plugin-host.ts`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { tr } from '@shared/i18n/runtime';
import { PLUGIN_SDK } from '@shared/plugin-sdk';
import type { DesktopPluginInfo, JsonValue } from '@shared/protocol';

/** The scheme a plugin page is served from: `pidesk-plugin://<id>/ui/index.html`. */
export const PLUGIN_SCHEME = 'pidesk-plugin';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * A page gets its own files and nothing else: no network of its own (that is what `pidesk` calls are
 * for), no frames, no plugins. The app's window is a different origin either way.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const NOT_FOUND = () => new Response('Not found', { status: 404, headers: { 'content-security-policy': CSP } });

/** A file inside the package, or null when the path would leave it. */
function inside(root: string, relative: string): string | null {
  if (!relative || relative.includes('\0')) return null;
  const file = path.resolve(root, relative);
  const rest = path.relative(root, file);
  return rest && !rest.startsWith('..') && !path.isAbsolute(rest) ? file : null;
}

export interface PluginServerOptions {
  /** Hand a page's call to the agent host, where the plugin's own code answers it. */
  call: (plugin: DesktopPluginInfo, method: string, args: unknown[]) => Promise<JsonValue>;
}

export class PluginServer {
  /** The plugins the windows have listed; the file server and `plugin:call` read this and nothing else. */
  private known = new Map<string, DesktopPluginInfo>();

  constructor(private readonly opts: PluginServerOptions) {}

  /** Remember what a `plugins:list` (or a switch) just returned. */
  remember(list: DesktopPluginInfo[]) {
    for (const plugin of list) this.known.set(plugin.id, plugin);
  }

  /** A call from a plugin's page. Only a ready plugin answers: a switched-off one is refused here. */
  async call(pluginId: string, method: string, args: unknown[]): Promise<JsonValue> {
    const plugin = this.known.get(pluginId);
    if (!plugin) throw new Error(tr('plugins.err.unknown', { id: pluginId }));
    if (!plugin.ready) throw new Error(tr('plugins.err.notReady', { id: pluginId }));
    if (!method) throw new Error(tr('plugins.err.badMethod', { method }));
    return this.opts.call(plugin, method, args);
  }

  /** `pidesk-plugin://<id>/<path>`: the shared SDK, or a file of that plugin's package. */
  handle(requestUrl: string): Response {
    let url: URL;
    try {
      url = new URL(requestUrl);
    } catch {
      return NOT_FOUND();
    }
    let relative: string;
    try {
      relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return NOT_FOUND();
    }
    const headers = { 'content-type': TYPES['.js'], 'content-security-policy': CSP };
    if (relative === 'sdk/pidesk.js') return new Response(PLUGIN_SDK, { headers });

    const plugin = this.known.get(url.hostname);
    const file = plugin && inside(plugin.root, relative);
    if (!file) return NOT_FOUND();
    try {
      if (!fs.statSync(file).isFile()) return NOT_FOUND();
      return new Response(fs.readFileSync(file), {
        headers: { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-security-policy': CSP },
      });
    } catch {
      return NOT_FOUND();
    }
  }
}
