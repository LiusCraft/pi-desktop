// Finding a real bash on Windows. pi's bash tool only knows %ProgramFiles%\Git and then
// whatever `bash.exe` PATH yields — which on a machine with Git installed elsewhere, or
// with the WSL launcher first, means no working shell at all.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findBashDir, type ShellProbe } from '../src/agent/env';

const win = path.win32;

/** A probe over a fake disk: only the listed files exist. */
function probe(files: string[], over: Partial<ShellProbe> = {}): ShellProbe {
  const existing = new Set(files.map((file) => win.normalize(file).toLowerCase()));
  return {
    exists: (file) => existing.has(win.normalize(file).toLowerCase()),
    gitExes: () => [],
    programFiles: [],
    pathDirs: [],
    systemRoot: 'C:\\Windows',
    ...over,
  };
}

describe('findBashDir', () => {
  it('finds the standard Git install pi already looks for', () => {
    const bash = 'C:\\Program Files\\Git\\bin\\bash.exe';
    expect(findBashDir(probe([bash], { programFiles: ['C:\\Program Files'] }))).toBe('C:\\Program Files\\Git\\bin');
  });

  it('follows git.exe to a Git installed outside Program Files', () => {
    // The machine this was written for: Git on another drive, nothing in C:\Program Files\Git.
    const probeWithGit = probe(['E:\\program\\Git\\bin\\bash.exe'], {
      gitExes: () => ['E:\\program\\Git\\cmd\\git.exe'],
    });
    expect(findBashDir(probeWithGit)).toBe('E:\\program\\Git\\bin');
  });

  it('climbs out of the mingw64 layout, which is what `where git` reports first', () => {
    const git = ['E:\\program\\Git\\mingw64\\bin\\git.exe', 'E:\\program\\Git\\cmd\\git.exe'];
    expect(findBashDir(probe(['E:\\program\\Git\\bin\\bash.exe'], { gitExes: () => git }))).toBe(
      'E:\\program\\Git\\bin',
    );
  });

  it('accepts the usr/bin layout of a Git install', () => {
    const probeWithGit = probe(['E:\\program\\Git\\usr\\bin\\bash.exe'], {
      gitExes: () => ['E:\\program\\Git\\cmd\\git.exe'],
    });
    expect(findBashDir(probeWithGit)).toBe('E:\\program\\Git\\usr\\bin');
  });

  it('takes any other bash on PATH, such as MSYS2 or Cygwin', () => {
    expect(findBashDir(probe(['C:\\msys64\\usr\\bin\\bash.exe'], { pathDirs: ['C:\\msys64\\usr\\bin'] }))).toBe(
      'C:\\msys64\\usr\\bin',
    );
  });

  it('never picks the WSL launcher, even when it comes first on PATH', () => {
    const dirs = [
      'C:\\Windows\\system32',
      'C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps',
      'C:\\msys64\\usr\\bin',
    ];
    const files = [...dirs.slice(0, 2).map((dir) => win.join(dir, 'bash.exe')), 'C:\\msys64\\usr\\bin\\bash.exe'];
    expect(findBashDir(probe(files, { pathDirs: dirs }))).toBe('C:\\msys64\\usr\\bin');
  });

  it('reports nothing when only the WSL launcher exists', () => {
    const files = ['C:\\Windows\\System32\\bash.exe', 'C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe'];
    expect(findBashDir(probe(files, { pathDirs: ['C:\\Windows\\system32'] }))).toBeNull();
  });

  it('reports nothing when there is no bash at all', () => {
    expect(findBashDir(probe([]))).toBeNull();
  });
});
