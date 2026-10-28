// What the branch bar can do next — PR, commit, push — and which one its main button runs.
// Each action becomes a prompt: the agent runs git/gh/glab, the bar only decides what to ask for.
import type { BuiltinCommand } from '@shared/command-message';
import { forgeWords, type Forge } from '@shared/forge';
import type { GitState, PrSummary, SyncStrategy } from '@shared/protocol';
import { tr } from '@shared/i18n/runtime';

export type GitAction = 'pr' | 'commit' | 'push' | 'sync';

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
  /** How new commits on the base branch are brought in. */
  strategy: SyncStrategy;
}

/**
 * The three ways to send the branch's work, plus the one the bar offers by default.
 * `primary` is null when the branch owes nothing — the bar then reports status only.
 */
/** A prompt starts a sentence: an optional lead-in may have put a lowercase verb first. */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function gitActions({ branch, baseBranch, st, pr, forge, strategy }: BranchWork): { actions: GitActionItem[]; primary: GitAction | null } {
  const w = forgeWords(forge);
  const onBase = !baseBranch || branch === baseBranch;
  const dirty = st?.dirty.length ?? 0;
  const ahead = st?.ahead ?? 0;
  // A branch with no upstream still owes its first push.
  const unpushed = ahead > 0 || (!!st && !st.upstream);
  const work = dirty > 0 || unpushed;
  const open = !!pr && (pr.state === 'open' || pr.state === 'draft');
  const target = baseBranch ? tr('gitact.target', { base: baseBranch }) : '';
  const commitPrompt = tr('gitact.commitPrompt');
  const pushPrompt = tr('gitact.pushPrompt', { branch });
  // Nothing to commit is common when only unpushed commits are pending; do not ask for a commit then.
  const first = dirty > 0 ? tr('gitact.commitFirst') : '';
  let prLabel = tr('gitact.createLabel');
  let prHint = tr('gitact.createHint');
  let prCommand: BuiltinCommand = 'create-pr';
  let prPrompt: string;
  if (pr && open) {
    prLabel = tr('gitact.updateLabel');
    prCommand = 'update-pr';
    prHint = tr(dirty > 0 ? 'gitact.updateHintDirty' : 'gitact.updateHint', { num: pr.num });
    prPrompt = sentence(tr('gitact.updatePrompt', { first, branch, num: pr.num, edit: w.edit }));
  } else if (pr) {
    prLabel = tr('gitact.newLabel');
    prCommand = 'new-pr';
    const merged = pr.state === 'merged';
    prHint = tr(merged ? 'gitact.newHintMerged' : 'gitact.newHintClosed', { num: pr.num });
    prPrompt = tr(merged ? 'gitact.newPromptMerged' : 'gitact.newPromptClosed', { num: pr.num, first, create: w.create, target });
  } else if (onBase) {
    prHint = tr(dirty > 0 ? 'gitact.branchHintDirty' : 'gitact.branchHint');
    prPrompt = tr(dirty > 0 ? 'gitact.branchPromptDirty' : 'gitact.branchPrompt', { base: baseBranch ?? '', create: w.create, target });
  } else {
    prPrompt = sentence(tr('gitact.createPrompt', { first, branch, create: w.create, target }));
  }
  const actions: GitActionItem[] = [
    // With a PR already open, a fresh one only makes sense once there is something new to put in it.
    { act: 'pr', label: prLabel, hint: prHint, command: prCommand, prompt: prPrompt, enabled: pr ? work : work || !onBase },
    { act: 'commit', label: tr('gitact.commit'), hint: dirty > 0 ? tr('gitact.commitHint', { n: dirty }) : tr('gitact.commitNone'), command: 'commit', prompt: commitPrompt, enabled: dirty > 0 },
    { act: 'push', label: tr('gitact.push'), hint: unpushed ? (ahead > 0 ? tr('gitact.pushHintAhead', { n: ahead }) : tr('gitact.pushHintFirst')) : tr('gitact.pushNone'), command: 'push', prompt: pushPrompt, enabled: unpushed },
  ];
  // Only a feature branch can fall behind its base; the action never becomes the default button.
  if (!onBase) {
    const behind = st?.baseBehind ?? 0;
    // The open PR's target (as the host measured it) beats the session's base.
    const base = st?.base ?? baseBranch!;
    const rebase = strategy === 'rebase';
    actions.push({
      act: 'sync',
      label: tr(rebase ? 'gitact.syncRebase' : 'gitact.syncMerge', { base }),
      hint: behind > 0 ? tr('gitact.syncHint', { base, n: behind }) : tr('gitact.syncNone'),
      command: 'sync-base',
      prompt: tr(rebase ? 'gitact.syncRebasePrompt' : 'gitact.syncMergePrompt', { base, branch }),
      enabled: behind > 0,
    });
  }
  // Submit the PR by default; on the base branch itself that would mean branching off, so
  // the default there is the smaller direct git step instead.
  const primary: GitAction | null = pr
    ? (work ? 'pr' : null)
    : onBase
      ? (dirty > 0 ? 'commit' : unpushed ? 'push' : null)
      : 'pr';
  return { actions, primary };
}
