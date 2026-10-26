// Git / GitHub helpers for sessions: worktrees, working-tree diffs, PR status.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { FileChange, GitState, PrStatus } from '@shared/protocol';
import { childEnv } from './env';

const MAX_FILE = 512 * 1024;

function run(cmd: string, args: string[], cwd: string, { allowFail = false } = {}): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, env: childEnv(), maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !allowFail) return reject(Object.assign(err, { stderr: String(stderr) }));
      resolve(err ? null : String(stdout));
    });
  });
}
export const git = (cwd: string, ...args: string[]) => run('git', args, cwd);
const gitSafe = (cwd: string, ...args: string[]) => run('git', args, cwd, { allowFail: true });

export async function repoRoot(dir: string) {
  const out = await gitSafe(dir, 'rev-parse', '--show-toplevel');
  return out ? out.trim() : null;
}
export async function head(dir: string) {
  const out = await gitSafe(dir, 'rev-parse', 'HEAD');
  return out ? out.trim() : null;
}
export async function currentBranch(dir: string) {
  const out = await gitSafe(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
  return out ? out.trim() : null;
}

export async function addWorktree(repo: string, dest: string, branch: string, base = 'HEAD') {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await git(repo, 'worktree', 'add', '-b', branch, dest, base);
}

/** Files changed in `cwd` relative to `base` (a commit), including untracked files. */
export async function changes(cwd: string, base: string | null): Promise<FileChange[]> {
  if (!base || !(await repoRoot(cwd))) return [];
  const files = new Map<string, string>();
  const status = (await gitSafe(cwd, 'diff', '--name-status', '-z', '--no-renames', base)) || '';
  const parts = status.split('\0').filter(Boolean);
  for (let i = 0; i + 1 < parts.length; i += 2) files.set(parts[i + 1], parts[i][0]);
  const untracked = (await gitSafe(cwd, 'ls-files', '--others', '--exclude-standard', '-z')) || '';
  for (const p of untracked.split('\0').filter(Boolean)) files.set(p, 'A');

  const out: FileChange[] = [];
  for (const [file, st] of [...files].sort()) {
    const abs = path.join(cwd, file);
    let before: string | null = null, after: string | null = null, binary = false;
    if (st !== 'A') before = await gitSafe(cwd, 'show', `${base}:${file}`);
    if (st !== 'D' && fs.existsSync(abs)) {
      const stat = fs.statSync(abs);
      if (stat.size > MAX_FILE) binary = true;
      else {
        const buf = fs.readFileSync(abs);
        if (buf.includes(0)) binary = true;
        else after = buf.toString('utf8');
      }
    }
    if (before && (before.length > MAX_FILE || before.includes('\0'))) { binary = true; before = null; }
    out.push({ path: file, status: st === 'A' ? 'A' : st === 'D' ? 'D' : 'M', before, after: after ?? '', binary });
  }
  return out;
}

/** Uncommitted paths plus upstream tracking: what the composer's branch bar reports. */
export async function workState(cwd: string): Promise<GitState> {
  const status = (await gitSafe(cwd, 'status', '--porcelain', '-z', '--no-renames')) || '';
  const dirty: string[] = [];
  for (const entry of status.split('\0')) if (entry.length > 3) dirty.push(entry.slice(3));
  const upstream = (await gitSafe(cwd, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'))?.trim() || null;
  const ahead = upstream ? Number((await gitSafe(cwd, 'rev-list', '--count', '@{u}..HEAD'))?.trim()) || 0 : 0;
  return { dirty, ahead, upstream };
}

export async function listFiles(cwd: string, limit = 3000): Promise<string[]> {
  const out = await gitSafe(cwd, 'ls-files', '--cached', '--others', '--exclude-standard');
  if (out) return out.split('\n').filter(Boolean).slice(0, limit);
  const res: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (res.length >= limit || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else res.push(r);
    }
  };
  // Best effort: a directory that cannot be read still leaves the rest of the listing usable.
  try {
    walk(cwd, '');
  } catch {
    /* unreadable directory or symlink loop */
  }
  return res;
}

/** PR state for the current branch via the GitHub CLI; null when gh or a PR is unavailable. */
export async function prStatus(cwd: string): Promise<PrStatus | null> {
  let out = await run('gh', ['pr', 'view', '--json', 'number,url,state,isDraft,statusCheckRollup,comments,reviews'], cwd, { allowFail: true });
  // Some tokens can read the PR but not CI/reviews. Still expose its identity/state.
  if (!out) out = await run('gh', ['pr', 'view', '--json', 'number,url,state,isDraft'], cwd, { allowFail: true });
  if (!out) return null;
  try {
    const pr = JSON.parse(out);
    const checks = (pr.statusCheckRollup || []).map((c: any) => {
      const result = String(c.conclusion || c.state || '').toUpperCase();
      const st: 'pass' | 'fail' | 'pending' = !c.conclusion && c.status && c.status !== 'COMPLETED' ? 'pending'
        : ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(result) ? 'pass'
        : result === 'PENDING' || result === 'EXPECTED' ? 'pending' : 'fail';
      return { n: c.name || c.context, st };
    });
    const ci = !checks.length ? 'none' : checks.some((c: any) => c.st === 'fail') ? 'fail' : checks.some((c: any) => c.st === 'pending') ? 'pending' : 'pass';
    return {
      num: pr.number,
      url: pr.url,
      state: String(pr.state).toLowerCase(),
      draft: !!pr.isDraft,
      ci,
      checks,
      comments: (pr.comments || []).length + (pr.reviews || []).filter((r: any) => r.body).length,
    };
  } catch {
    return null;
  }
}
