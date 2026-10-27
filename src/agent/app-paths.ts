// Where Pi Desktop keeps its own data. pi's own config is never relocated:
// auth.json, models.json, sessions and pi's extensions stay wherever the pi SDK
// resolves them (~/.pi/agent by default, or PI_CODING_AGENT_DIR); this app only
// reads and writes them in place. Electron's Chromium profile also stays at the
// platform default — these helpers are only for the app's own files.
import os from 'node:os';
import path from 'node:path';

/** `~/.pi-desktop`. `PI_DESKTOP_HOME` overrides it (tests, portable setups). */
export const APP_DIR_NAME = '.pi-desktop';
export const ENV_APP_DIR = 'PI_DESKTOP_HOME';
/** Default root for per-session git worktrees, relative to the app data folder. */
export const WORKTREE_DIR_NAME = '.worktree';

/** Expand a leading `~` (the one form of shorthand settings may contain). */
export function expandHome(value: string): string {
  const p = value.trim();
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** The app's own data folder: settings, session metadata, caches, demo and worktrees. */
export function appDataDir(): string {
  const env = process.env[ENV_APP_DIR]?.trim();
  return env ? path.resolve(expandHome(env)) : path.join(os.homedir(), APP_DIR_NAME);
}

/** pi's config directory, exactly where the pi CLI keeps it. Never relocated by this app. */
export function piAgentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR?.trim();
  return env ? path.resolve(expandHome(env)) : path.join(os.homedir(), '.pi', 'agent');
}

/** Disposable catalogs (models.dev) that can be deleted and refetched. */
export const appCacheDir = (dataDir: string) => path.join(dataDir, 'cache');
/** Pi Desktop's own extensions (pi's extensions live under pi's agent dir). */
export const appExtensionsDir = (dataDir: string) => path.join(dataDir, 'extensions');
/** User-defined subagents: one markdown file each (frontmatter + system prompt). */
export const appAgentsDir = (dataDir: string) => path.join(dataDir, 'agents');
/** User-made desktop pets: one JSON file each (see `@shared/pets`). */
export const appPetsDir = (dataDir: string) => path.join(dataDir, 'pets');
/** Scratch workspaces for Work tasks started without a folder. */
export const appWorkDir = (dataDir: string) => path.join(dataDir, 'work');
/** Copies of the bundled demo project and demo Work folder. */
export const appDemoDir = (dataDir: string) => path.join(dataDir, 'demo');
export const defaultWorktreeDir = (dataDir: string) => path.join(dataDir, WORKTREE_DIR_NAME);

/** The worktree root in use: the configured folder, or `<dataDir>/.worktree`. */
export function worktreeDir(dataDir: string, configured: string | null | undefined): string {
  const raw = expandHome(configured ?? '');
  // A hand-edited settings.json could hold a relative path; never resolve it against the process cwd.
  return raw && path.isAbsolute(raw) ? path.resolve(raw) : defaultWorktreeDir(dataDir);
}
