// Git / GitHub helpers for sessions: worktrees, working-tree diffs, PR status.
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MAX_FILE = 512 * 1024;

function run(cmd, args, cwd, { allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !allowFail) return reject(Object.assign(err, { stderr: String(stderr) }));
      resolve(err ? null : String(stdout));
    });
  });
}
const git = (cwd, ...args) => run('git', args, cwd);
const gitSafe = (cwd, ...args) => run('git', args, cwd, { allowFail: true });

async function repoRoot(dir) {
  const out = await gitSafe(dir, 'rev-parse', '--show-toplevel');
  return out ? out.trim() : null;
}
async function head(dir) {
  const out = await gitSafe(dir, 'rev-parse', 'HEAD');
  return out ? out.trim() : null;
}
async function currentBranch(dir) {
  const out = await gitSafe(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
  return out ? out.trim() : null;
}

async function addWorktree(repo, dest, branch, base = 'HEAD') {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await git(repo, 'worktree', 'add', '-b', branch, dest, base);
}

// Files changed in `cwd` relative to `base` (a commit), including untracked files.
async function changes(cwd, base) {
  if (!base || !(await repoRoot(cwd))) return [];
  const files = new Map();
  const status = (await gitSafe(cwd, 'diff', '--name-status', '-z', '--no-renames', base)) || '';
  const parts = status.split('\0').filter(Boolean);
  for (let i = 0; i + 1 < parts.length; i += 2) files.set(parts[i + 1], parts[i][0]);
  const untracked = (await gitSafe(cwd, 'ls-files', '--others', '--exclude-standard', '-z')) || '';
  for (const p of untracked.split('\0').filter(Boolean)) files.set(p, 'A');

  const out = [];
  for (const [file, st] of [...files].sort()) {
    const abs = path.join(cwd, file);
    let before = null, after = null, binary = false;
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

async function listFiles(cwd, limit = 3000) {
  const out = await gitSafe(cwd, 'ls-files', '--cached', '--others', '--exclude-standard');
  if (out) return out.split('\n').filter(Boolean).slice(0, limit);
  const res = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (res.length >= limit || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else res.push(r);
    }
  };
  try { walk(cwd, ''); } catch {}
  return res;
}

// PR state for the current branch via the GitHub CLI; null when gh or a PR is unavailable.
async function prStatus(cwd) {
  let out = await run('gh', ['pr', 'view', '--json', 'number,url,state,isDraft,statusCheckRollup,comments,reviews'], cwd, { allowFail: true });
  // Some tokens can read the PR but not CI/reviews. Still expose its identity/state.
  if (!out) out = await run('gh', ['pr', 'view', '--json', 'number,url,state,isDraft'], cwd, { allowFail: true });
  if (!out) return null;
  try {
    const pr = JSON.parse(out);
    const checks = (pr.statusCheckRollup || []).map((c) => {
      const result = (c.conclusion || c.state || '').toUpperCase();
      const st = !c.conclusion && c.status && c.status !== 'COMPLETED' ? 'pending'
        : ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(result) ? 'pass'
        : result === 'PENDING' || result === 'EXPECTED' ? 'pending' : 'fail';
      return { n: c.name || c.context, st };
    });
    const ci = !checks.length ? 'none' : checks.some((c) => c.st === 'fail') ? 'fail' : checks.some((c) => c.st === 'pending') ? 'pending' : 'pass';
    return {
      num: pr.number,
      url: pr.url,
      state: String(pr.state).toLowerCase(),
      draft: !!pr.isDraft,
      ci,
      checks,
      comments: (pr.comments || []).length + (pr.reviews || []).filter((r) => r.body).length,
    };
  } catch {
    return null;
  }
}

function openIn(app, cwd, shell) {
  const detached = (cmd, args, opts = {}) => {
    const p = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore', shell: process.platform === 'win32', ...opts });
    p.on('error', () => {});
    p.unref();
  };
  switch (app) {
    case 'vscode': return detached('code', [cwd]);
    case 'cursor': return detached('cursor', [cwd]);
    case 'folder': return shell.openPath(cwd);
    case 'terminal':
      if (process.platform === 'darwin') return detached('open', ['-a', 'Terminal', cwd]);
      if (process.platform === 'win32') return detached('wt', ['-d', cwd]);
      return detached('x-terminal-emulator', [], { cwd });
  }
}

module.exports = { repoRoot, head, currentBranch, addWorktree, changes, listFiles, prStatus, openIn, git };
