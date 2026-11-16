import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appWorkDir,
  appDataDir,
  appExtensionsDir,
  defaultWorktreeDir,
  expandHome,
  piAgentDir,
  worktreeDir,
} from '../src/agent/app-paths';

const ENV_KEYS = ['PI_DESKTOP_HOME', 'PI_CODING_AGENT_DIR'] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('app paths', () => {
  it('defaults app data to ~/.pi-desktop and honors PI_DESKTOP_HOME', () => {
    delete process.env.PI_DESKTOP_HOME;
    expect(appDataDir()).toBe(path.join(os.homedir(), '.pi-desktop'));

    process.env.PI_DESKTOP_HOME = '~/portable-pi-desktop';
    expect(appDataDir()).toBe(path.join(os.homedir(), 'portable-pi-desktop'));

    process.env.PI_DESKTOP_HOME = '/tmp/pi-desktop-home';
    expect(appDataDir()).toBe(path.resolve('/tmp/pi-desktop-home'));
  });

  it("keeps pi's config at pi's default (~/.pi/agent) unless pi itself overrides it", () => {
    delete process.env.PI_CODING_AGENT_DIR;
    expect(piAgentDir()).toBe(path.join(os.homedir(), '.pi', 'agent'));

    process.env.PI_CODING_AGENT_DIR = '~/custom-agent';
    expect(piAgentDir()).toBe(path.join(os.homedir(), 'custom-agent'));
  });

  it('uses <dataDir>/.worktree by default and a configured folder when set', () => {
    const data = path.join(os.tmpdir(), 'pi-desktop-data');
    expect(defaultWorktreeDir(data)).toBe(path.join(data, '.worktree'));
    expect(worktreeDir(data, null)).toBe(path.join(data, '.worktree'));
    expect(worktreeDir(data, '  ')).toBe(path.join(data, '.worktree'));
    expect(worktreeDir(data, '~/worktrees')).toBe(path.join(os.homedir(), 'worktrees'));
    expect(worktreeDir(data, '/Volumes/work/trees')).toBe(path.resolve('/Volumes/work/trees'));
    // A relative path in a hand-edited settings.json must not resolve against the process cwd.
    expect(worktreeDir(data, 'relative/trees')).toBe(path.join(data, '.worktree'));
  });

  it('keeps app folders inside the data folder', () => {
    const data = path.join(os.tmpdir(), 'pi-desktop-data');
    for (const dir of [appWorkDir(data), appExtensionsDir(data)]) expect(dir.startsWith(data + path.sep)).toBe(true);
  });

  it('expands only a leading ~', () => {
    expect(expandHome('~')).toBe(os.homedir());
    expect(expandHome('~/.pi-desktop')).toBe(path.join(os.homedir(), '.pi-desktop'));
    // Both separators count as "the start of a path" after `~`, so a Windows-style value expands too.
    expect(expandHome('~\\custom-agent')).toBe(path.join(os.homedir(), 'custom-agent'));

    // Anything else comes back byte-identical: no normalization, no separator rewriting, no
    // path.resolve. A `~` that is not the first character is just a literal path segment.
    expect(expandHome('/x/~/y')).toBe('/x/~/y');
    expect(expandHome('C:\\x\\~\\y')).toBe('C:\\x\\~\\y');
    expect(expandHome('docs/~/notes.md')).toBe('docs/~/notes.md');
    // `~user` is the shell's "some other home", not ours to guess at.
    expect(expandHome('~user/docs')).toBe('~user/docs');
    // Surrounding whitespace from a hand-edited settings.json is dropped; nothing else changes.
    expect(expandHome('  /x/~/y  ')).toBe('/x/~/y');
  });
});
