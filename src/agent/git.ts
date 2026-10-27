// Git / GitHub helpers for sessions: worktrees, working-tree diffs, PR status.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { FileChange, GitState, PrStatus, WorktreeInfo } from '@shared/protocol';
import type { PrNote } from '@shared/pr-event';
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

const samePath = (a: string, b: string) => {
  const x = path.resolve(a), y = path.resolve(b);
  return process.platform === 'win32' || process.platform === 'darwin' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/** Set when `dir` is a linked worktree (not the main checkout) of a repository with a normal `.git` folder. */
export async function worktreeInfo(dir: string): Promise<WorktreeInfo | null> {
  const top = await repoRoot(dir);
  if (!top) return null;
  const common = (await gitSafe(top, 'rev-parse', '--git-common-dir'))?.trim();
  const own = (await gitSafe(top, 'rev-parse', '--git-dir'))?.trim();
  if (!common || !own) return null;
  const commonDir = path.resolve(top, common);
  if (samePath(commonDir, path.resolve(top, own)) || path.basename(commonDir) !== '.git') return null;
  const branch = await currentBranch(top);
  return { path: top, mainRoot: path.dirname(commonDir), branch: branch && branch !== 'HEAD' ? branch : null };
}

/** The common ancestor of HEAD in `cwd` and `other`, or null when unrelated. */
export async function mergeBase(cwd: string, other: string) {
  const out = await gitSafe(cwd, 'merge-base', 'HEAD', other);
  return out ? out.trim() : null;
}

/** Commits `ref` has that no remote branch and not `base` has: work that would be lost with the branch. */
export async function unpushedCommits(cwd: string, ref: string, base: string | null) {
  const out = await gitSafe(cwd, 'rev-list', '--count', ref, '--not', '--remotes', ...(base ? [base] : []));
  return Number(out?.trim()) || 0;
}

/** Remove a worktree Pi Desktop created, including uncommitted files. A folder that is already gone is just forgotten. */
export async function removeWorktree(repo: string, dest: string) {
  if (fs.existsSync(dest)) await git(repo, 'worktree', 'remove', '--force', dest);
  await gitSafe(repo, 'worktree', 'prune');
}

/** Delete a branch Pi Desktop created, unless it holds commits that exist nowhere else. Returns whether it was deleted. */
export async function deleteBranch(repo: string, branch: string, base: string | null) {
  if (await unpushedCommits(repo, branch, base)) return false;
  return (await gitSafe(repo, 'branch', '-D', branch)) !== null;
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

/**
 * Everything the PR watcher needs in one `gh` call: the status the bar shows, the comments and
 * reviews it has to diff for new ones, and who "we" are so a turn's own reply is not news.
 */
export interface PrSnapshot {
  status: PrStatus;
  notes: PrNote[];
}

/** The logged-in GitHub account; asked once per host process, since it cannot change mid-run. */
let viewerLogin: Promise<string | null> | null = null;
function viewer(cwd: string): Promise<string | null> {
  viewerLogin ??= run('gh', ['api', 'user', '-q', '.login'], cwd, { allowFail: true })
    .then((out) => out?.trim() || null)
    .catch(() => null);
  return viewerLogin;
}

/** PR state for the current branch via the GitHub CLI; null when gh or a PR is unavailable. */
export async function prStatus(cwd: string): Promise<PrStatus | null> {
  return (await readPr(cwd))?.status ?? null;
}

export async function readPr(cwd: string): Promise<PrSnapshot | null> {
  const full = 'number,url,state,isDraft,statusCheckRollup,comments,reviews,title,author,additions,deletions,changedFiles,mergeable,reviewDecision,headRefOid,updatedAt';
  let out = await run('gh', ['pr', 'view', '--json', full], cwd, { allowFail: true });
  // Older gh builds reject a field they do not know; the card is worth more than the full query, so ask for less.
  if (!out) out = await run('gh', ['pr', 'view', '--json', 'number,url,state,isDraft,statusCheckRollup,comments,reviews,title,author'], cwd, { allowFail: true });
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
      const url = c.detailsUrl || c.targetUrl;
      return { n: c.name || c.context, st, ...(url ? { url } : {}) };
    });
    const ci = !checks.length ? 'none' : checks.some((c: any) => c.st === 'fail') ? 'fail' : checks.some((c: any) => c.st === 'pending') ? 'pending' : 'pass';
    const mergeable = { MERGEABLE: 'clean', CONFLICTING: 'conflicting' } as const;
    const review = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', REVIEW_REQUIRED: 'required' } as const;
    const size = (n: unknown) => (typeof n === 'number' ? n : undefined);
    const status: PrStatus = {
      num: pr.number,
      url: pr.url,
      state: String(pr.state).toLowerCase(),
      draft: !!pr.isDraft,
      ci,
      checks,
      comments: (pr.comments || []).length + (pr.reviews || []).filter((r: any) => r.body).length,
      title: typeof pr.title === 'string' && pr.title.trim() ? pr.title.trim() : undefined,
      author: pr.author?.login || undefined,
      additions: size(pr.additions),
      deletions: size(pr.deletions),
      files: size(pr.changedFiles),
      mergeable: mergeable[String(pr.mergeable || '').toUpperCase() as keyof typeof mergeable] ?? (pr.mergeable ? 'unknown' : undefined),
      review: review[String(pr.reviewDecision || '').toUpperCase() as keyof typeof review],
      head: typeof pr.headRefOid === 'string' && pr.headRefOid ? pr.headRefOid : undefined,
      updatedAt: pr.updatedAt ? Date.parse(pr.updatedAt) || undefined : undefined,
    };
    const me = (pr.reviews ?? []).length ? await viewer(cwd) : null;
    const mine = (login: string | undefined) => !!login && !!me && login === me;
    const notes: PrNote[] = [];
    for (const c of pr.comments ?? []) {
      if (!c?.id) continue;
      notes.push({ id: `c${c.id}`, author: c.author?.login ?? 'someone', body: String(c.body ?? ''), url: c.url, self: c.viewerDidAuthor === true || mine(c.author?.login) });
    }
    for (const r of pr.reviews ?? []) {
      if (!r?.id) continue;
      // An approval without words is not work; a change request always is.
      if (!r.body && r.state !== 'CHANGES_REQUESTED') continue;
      notes.push({
        id: `r${r.id}`,
        author: r.author?.login ?? 'someone',
        body: r.body || `（只有行内评论，状态 ${r.state}：用 gh pr view ${pr.number} --comments 查看）`,
        url: `${pr.url}#pullrequestreview-${r.id}`,
        self: mine(r.author?.login),
      });
    }
    return { status, notes };
  } catch {
    return null;
  }
}
