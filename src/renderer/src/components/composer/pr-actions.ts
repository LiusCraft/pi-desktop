// What the branch bar can do next — PR, commit, push — and which one its main button runs.
// Each action becomes a prompt: the agent runs git/gh/glab, the bar only decides what to ask for.
import type { BuiltinCommand } from '@shared/command-message';
import { forgeWords, type Forge } from '@shared/forge';
import type { GitState, PrSummary } from '@shared/protocol';

export type GitAction = 'pr' | 'commit' | 'push';

export interface GitActionItem {
  act: GitAction;
  label: string;
  hint: string;
  command: BuiltinCommand;
  prompt: string;
  enabled: boolean;
}

export interface BranchWork {
  branch: string;
  baseBranch: string | null;
  /** Live working-tree state; null before the first refresh. */
  st: GitState | null;
  /** This branch's PR, as `gh` / `glab` reported it. */
  pr: Pick<PrSummary, 'num' | 'state'> | null;
  /** The code host, when known: decides gh or glab in the prompts. */
  forge?: Forge | null;
}

/**
 * The three ways to send the branch's work, plus the one the bar offers by default.
 * `primary` is null when the branch owes nothing — the bar then reports status only.
 */
export function gitActions({ branch, baseBranch, st, pr, forge }: BranchWork): { actions: GitActionItem[]; primary: GitAction | null } {
  const w = forgeWords(forge);
  const onBase = !baseBranch || branch === baseBranch;
  const dirty = st?.dirty.length ?? 0;
  const ahead = st?.ahead ?? 0;
  // A branch with no upstream still owes its first push.
  const unpushed = ahead > 0 || (!!st && !st.upstream);
  const work = dirty > 0 || unpushed;
  const open = !!pr && (pr.state === 'open' || pr.state === 'draft');
  const target = baseBranch ? `（base 为 ${baseBranch}）` : '';
  const commitPrompt = '提交当前所有改动，写一个清晰的 commit message，不要推送。';
  const pushPrompt = `把分支 ${branch} 上已有的提交推送到 origin（没有上游就加 -u），不要新建提交；推送被拒绝时先读清原因再处理。`;
  // Nothing to commit is common when only unpushed commits are pending; do not ask for a commit then.
  const commitFirst = dirty > 0 ? '提交当前所有改动（写一个清晰的 commit message），' : '';
  let prLabel = 'Create PR';
  let prHint = '提交、推送并创建 PR';
  let prCommand: BuiltinCommand = 'create-pr';
  let prPrompt: string;
  if (pr && open) {
    prLabel = 'Update PR';
    prCommand = 'update-pr';
    prHint = `${dirty > 0 ? '提交、' : ''}推送并更新 PR #${pr.num}`;
    prPrompt = `${commitFirst}把分支 ${branch} 推送到 origin，让 PR #${pr.num} 带上这些新提交；PR 标题或描述需要同步就用 ${w.edit} 更新，最后告诉我 PR 链接。`;
  } else if (pr) {
    prLabel = 'New PR';
    prCommand = 'new-pr';
    prHint = `PR #${pr.num} 已${pr.state === 'merged' ? '合入' : '关闭'}，重新提一个`;
    prPrompt = `PR #${pr.num} 已经${pr.state === 'merged' ? '合入' : '关闭'}：${commitFirst}从当前分支创建新分支并推送，然后用 ${w.create} 创建新的 PR${target}，最后告诉我 PR 链接。`;
  } else if (onBase) {
    prHint = dirty > 0 ? '新建分支后提交并提 PR' : '新建分支后提 PR';
    prPrompt = dirty > 0
      ? `当前在 ${baseBranch} 上，不要直接往它提交：基于当前改动建一个功能分支，在新分支上提交并推送，然后用 ${w.create} 创建 PR${target}，最后告诉我 PR 链接。`
      : `当前在 ${baseBranch} 上：创建一个包含当前提交的功能分支并推送到 origin，然后用 ${w.create} 从该分支创建 PR${target}，最后告诉我 PR 链接。`;
  } else {
    prPrompt = `${commitFirst}把分支 ${branch} 推送到 origin，然后用 ${w.create} 创建 PR${target}，最后告诉我 PR 链接。`;
  }
  const actions: GitActionItem[] = [
    // With a PR already open, a fresh one only makes sense once there is something new to put in it.
    { act: 'pr', label: prLabel, hint: prHint, command: prCommand, prompt: prPrompt, enabled: pr ? work : work || !onBase },
    { act: 'commit', label: 'Commit', hint: dirty > 0 ? `提交 ${dirty} 个未提交的改动` : '没有需要提交的改动', command: 'commit', prompt: commitPrompt, enabled: dirty > 0 },
    { act: 'push', label: 'Push', hint: unpushed ? (ahead > 0 ? `推送 ${ahead} 个已提交的改动` : '首次推送这个分支') : '没有待推送的提交', command: 'push', prompt: pushPrompt, enabled: unpushed },
  ];
  // Submit the PR by default; on the base branch itself that would mean branching off, so
  // the default there is the smaller direct git step instead.
  const primary: GitAction | null = pr
    ? (work ? 'pr' : null)
    : onBase
      ? (dirty > 0 ? 'commit' : unpushed ? 'push' : null)
      : 'pr';
  return { actions, primary };
}
