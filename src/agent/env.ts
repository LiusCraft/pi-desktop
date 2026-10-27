// Environment for every child process the agent spawns (git, gh, editors, tools).
//
// A GUI launch on macOS inherits launchd's PATH — /usr/bin:/bin:/usr/sbin:/sbin —
// so Homebrew's git, or a gh/rg/fd installed by it, would look "missing" even
// though a terminal finds them. Append the usual install prefixes once.
//
// Windows has the mirror-image problem for bash: pi's bash tool looks in
// %ProgramFiles%\Git and then for `bash.exe` on PATH. A Git installed anywhere else
// (E:\program\Git, a per-user install, MSYS2) is invisible to the first check, and the
// second one can land on the WSL launcher in System32, which fails with
// "execvpe(/bin/bash) failed" on machines without a Linux distribution. So find a real
// bash once and put its folder at the front of PATH.
//
// Note the spelling: PowerShell and Explorer export `Path`, not `PATH`. Writing
// `process.env.PATH` next to an existing `Path` leaves two variables in the block, and
// the stale one wins — so every write below goes through `envPath`/`childEnv`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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

const isPathKey = (key: string) => key.toLowerCase() === 'path';

/** PATH under whichever spelling the environment uses (`Path` on a Windows GUI launch). */
const envPath = (env: NodeJS.ProcessEnv = process.env): string =>
  String(Object.entries(env).find(([key]) => isPathKey(key))?.[1] ?? '');

// ---------------------------------------------------------------- bash on Windows

export interface ShellProbe {
  exists(file: string): boolean;
  /** Every `git.exe` on PATH, as `where git.exe` reports them. */
  gitExes(): string[];
  /** Windows / Program Files roots, for the standard Git installer. */
  programFiles: string[];
  pathDirs: string[];
  systemRoot: string;
}

/** `bash.exe` in System32 (or its WindowsApps alias) is the WSL launcher, not a shell. */
const isWslLauncher = (bash: string, systemRoot: string) => {
  const dir = path.win32.dirname(bash).toLowerCase();
  const root = (systemRoot || 'C:\\Windows').toLowerCase();
  return dir === path.win32.join(root, 'system32') || dir === path.win32.join(root, 'sysnative') || /[\\/]windowsapps$/.test(dir);
};

/**
 * The folder holding a usable `bash.exe`, or null. Standard Git installs first (what pi
 * already checks), then the install `git.exe` actually came from, then anything else on
 * PATH — never the WSL launcher.
 */
export function findBashDir(probe: ShellProbe): string | null {
  const win = path.win32;
  const candidates: string[] = [];
  for (const root of probe.programFiles) candidates.push(win.join(root, 'Git', 'bin', 'bash.exe'));
  // Walk up from each git.exe: E:\program\Git\mingw64\bin\git.exe and
  // E:\program\Git\cmd\git.exe both lead to E:\program\Git\bin\bash.exe.
  for (const git of probe.gitExes()) {
    let dir = win.dirname(git);
    for (let up = 0; up < 5; up++) {
      candidates.push(win.join(dir, 'bin', 'bash.exe'), win.join(dir, 'usr', 'bin', 'bash.exe'));
      const parent = win.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  for (const dir of probe.pathDirs) candidates.push(win.join(dir, 'bash.exe'));
  for (const candidate of candidates) {
    if (isWslLauncher(candidate, probe.systemRoot)) continue;
    if (probe.exists(candidate)) return win.dirname(candidate);
  }
  return null;
}

export function realBashDir(): string | null {
  try {
    const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.join(os.homedir(), 'AppData', 'Local', 'Programs')];
    return findBashDir({
      exists: (file) => fs.existsSync(file),
      gitExes: () => {
        try {
          const out = execFileSync('where', ['git.exe'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
          return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        } catch {
          return [];
        }
      },
      programFiles: programFiles.filter(Boolean) as string[],
      pathDirs: envPath().split(path.delimiter).filter(Boolean),
      systemRoot: process.env.SystemRoot || 'C:\\Windows',
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- children

/** The env for a spawned process: one PATH (spelled `PATH`), extended with the usual prefixes. */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  const parts = envPath(env).split(path.delimiter).filter(Boolean);
  for (const dir of EXTRA_PATHS) if (!parts.includes(dir)) parts.push(dir);
  for (const key of Object.keys(env)) if (key !== 'PATH' && isPathKey(key)) delete env[key];
  env.PATH = parts.join(path.delimiter);
  return env;
}

/** The pi SDK spawns tools with process.env, so the extended PATH is applied process-wide once. */
export function applyChildPath() {
  const parts = envPath().split(path.delimiter).filter(Boolean);
  // pi resolves `bash.exe` through PATH; give it a real shell instead of the WSL launcher.
  const bash = process.platform === 'win32' ? realBashDir() : null;
  if (bash && !parts.includes(bash)) parts.unshift(bash);
  for (const dir of EXTRA_PATHS) if (!parts.includes(dir)) parts.push(dir);
  // Keep a single variable: a leftover `Path` would shadow this edit for child processes.
  for (const key of Object.keys(process.env)) if (key !== 'PATH' && isPathKey(key)) delete process.env[key];
  process.env.PATH = parts.join(path.delimiter);
}
