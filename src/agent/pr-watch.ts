// What changed on a session's pull request, and what the session's switches say to do about it.
// The hub owns the timer and the `gh` call; this class only diffs, so the rules can be tested
// without a repository, a network or a clock.
import type { PrNote } from '@shared/pr-event';
import type { PrEvent } from '@shared/pr-event';
import { prFixKey, prReady } from '@shared/pr-status';
import type { PrStatus } from '@shared/protocol';
import type { PrSnapshot } from './git';

/** How often to look: quick while CI is moving, rarely once it is settled. */
export const FAST_MS = 15_000;
export const SLOW_MS = 60_000;
/** `gh` missing or rate-limited: stop hammering it. */
export const BACKOFF_MS = 5 * 60_000;

export interface PrWatchConfig {
  autoFixCi?: boolean;
  autoMerge?: boolean;
  /** What the automation already handled, from the session meta. */
  done?: { fix?: string; merge?: number };
}

export interface PrPending {
  event: PrEvent;
  /** The key the host records on the session once the turn has been handed over. */
  mark?: { fix?: string; merge?: number };
}

export interface PrWatchResult {
  /** Status for the PR bar; the last known one when this look failed. */
  status: PrStatus | null;
  pending: PrPending | null;
  /** How long the hub should wait before looking again. */
  after: number;
  /** Merged or closed: nothing left to watch. */
  done: boolean;
}

const BOT = /\[bot\]$/i;

export class PrWatcher {
  /** Note ids already accounted for: the baseline plus everything raised or accepted. */
  private seen = new Set<string>();
  private baselined = false;
  private last: PrStatus | null = null;
  private misses = 0;

  observe(snapshot: PrSnapshot | null, cfg: PrWatchConfig): PrWatchResult {
    if (!snapshot) {
      this.misses++;
      return { status: this.last, pending: null, after: this.misses > 2 ? BACKOFF_MS : SLOW_MS, done: false };
    }
    this.misses = 0;
    const pr = snapshot.status;
    this.last = pr;
    // Comments already on the PR when we start watching are history, not news.
    const notes = snapshot.notes.filter((n) => !n.self && !BOT.test(n.author));
    if (!this.baselined) {
      this.baselined = true;
      for (const n of notes) this.seen.add(n.id);
    }
    const fresh = notes.filter((n) => !this.seen.has(n.id));
    const pending = this.pick(pr, fresh, cfg);
    const done = pr.state !== 'open';
    return {
      status: pr,
      pending,
      after: done ? SLOW_MS : pr.ci === 'pending' || pending ? FAST_MS : SLOW_MS,
      done,
    };
  }

  /** The host handed the event to the agent: the same notes must not raise another turn. */
  accept(pending: PrPending) {
    for (const n of pending.event.notes ?? []) this.seen.add(n.id);
  }

  /** Everything for a fresh watch: the next look re-baselines the comments. */
  reset() {
    this.seen.clear();
    this.baselined = false;
    this.misses = 0;
  }

  private pick(pr: PrStatus, fresh: PrNote[], cfg: PrWatchConfig): PrPending | null {
    if (pr.state !== 'open') return null;
    const fix = cfg.autoFixCi ? prFixKey(pr) : null;
    if (fix && cfg.done?.fix !== fix) {
      const failed = (pr.checks ?? []).filter((c) => c.st === 'fail').map((c) => ({ name: c.n, url: c.url }));
      // The fix turn handles open comments too, so carry them along instead of raising a second turn.
      const withNotes = fresh.length ? ` · ${fresh.length} 条新评论` : '';
      return {
        mark: { fix },
        event: {
          kind: 'ci-fail',
          num: pr.num,
          url: pr.url,
          head: pr.head,
          summary: `${failed.length ? `${failed.map((f) => f.name).join('、')} 失败` : 'CI 失败'}${withNotes}`,
          failed,
          ...(fresh.length ? { notes: fresh } : {}),
          instruction: `用 gh pr checks ${pr.num} 和 gh run view --log-failed 读出失败原因，修好代码后提交并推送到当前分支；PR #${pr.num} 上未解决的评审意见也一并处理，直到检查不再失败。`,
        },
      };
    }
    if (cfg.autoFixCi && fresh.length) {
      const who = [...new Set(fresh.map((n) => `@${n.author}`))].join('、');
      return {
        event: {
          kind: 'notes',
          num: pr.num,
          url: pr.url,
          head: pr.head,
          summary: `${fresh.length} 条新评论 · ${who}`,
          notes: fresh,
          instruction: `用 gh pr view ${pr.num} --comments 读清每条意见（行内评论用 gh api repos/{owner}/{repo}/pulls/${pr.num}/comments），改完提交并推送到当前分支，把已解决的评论逐条回复，再告诉我还剩哪些需要人来确认。`,
        },
      };
    }
    if (cfg.autoMerge && prReady(pr) && cfg.done?.merge !== pr.num) {
      return {
        mark: { merge: pr.num },
        event: {
          kind: 'merge',
          num: pr.num,
          url: pr.url,
          head: pr.head,
          summary: '检查全绿、没有冲突，可以合并了',
          instruction: `用 gh pr merge ${pr.num} --auto --squash 开启自动合并（仓库不允许 --auto 就直接合并），不要删除分支，合并后把结果告诉我。`,
        },
      };
    }
    return null;
  }
}
