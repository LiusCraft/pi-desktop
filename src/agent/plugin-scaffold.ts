/**
 * The skeleton `pidesk_plugin_create` writes: a package that already loads, so the model only changes
 * what makes this plugin different. It lands in the app's own folder (`~/.pi-desktop/plugins/<id>`),
 * which is a stable local pi package — a temp folder would leave `settings.json` pointing at nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { tr } from '@shared/i18n/runtime';
import { PLUGIN_ID } from '@shared/plugin-manifest';
import type { PluginPermission } from '@shared/protocol';
import { appPluginsDir } from './app-paths';

export interface ScaffoldInput {
  dataDir: string;
  id: string;
  title: string;
  description: string;
  permissions: PluginPermission[];
}

export interface Scaffolded {
  /** The package folder that was written. */
  dir: string;
  id: string;
  /** Whether the package has a host entry (only when it asked for `host:call`). */
  host: boolean;
}

const PAGE_ID = 'home';
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function manifest(input: ScaffoldInput, id: string, withHost: boolean) {
  const piDesktop: Record<string, unknown> = {
    apiVersion: 1,
    id,
    permissions: input.permissions,
    contributions: { pages: [{ id: PAGE_ID, title: input.title, entry: 'ui/index.html' }] },
  };
  if (withHost) piDesktop.host = './host.js';
  return `${JSON.stringify({
    name: `pi-plugin-${id}`,
    version: '0.1.0',
    description: input.description,
    keywords: ['pi-package', 'pi-desktop-plugin'],
    private: true,
    type: 'module',
    files: [...(withHost ? ['host.js'] : []), 'ui'],
    piDesktop,
  }, null, 2)}\n`;
}

const HOST_JS = `// Runs in the agent process, once per app run. It answers \`pidesk.host.call\` from the page and
// pushes data back with \`desktop.emit\`. Return JSON only.
export default function activate(desktop) {
  desktop.handle('hello', (name) => ({ message: \`Hello, \${name || 'world'}!\` }));
}
`;

const PAGE_CSS = `/* The app hands the page its colours (see page.js); these are only for the first paint. */
:root {
  --background: #faf9f5;
  --foreground: #141413;
  --muted-foreground: #73726c;
  --border: rgba(31, 30, 29, 0.12);
  --radius: 0.625rem;
}

body {
  margin: 0;
  padding: 28px;
  background: var(--background);
  color: var(--foreground);
  font: 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
}

h1 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
}

.muted {
  color: var(--muted-foreground);
}

pre {
  margin: 14px 0 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace;
  white-space: pre-wrap;
}
`;

function pageJs(withHost: boolean) {
  return `// Everything here goes through \`pidesk\`: the page has no bridge, no filesystem and no network.
const $ = (id) => document.getElementById(id);

pidesk.onTheme((theme) => {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme)) {
    if (name.startsWith('--')) root.style.setProperty(name, value);
  }
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
});

pidesk.session.onChange((session) => {
  $('session').textContent = session ? session.title + ' · ' + session.kind : 'No session open';
});

pidesk.ready().then(async () => {
${withHost ? `  try {
    const answer = await pidesk.host.call('hello', 'Pi Desktop');
    $('out').textContent = JSON.stringify(answer, null, 2);
  } catch (err) {
    $('out').textContent = String(err.message ?? err);
  }
` : `  $('out').textContent = 'Edit ui/page.js and host.js to build this plugin.';
`}});
`;
}

function pageHtml(title: string) {
  const safe = escapeHtml(title);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safe}</title>
    <link rel="stylesheet" href="./page.css" />
  </head>
  <body>
    <main>
      <h1>${safe}</h1>
      <p id="session" class="muted">…</p>
      <pre id="out"></pre>
    </main>
    <script src="/sdk/pidesk.js"></script>
    <script src="./page.js"></script>
  </body>
</html>
`;
}

/** Write the package; throws when the id is unusable or that plugin folder already exists. */
export function scaffoldPlugin(input: ScaffoldInput): Scaffolded {
  const id = input.id.trim();
  if (!PLUGIN_ID.test(id)) throw new Error(tr('plugins.err.badId', { value: id }));
  const title = input.title.trim() || id;
  const dir = path.join(appPluginsDir(input.dataDir), id);
  if (fs.existsSync(dir)) throw new Error(tr('plugins.err.exists', { id }));
  const withHost = input.permissions.includes('host:call');
  const ui = path.join(dir, 'ui');
  fs.mkdirSync(ui, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), manifest({ ...input, id, title }, id, withHost), 'utf8');
  fs.writeFileSync(path.join(ui, 'index.html'), pageHtml(title), 'utf8');
  fs.writeFileSync(path.join(ui, 'page.js'), pageJs(withHost), 'utf8');
  fs.writeFileSync(path.join(ui, 'page.css'), PAGE_CSS, 'utf8');
  if (withHost) fs.writeFileSync(path.join(dir, 'host.js'), HOST_JS, 'utf8');
  return { dir, id, host: withHost };
}
