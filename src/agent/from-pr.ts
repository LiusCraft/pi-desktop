import fs from 'node:fs';
import path from 'node:path';
import { tr } from '@shared/i18n/runtime';
import { projectPathKey } from '@shared/project-path';
import type { PrBinding } from '@shared/protocol';
import { gh, git, remotes, repoRoot } from './git';

const slug = /^[a-z\d][a-z\d-]*\/[\w.-]+$/i;
const validRepo = (repo: unknown): repo is string =>
  typeof repo === 'string' && slug.test(repo) && !['.', '..'].includes(repo.split('/')[1]);

export function parsePrUrl(input: string) {
  const match = /^https:\/\/github\.com\/([^/?#]+\/[^/?#]+)\/pull\/([1-9]\d*)\/?(?:[?#][^\s]*)?$/i.exec(input.trim());
  if (!match || !validRepo(match[1]) || !Number.isSafeInteger(Number(match[2]))) throw new Error(tr('prstart.invalid'));
  const baseRepo = match[1].toLowerCase();
  return { baseRepo, num: Number(match[2]), url: `https://github.com/${baseRepo}/pull/${match[2]}` };
}

export function githubRepo(remote: string) {
  const match = /^(?:https:\/\/github\.com\/|(?:ssh:\/\/git@github\.com\/|git@github\.com:))([^/]+\/[^/]+?)\/?$/i.exec(
    remote.trim(),
  );
  return match?.[1].replace(/\.git$/i, '').toLowerCase() ?? null;
}

type Source = Omit<PrBinding, 'baseRemote' | 'headRemote'>;
export async function resolvePr(id: ReturnType<typeof parsePrUrl>) {
  let raw: string | null;
  try {
    raw = await gh(process.cwd(), ['api', '--hostname', 'github.com', `repos/${id.baseRepo}/pulls/${id.num}`]);
  } catch (error) {
    throw new Error(tr('prstart.lookup', { error: (error as Error).message }));
  }
  const pr = JSON.parse(raw ?? '{}');
  if (pr.state !== 'open') throw new Error(tr('prstart.closed'));
  const headRepo = pr.head?.repo?.full_name;
  if (!validRepo(headRepo) || !pr.head?.ref || !pr.base?.ref) throw new Error(tr('prstart.noHead'));
  const source: Source = { ...id, headRepo: headRepo.toLowerCase(), headBranch: pr.head.ref, baseBranch: pr.base.ref };
  return { source, title: String(pr.title), draft: !!pr.draft };
}

async function remoteFor(root: string, repo: string, push = false) {
  for (const name of await remotes(root)) {
    const url = await git(root, 'remote', 'get-url', name);
    if (githubRepo(url ?? '') !== repo) continue;
    if (push) {
      const urls = (await git(root, 'remote', 'get-url', '--push', '--all', name))?.trim().split(/\r?\n/);
      if (urls?.length !== 1 || githubRepo(urls[0]) !== repo) continue;
    }
    return name;
  }
  return null;
}

export async function findPrProject(projects: string[], source: Source) {
  for (const project of projects) {
    const root = await repoRoot(project);
    if (root && ((await remoteFor(root, source.baseRepo)) || (await remoteFor(root, source.headRepo)))) {
      // Keep the registered spelling only if it is the repository root, not a subdirectory.
      return projectPathKey(project) === projectPathKey(root) ? project : root;
    }
  }
  return null;
}

export async function clonePrProject(parent: string, source: Source) {
  const dest = path.join(parent, source.baseRepo.split('/')[1]);
  if (fs.existsSync(dest)) {
    const root = await repoRoot(dest);
    if (root && path.resolve(root) === path.resolve(dest) && (await remoteFor(root, source.baseRepo))) return root;
    throw new Error(tr('prstart.occupied', { path: dest }));
  }
  await gh(parent, ['repo', 'clone', `https://github.com/${source.baseRepo}`, dest]);
  return dest;
}

async function ensureRemote(root: string, repo: string, push: boolean) {
  const existing = await remoteFor(root, repo, push);
  if (existing) return existing;
  const names = await remotes(root);
  const prefix = `pi-pr-${repo.replace('/', '-')}`;
  let name = prefix;
  for (let i = 2; names.includes(name); i++) name = `${prefix}-${i}`;
  const protocol = (await gh(root, ['config', 'get', 'git_protocol', '--host', 'github.com']))?.trim();
  await git(
    root,
    'remote',
    'add',
    name,
    protocol === 'ssh' ? `git@github.com:${repo}.git` : `https://github.com/${repo}.git`,
  );
  if ((await remoteFor(root, repo, push)) !== name) throw new Error(tr('prstart.remoteMismatch'));
  return name;
}

export async function bindRemotes(root: string, source: Source): Promise<PrBinding> {
  const baseRemote = await ensureRemote(root, source.baseRepo, false);
  const headRemote = await ensureRemote(root, source.headRepo, true);
  return { ...source, headRemote, baseRemote };
}

/** Fetch only remote-tracking refs. Do not checkout, reset or fast-forward any existing local branch. */
export async function fetchPrTips(root: string, b: PrBinding) {
  const fetch = async (remote: string, branch: string) => {
    const src = `refs/heads/${branch}`,
      dest = `refs/remotes/${remote}/${branch}`;
    await git(root, 'check-ref-format', src);
    await git(root, 'fetch', '--no-tags', '--', remote, `+${src}:${dest}`);
    return dest;
  };
  const base = await fetch(b.baseRemote, b.baseBranch);
  const head = await fetch(b.headRemote, b.headBranch);
  const fork = (await git(root, 'merge-base', base, head))!.trim();
  return { tip: (await git(root, 'rev-parse', head))!.trim(), fork, baseBranch: `${b.baseRemote}/${b.baseBranch}` };
}

export async function trackPrHead(cwd: string, branch: string, b: PrBinding) {
  await git(cwd, 'branch', `--set-upstream-to=refs/remotes/${b.headRemote}/${b.headBranch}`, branch);
}
