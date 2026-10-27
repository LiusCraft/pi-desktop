// Which code host a repository lives on, and the CLI words for it. The agent host reads PRs through
// `gh` or `glab`; the composer and the PR watcher only phrase prompts, so both share this table.

export type Forge = 'github' | 'gitlab';

/** The forge a remote URL (https, ssh:// or scp-style) points at, or null for a host we cannot tell by name. */
export function forgeOfUrl(url: string | null | undefined): Forge | null {
  const host = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/]+@)?([^/:]+)/i.exec((url ?? '').trim())?.[1]?.toLowerCase() ?? '';
  if (host.includes('gitlab')) return 'gitlab';
  if (host.includes('github')) return 'github';
  return null;
}

export const forgeName = (forge: Forge | null | undefined) => (forge === 'gitlab' ? 'GitLab' : forge === 'github' ? 'GitHub' : 'GitHub / GitLab');

export interface ForgeWords {
  /** What the host calls the thing: a pull request or a merge request. */
  noun: string;
  create: string;
  edit: string;
  comments(num: number): string;
  inlineComments(num: number): string;
  checks(num: number): string;
  merge(num: number): string;
}

/** Commands to put in a prompt. With the forge unknown both are named, so the agent picks by `origin`. */
export function forgeWords(forge: Forge | null | undefined): ForgeWords {
  const pick = (gh: string, glab: string) => (forge === 'github' ? gh : forge === 'gitlab' ? glab : `${gh}（GitLab 仓库用 ${glab}）`);
  return {
    noun: forge === 'gitlab' ? 'MR' : 'PR',
    create: pick('gh pr create', 'glab mr create'),
    edit: pick('gh pr edit', 'glab mr update'),
    comments: (n) => pick(`gh pr view ${n} --comments`, `glab mr view ${n} --comments`),
    inlineComments: (n) => pick(`gh api repos/{owner}/{repo}/pulls/${n}/comments`, `glab api projects/:id/merge_requests/${n}/discussions`),
    checks: (n) => pick(`gh pr checks ${n} 和 gh run view --log-failed`, 'glab ci status 和 glab ci trace <失败的 job>'),
    merge: (n) => pick(`gh pr merge ${n} --auto --squash`, `glab mr merge ${n} --auto-merge --squash（旧版 glab 用 --when-pipeline-succeeds）`),
  };
}
