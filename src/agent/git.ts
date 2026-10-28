// Git / GitHub / GitLab helpers for sessions: worktrees, working-tree diffs, PR status.
import { tr } from '@shared/i18n/runtime';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { CommitInfo, FileChange, FileContent, GitState, PrStatus, PrThread, WorktreeInfo } from '@shared/protocol';
import type { PrNote } from '@shared/pr-event';
import { forgeOfUrl, type Forge } from '@shared/forge';
import { childEnv } from './env';

const MAX_FILE = 512 * 1024;
/** How much of the base commit's hash tells one base from another in a file's revision. */
const REV_BASE = 12;

function run(cmd: string, args: string[], cwd: string, { allowFail = false, timeout = 0, env = {} as Record<string, string> } = {}): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, env: childEnv(env), timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !allowFail) return reject(Object.assign(err, { stderr: String(stderr) }));
      resolve(err ? null : String(stdout));
    });
  });
}
export const git = (cwd: string, ...args: string[]) => run('git', args, cwd);
const gitSafe = (cwd: string, ...args: string[]) => run('git', args, cwd, { allowFail: true });

/** How long a repository's remotes are trusted before the next background fetch. */
const FETCH_INTERVAL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 60 * 1000;
const lastFetch = new Map<string, number>();

/**
 * Refresh the remote-tracking refs, at most once per interval per repository (worktrees share one).
 * Resolves true only when a fetch actually succeeded, i.e. when the bar's counts may have changed.
 */
export async function fetchIfDue(cwd: string): Promise<boolean> {
  const common = (await gitSafe(cwd, 'rev-parse', '--git-common-dir'))?.trim();
  if (!common) return false;
  const key = path.resolve(cwd, common);
  if (Date.now() - (lastFetch.get(key) ?? 0) < FETCH_INTERVAL_MS) return false;
  // Marked before the fetch: an offline or failing remote is not retried on every refresh.
  lastFetch.set(key, Date.now());
  const out = await run('git', ['fetch', '--quiet'], cwd, { allowFail: true, timeout: FETCH_TIMEOUT_MS, env: { GIT_TERMINAL_PROMPT: '0' } });
  return out !== null;
}

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

/** Local branches first, then remote-tracking ones (without the remote's HEAD alias). */
export async function branches(dir: string) {
  const out = await gitSafe(dir, 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes');
  const refs = (out ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
  const local = refs.filter((r) => r.startsWith('refs/heads/')).map((r) => r.slice('refs/heads/'.length));
  const remote = refs.filter((r) => r.startsWith('refs/remotes/') && !r.endsWith('/HEAD')).map((r) => r.slice('refs/remotes/'.length));
  return [...local, ...remote.filter((r) => !local.includes(r.slice(r.indexOf('/') + 1)))];
}
/** The commit a branch or ref points at, or null when it does not exist. */
export async function resolveRef(dir: string, ref: string) {
  const out = await gitSafe(dir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
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

/** The repository's default branch: what origin points at, else a main/master that exists. */
export async function defaultBranch(dir: string) {
  const origin = (await gitSafe(dir, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'))?.trim();
  if (origin && (await resolveRef(dir, origin))) return origin;
  for (const name of ['main', 'master', 'origin/main', 'origin/master']) if (await resolveRef(dir, name)) return name;
  return null;
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

/**
 * The commit the session's changes are measured from: where HEAD left `baseBranch` (so a base that moved on,
 * or was merged into the branch, does not leak its own commits into the diff). Falls back to the recorded
 * `base` when there is no distinct base branch to compare with.
 */
export async function diffBase(cwd: string, base: string | null, baseBranch: string | null): Promise<string | null> {
  if (baseBranch && baseBranch !== (await currentBranch(cwd))) {
    const fork = (await resolveRef(cwd, baseBranch)) && (await mergeBase(cwd, baseBranch));
    if (fork) return fork;
  }
  return base;
}

/** Git's empty tree: the "before" of a root commit. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbcc4904';
const FIELD = '\u001f';

/** Files changed in the working tree relative to `base` (a commit), including untracked files. */
export async function changes(cwd: string, base: string | null): Promise<FileChange[]> {
  const root = base ? await repoRoot(cwd) : null;
  if (!base || !root) return [];
  // Git reports paths from the repository root; resolve everything there, not from a sub-folder.
  const files = new Map<string, string>();
  const status = (await gitSafe(root, 'diff', '--name-status', '-z', '--no-renames', base)) || '';
  const parts = status.split('\0').filter(Boolean);
  for (let i = 0; i + 1 < parts.length; i += 2) files.set(parts[i + 1], parts[i][0]);
  const untracked = (await gitSafe(root, 'ls-files', '--others', '--exclude-standard', '-z')) || '';
  for (const p of untracked.split('\0').filter(Boolean)) files.set(p, 'A');
  return listChanges(root, files, [base], base.slice(0, REV_BASE), (file) => workingRev(root, file));
}

/** Commits on the current branch since `base`, newest first. */
export async function commits(cwd: string, base: string | null): Promise<CommitInfo[]> {
  if (!base) return [];
  const out = (await gitSafe(cwd, 'log', `--format=%H${FIELD}%h${FIELD}%s${FIELD}%an${FIELD}%aI`, `${base}..HEAD`)) || '';
  return out.split('\n').filter(Boolean).map((line) => {
    const [hash, short, subject, author, date] = line.split(FIELD);
    return { hash, short, subject, author, date };
  });
}

/** The commit a commit is measured against: its first parent, or nothing for a root commit. */
async function parentOf(root: string, hash: string) {
  return (await gitSafe(root, 'rev-parse', '--verify', '--quiet', `${hash}^`))?.trim() || EMPTY_TREE;
}

/** Files one commit changed against its first parent (or against nothing, for a root commit). */
export async function commitChanges(cwd: string, hash: string): Promise<FileChange[]> {
  const root = await repoRoot(cwd);
  if (!root || !/^[0-9a-f]{7,64}$/i.test(hash)) return [];
  const parent = await parentOf(root, hash);
  const status = (await gitSafe(root, 'diff', '--name-status', '-z', '--no-renames', parent, hash)) || '';
  const parts = status.split('\0').filter(Boolean);
  const files = new Map<string, string>();
  for (let i = 0; i + 1 < parts.length; i += 2) files.set(parts[i + 1], parts[i][0]);
  // A commit never changes, so its files never need re-reading.
  return listChanges(root, files, [parent, hash], '', () => '');
}

/** Added / removed line counts per path from git (`binary` when git calls the file binary). */
async function lineCounts(root: string, range: string[]) {
  const counts = new Map<string, { add: number; del: number; binary: boolean }>();
  const out = (await gitSafe(root, 'diff', '--numstat', '-z', '--no-renames', ...range)) || '';
  for (const entry of out.split('\0').filter(Boolean)) {
    const [add, del, ...name] = entry.split('\t');
    counts.set(name.join('\t'), { add: Number(add) || 0, del: Number(del) || 0, binary: add === '-' });
  }
  return counts;
}

/** A working-tree file's size and mtime: when either moves, its contents have to be read again. */
function workingRev(root: string, file: string) {
  try {
    const stat = fs.statSync(path.join(root, file));
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return 'gone';
  }
}

/** What the Diff panel lists for `files` (path → A/M/D) without reading any of their contents. */
async function listChanges(root: string, files: Map<string, string>, range: string[], baseRev: string, revOf: (file: string) => string): Promise<FileChange[]> {
  const counts = await lineCounts(root, range);
  const out: FileChange[] = [];
  for (const [file, st] of [...files].sort()) {
    const status = st === 'A' ? 'A' : st === 'D' ? 'D' : 'M';
    let own = counts.get(file);
    if (!own && status === 'A' && range.length === 1) {
      // Untracked files are not in git's numstat: everything in them is added.
      const abs = path.join(root, file);
      try {
        if (fs.statSync(abs).size > MAX_FILE) own = { add: 0, del: 0, binary: true };
        else {
          const buf = fs.readFileSync(abs);
          own = buf.includes(0) ? { add: 0, del: 0, binary: true } : { add: lineCount(buf.toString('utf8')), del: 0, binary: false };
        }
      } catch { /* vanished since the listing */ }
    }
    const { add, del, binary } = own ?? { add: 0, del: 0, binary: false };
    out.push({ path: file, status, binary, add: binary ? 0 : add, del: binary ? 0 : del, rev: `${baseRev}:${status}:${revOf(file)}` });
  }
  return out;
}

const lineCount = (text: string) => (text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0);

/** Both sides of one changed file (`hash`: a commit's change, else the working tree against `base`). `binary` when a side is too big to show. */
export async function changeContent(cwd: string, base: string | null, file: string, hash: string | null): Promise<FileContent> {
  const root = await repoRoot(cwd);
  if (!root || (!hash && !base) || (hash && !/^[0-9a-f]{7,64}$/i.test(hash))) return { before: null, after: null, binary: false };
  if (path.relative(root, path.resolve(root, file)).startsWith('..')) return { before: null, after: null, binary: false };
  const from = hash ? await parentOf(root, hash) : base!;
  let before = from === EMPTY_TREE ? null : await gitSafe(root, 'show', `${from}:${file}`);
  let after: string | null = null;
  if (hash) after = await gitSafe(root, 'show', `${hash}:${file}`);
  else {
    const abs = path.join(root, file);
    if (fs.existsSync(abs)) {
      if (fs.statSync(abs).size > MAX_FILE) return { before: null, after: null, binary: true };
      after = fs.readFileSync(abs).toString('utf8');
    }
  }
  const tooBig = (text: string | null) => !!text && (text.length > MAX_FILE || text.includes('\0'));
  if (tooBig(before) || tooBig(after)) return { before: null, after: null, binary: true };
  return { before, after, binary: false };
}

/** Uncommitted paths plus upstream tracking: what the composer's branch bar reports. */
export async function workState(cwd: string, baseBranch: string | null = null, remoteBase = false): Promise<GitState> {
  const status = (await gitSafe(cwd, 'status', '--porcelain', '-z', '--no-renames')) || '';
  const dirty: string[] = [];
  for (const entry of status.split('\0')) if (entry.length > 3) dirty.push(entry.slice(3));
  const upstream = (await gitSafe(cwd, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'))?.trim() || null;
  const count = async (range: string) => (upstream ? Number((await gitSafe(cwd, 'rev-list', '--count', range))?.trim()) || 0 : 0);
  const [ahead, behind] = await Promise.all([count('@{u}..HEAD'), count('HEAD..@{u}')]);
  // The base only matters when the session sits on another branch and the base ref still exists.
  const onBase = !baseBranch || baseBranch === (await currentBranch(cwd));
  // A PR's target is judged by the remote's copy: that is what the PR will be merged into.
  let base: string | null = null;
  if (!onBase) for (const ref of remoteBase ? [`origin/${baseBranch}`, baseBranch!] : [baseBranch!]) if (await resolveRef(cwd, ref)) { base = ref; break; }
  const baseBehind = base ? Number((await gitSafe(cwd, 'rev-list', '--count', `HEAD..${base}`))?.trim()) || 0 : 0;
  const forge = await originForge(cwd);
  return { dirty, ahead, behind, baseBehind, base, upstream, ...(forge ? { forge } : {}) };
}

/** The code host `origin` belongs to, when the host name gives it away. */
export async function originForge(cwd: string): Promise<Forge | null> {
  return forgeOfUrl(await gitSafe(cwd, 'remote', 'get-url', 'origin'));
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

/** The logged-in account per forge; asked once per host process, since it cannot change mid-run. */
const viewerLogin = new Map<Forge, Promise<string | null>>();
function viewer(forge: Forge, cwd: string): Promise<string | null> {
  if (!viewerLogin.has(forge)) {
    const ask = forge === 'github'
      ? run('gh', ['api', 'user', '-q', '.login'], cwd, { allowFail: true }).then((out) => out?.trim() || null)
      : run('glab', ['api', 'user'], cwd, { allowFail: true }).then((out) => (out ? JSON.parse(out).username || null : null));
    viewerLogin.set(forge, ask.catch(() => null));
  }
  return viewerLogin.get(forge)!;
}

/** PR (or GitLab merge request) state for the current branch via gh / glab; null when the CLI or the PR is unavailable. */
export async function prStatus(cwd: string): Promise<PrStatus | null> {
  return (await readPr(cwd))?.status ?? null;
}

/** Which CLI talks to this repo's PR: the remote's name says, else whichever finds a PR for the branch. */
async function prForge(cwd: string): Promise<Forge> {
  const known = await originForge(cwd);
  if (known) return known;
  return (await run('gh', ['pr', 'view', '--json', 'number'], cwd, { allowFail: true })) ? 'github' : 'gitlab';
}

const byPlace = (a: PrThread, b: PrThread) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0);

/** Inline review comments of the branch's PR, grouped into threads in diff order; empty when gh/glab or a PR is unavailable. */
export async function prThreads(cwd: string): Promise<PrThread[]> {
  return (await prForge(cwd)) === 'gitlab' ? gitlabThreads(cwd) : githubThreads(cwd);
}

async function githubThreads(cwd: string): Promise<PrThread[]> {
  const num = (await run('gh', ['pr', 'view', '--json', 'number', '-q', '.number'], cwd, { allowFail: true }))?.trim();
  if (!num || !/^\d+$/.test(num)) return [];
  const pick = '.[] | {id, reply: .in_reply_to_id, path, line, original_line, side, outdated: (.line == null), author: .user.login, body, url: .html_url, at: .created_at}';
  const [out, states] = await Promise.all([
    run('gh', ['api', `repos/{owner}/{repo}/pulls/${num}/comments`, '--paginate', '--jq', pick], cwd, { allowFail: true }),
    githubThreadStates(cwd, num),
  ]);
  const threads = groupThreads(jsonLines(out));
  for (const t of threads) t.resolved = states.get(t.id)?.resolved ?? false;
  return threads;
}

function jsonLines(out: string | null): any[] {
  return (out ?? '').split('\n').flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
}

const THREAD_STATES = 'query($owner:String!,$name:String!,$num:Int!){repository(owner:$owner,name:$name){pullRequest(number:$num){reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{databaseId}}}}}}}';

/** GitHub keeps "resolved" on the GraphQL thread, keyed here by its first comment's REST id. */
async function githubThreadStates(cwd: string, num: string): Promise<Map<string, { node: string; resolved: boolean }>> {
  const jq = '.data.repository.pullRequest.reviewThreads.nodes[] | {node: .id, resolved: .isResolved, root: .comments.nodes[0].databaseId}';
  const out = await run('gh', ['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}', '-F', `num=${num}`, '-f', `query=${THREAD_STATES}`, '--jq', jq], cwd, { allowFail: true });
  return new Map(jsonLines(out).map((r) => [String(r.root), { node: String(r.node), resolved: !!r.resolved }]));
}

/** The merge request of the branch as the API addresses it. */
async function gitlabMr(cwd: string): Promise<{ base: string; url: string } | null> {
  try {
    const mr = JSON.parse((await run('glab', ['mr', 'view', '-F', 'json'], cwd, { allowFail: true })) ?? '');
    return mr?.iid && mr.project_id ? { base: `projects/${mr.project_id}/merge_requests/${mr.iid}`, url: String(mr.web_url) } : null;
  } catch {
    return null;
  }
}

async function gitlabThreads(cwd: string): Promise<PrThread[]> {
  const mr = await gitlabMr(cwd);
  const discussions = mr ? await glabJson(cwd, `${mr.base}/discussions?per_page=100`) : null;
  if (!mr || !Array.isArray(discussions)) return [];
  return discussions.flatMap((d: any): PrThread[] => {
    const pos = d.notes?.[0]?.position;
    if (d.notes?.[0]?.type !== 'DiffNote' || !pos) return [];
    const old = pos.new_line == null && pos.old_line != null;
    const line = old ? pos.old_line : pos.new_line;
    const path = old ? pos.old_path : pos.new_path;
    if (!path) return [];
    const comments = d.notes.filter((n: any) => !n.system).map((n: any) => ({
      id: String(n.id), author: n.author?.username ?? 'someone', body: String(n.body ?? ''), url: `${mr.url}#note_${n.id}`, at: Date.parse(n.created_at) || 0,
    }));
    return [{ id: String(d.id), path, line: typeof line === 'number' ? line : null, side: old ? 'old' : 'new', outdated: false, resolved: !!d.notes[0].resolved, comments }];
  }).sort(byPlace);
}

/** Post a reply into a review thread, on whichever host the PR lives. */
export async function replyToThread(cwd: string, threadId: string, body: string): Promise<void> {
  if ((await prForge(cwd)) === 'gitlab') {
    const mr = await gitlabMr(cwd);
    if (!mr) throw new Error(tr('ag.gitNoMr'));
    await run('glab', ['api', '-X', 'POST', `${mr.base}/discussions/${threadId}/notes`, '-f', `body=${body}`], cwd);
    return;
  }
  const num = (await run('gh', ['pr', 'view', '--json', 'number', '-q', '.number'], cwd))?.trim();
  await run('gh', ['api', '-X', 'POST', `repos/{owner}/{repo}/pulls/${num}/comments/${threadId}/replies`, '-f', `body=${body}`], cwd);
}

/** Mark a review thread resolved (or reopen it). */
export async function setThreadResolved(cwd: string, threadId: string, resolved: boolean): Promise<void> {
  if ((await prForge(cwd)) === 'gitlab') {
    const mr = await gitlabMr(cwd);
    if (!mr) throw new Error(tr('ag.gitNoMr'));
    await run('glab', ['api', '-X', 'PUT', `${mr.base}/discussions/${threadId}?resolved=${resolved}`], cwd);
    return;
  }
  const num = (await run('gh', ['pr', 'view', '--json', 'number', '-q', '.number'], cwd))?.trim() ?? '';
  const node = (await githubThreadStates(cwd, num)).get(threadId)?.node;
  if (!node) throw new Error(tr('ag.gitNoThread'));
  const mutation = resolved
    ? 'mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}'
    : 'mutation($id:ID!){unresolveReviewThread(input:{threadId:$id}){thread{id}}}';
  await run('gh', ['api', 'graphql', '-F', `id=${node}`, '-f', `query=${mutation}`], cwd);
}

/** Raw `pulls/:n/comments` rows (already trimmed by jq) into threads: replies join their root, in file/line order. */
export function groupThreads(rows: any[]): PrThread[] {
  const roots = new Map<string, PrThread>();
  const toComment = (r: any) => ({ id: String(r.id), author: r.author ?? 'someone', body: String(r.body ?? ''), url: String(r.url ?? ''), at: Date.parse(r.at) || 0 });
  for (const r of rows) {
    if (r.reply != null || !r.path) continue;
    const line = typeof r.line === 'number' ? r.line : typeof r.original_line === 'number' ? r.original_line : null;
    roots.set(String(r.id), { id: String(r.id), path: r.path, line, side: r.side === 'LEFT' ? 'old' : 'new', outdated: !!r.outdated, resolved: false, comments: [toComment(r)] });
  }
  for (const r of rows) {
    if (r.reply == null) continue;
    roots.get(String(r.reply))?.comments.push(toComment(r));
  }
  return [...roots.values()].sort(byPlace);
}

/** The remote's name picks the CLI; a host we cannot tell by name (self-hosted) gets both, GitHub first. */
export async function readPr(cwd: string): Promise<PrSnapshot | null> {
  const known = await originForge(cwd);
  for (const forge of known ? [known] : (['github', 'gitlab'] as const)) {
    const snapshot = forge === 'github' ? await readGithubPr(cwd) : await readGitlabPr(cwd);
    if (snapshot) return snapshot;
  }
  return null;
}

/** One context of `statusCheckRollup`: a check run from Actions, or an older-style commit status. */
interface RollupContext {
  /** Check run name; absent on a commit status. */
  name?: string;
  /** Commit status context; absent on a check run. */
  context?: string;
  /** Two workflows may name their checks alike, so the name alone does not identify a run. */
  workflowName?: string;
  status?: string;
  conclusion?: string;
  state?: string;
  detailsUrl?: string;
  targetUrl?: string;
  startedAt?: string;
  completedAt?: string;
}

/**
 * The checks to show, the way the host's own checks page lists them: re-running a workflow leaves its
 * earlier attempt in the rollup, but only the newest run per check is current. A commit status has one
 * row per context, so there is nothing to collapse there.
 */
function rollupChecks(rows: RollupContext[]): PrStatus['checks'] {
  const at = (v?: string) => Date.parse(v ?? '') || 0;
  const ranked = rows.flatMap((c, i) => {
    const name = c.name || c.context;
    if (!name) return [];
    // An unfinished run is the current attempt even before GitHub has given it a start time.
    const latest = c.status != null && c.status !== 'COMPLETED' ? Number.MAX_SAFE_INTEGER : Math.max(at(c.startedAt), at(c.completedAt));
    const key = c.context ? `status:${c.context}` : `run:${name}/${c.workflowName ?? ''}`;
    return [{ c, i, name, key, latest }];
  });
  const newest = new Map<string, (typeof ranked)[number]>();
  for (const r of ranked) {
    const seen = newest.get(r.key);
    if (!seen || r.latest > seen.latest || (r.latest === seen.latest && r.i > seen.i)) newest.set(r.key, r);
  }
  return ranked.filter((r) => newest.get(r.key) === r).map(({ c, name }) => {
    const result = String(c.conclusion || c.state || '').toUpperCase();
    let st: 'pass' | 'fail' | 'pending' = 'fail';
    if (!c.conclusion && c.status && c.status !== 'COMPLETED') st = 'pending';
    else if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(result)) st = 'pass';
    else if (result === 'PENDING' || result === 'EXPECTED') st = 'pending';
    const url = c.detailsUrl || c.targetUrl;
    return { n: name, st, ...(url ? { url } : {}) };
  });
}

async function readGithubPr(cwd: string): Promise<PrSnapshot | null> {
  const full = 'number,url,state,isDraft,statusCheckRollup,comments,reviews,title,author,additions,deletions,changedFiles,mergeable,reviewDecision,headRefOid,updatedAt,baseRefName';
  let out = await run('gh', ['pr', 'view', '--json', full], cwd, { allowFail: true });
  // Older gh builds reject a field they do not know; the card is worth more than the full query, so ask for less.
  if (!out) out = await run('gh', ['pr', 'view', '--json', 'number,url,state,isDraft,statusCheckRollup,comments,reviews,title,author'], cwd, { allowFail: true });
  // Some tokens can read the PR but not CI/reviews. Still expose its identity/state.
  if (!out) out = await run('gh', ['pr', 'view', '--json', 'number,url,state,isDraft'], cwd, { allowFail: true });
  if (!out) return null;
  try {
    const pr = JSON.parse(out);
    const checks = rollupChecks(pr.statusCheckRollup || []);
    const ci = !checks.length ? 'none' : checks.some((c) => c.st === 'fail') ? 'fail' : checks.some((c) => c.st === 'pending') ? 'pending' : 'pass';
    const mergeable = { MERGEABLE: 'clean', CONFLICTING: 'conflicting' } as const;
    const review = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', REVIEW_REQUIRED: 'required' } as const;
    const size = (n: unknown) => (typeof n === 'number' ? n : undefined);
    const status: PrStatus = {
      num: pr.number,
      url: pr.url,
      state: String(pr.state).toLowerCase(),
      draft: !!pr.isDraft,
      forge: 'github',
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
      base: typeof pr.baseRefName === 'string' && pr.baseRefName ? pr.baseRefName : undefined,
      head: typeof pr.headRefOid === 'string' && pr.headRefOid ? pr.headRefOid : undefined,
      updatedAt: pr.updatedAt ? Date.parse(pr.updatedAt) || undefined : undefined,
    };
    const me = (pr.reviews ?? []).length ? await viewer('github', cwd) : null;
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
        body: r.body || tr('ag.inlineOnly', { state: r.state, num: pr.number }),
        url: `${pr.url}#pullrequestreview-${r.id}`,
        self: mine(r.author?.login),
      });
    }
    return { status, notes };
  } catch {
    return null;
  }
}

/** `glab api` answers with JSON; anything else (not logged in, no access, a 404) is just "no data". */
async function glabJson(cwd: string, endpoint: string): Promise<any | null> {
  const out = await run('glab', ['api', endpoint], cwd, { allowFail: true });
  try {
    return out ? JSON.parse(out) : null;
  } catch {
    return null;
  }
}

/** GitLab job status → the three states the CI dot knows. */
function gitlabCheck(status: string, allowFailure: boolean): 'pass' | 'fail' | 'pending' {
  if (['success', 'skipped', 'manual'].includes(status)) return 'pass';
  if (status === 'failed') return allowFailure ? 'pass' : 'fail';
  if (['canceled', 'cancelled'].includes(status)) return 'fail';
  return 'pending';
}

/** The merge request of the current branch via glab, mapped onto the same shape as a GitHub PR. */
async function readGitlabPr(cwd: string): Promise<PrSnapshot | null> {
  const out = await run('glab', ['mr', 'view', '-F', 'json'], cwd, { allowFail: true });
  if (!out) return null;
  try {
    const mr = JSON.parse(out);
    if (!mr?.iid || !mr.web_url) return null;
    const base = `projects/${mr.project_id}`;
    const pipeline = mr.head_pipeline ?? mr.pipeline;
    // One call for the jobs; without it the pipeline as a whole still tells red from green.
    const jobs = pipeline?.id && mr.project_id ? await glabJson(cwd, `${base}/pipelines/${pipeline.id}/jobs?per_page=100`) : null;
    const checks: PrStatus['checks'] = Array.isArray(jobs) && jobs.length
      ? jobs.map((j: any) => ({ n: String(j.name), st: gitlabCheck(String(j.status), !!j.allow_failure), ...(j.web_url ? { url: j.web_url } : {}) }))
      : pipeline?.status ? [{ n: 'pipeline', st: gitlabCheck(String(pipeline.status), false), ...(pipeline.web_url ? { url: pipeline.web_url } : {}) }] : [];
    const ci = !checks.length ? 'none' : checks.some((c) => c.st === 'fail') ? 'fail' : checks.some((c) => c.st === 'pending') ? 'pending' : 'pass';
    const rawNotes = mr.project_id ? await glabJson(cwd, `${base}/merge_requests/${mr.iid}/notes?per_page=100&sort=asc`) : null;
    const human = (Array.isArray(rawNotes) ? rawNotes : []).filter((n: any) => n?.id && !n.system);
    const detailed = String(mr.detailed_merge_status || (mr.merge_status === 'can_be_merged' ? 'mergeable' : ''));
    const files = Number.parseInt(String(mr.changes_count), 10);
    const status: PrStatus = {
      num: mr.iid,
      url: mr.web_url,
      state: mr.state === 'merged' ? 'merged' : mr.state === 'closed' ? 'closed' : 'open',
      draft: !!(mr.draft ?? mr.work_in_progress),
      forge: 'gitlab',
      ci,
      checks,
      comments: human.length || (typeof mr.user_notes_count === 'number' ? mr.user_notes_count : 0),
      title: typeof mr.title === 'string' && mr.title.trim() ? mr.title.trim() : undefined,
      author: mr.author?.username || undefined,
      files: Number.isFinite(files) ? files : undefined,
      mergeable: mr.has_conflicts || detailed === 'conflict' ? 'conflicting' : ['', 'checking', 'unchecked', 'preparing'].includes(detailed) ? 'unknown' : 'clean',
      // Unresolved threads block a GitLab merge the way a change request does on GitHub.
      review: detailed === 'discussions_not_resolved' ? 'changes' : detailed === 'not_approved' ? 'required' : undefined,
      base: typeof mr.target_branch === 'string' && mr.target_branch ? mr.target_branch : undefined,
      head: typeof mr.sha === 'string' && mr.sha ? mr.sha : undefined,
      updatedAt: mr.updated_at ? Date.parse(mr.updated_at) || undefined : undefined,
    };
    const me = human.length ? await viewer('gitlab', cwd) : null;
    const notes: PrNote[] = human.map((n: any) => ({
      id: `n${n.id}`,
      author: n.author?.username ?? 'someone',
      body: String(n.body ?? ''),
      url: `${mr.web_url}#note_${n.id}`,
      self: !!me && n.author?.username === me,
    }));
    return { status, notes };
  } catch {
    return null;
  }
}
