// Environment for every child process the agent spawns (git, gh, editors, tools).
//
// A GUI launch on macOS inherits launchd's PATH — /usr/bin:/bin:/usr/sbin:/sbin —
// so Homebrew's git, or a gh/rg/fd installed by it, would look "missing" even
// though a terminal finds them. Append the usual install prefixes once.
import os from 'node:os';
import path from 'node:path';

export const EXTRA_PATHS =
  process.platform === 'darwin'
    ? [
        '/opt/homebrew/bin', // Apple Silicon Homebrew
        '/opt/homebrew/sbin',
        '/usr/local/bin', // Intel Homebrew, and most manual installers
        '/usr/local/sbin',
        path.join(os.homedir(), '.local', 'bin'),
        path.join(os.homedir(), '.pi', 'bin'), // pi downloads fd here
      ]
    : [];

export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const parts = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of EXTRA_PATHS) if (!parts.includes(dir)) parts.push(dir);
  return { ...process.env, ...extra, PATH: parts.join(path.delimiter) };
}

/** The pi SDK spawns tools with process.env, so the extended PATH is applied process-wide once. */
export function applyChildPath() {
  process.env.PATH = childEnv().PATH;
}
