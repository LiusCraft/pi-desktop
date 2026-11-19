// What changed on a session's pull request, and what the session's switches say to do about it.
// The hub owns the timer and the `gh` / `glab` call; this class only diffs, so the rules can be
// tested without a repository, a network or a clock.
import { tr } from '@shared/i18n/runtime';
import type { PrNote } from '@shared/pr-event';
import type { PrEvent } from '@shared/pr-event';
import { forgeWords } from '@shared/forge';
import { prFixKey, prHeadKey, prReady } from '@shared/pr-status';
import type { PrAutoDone, PrStatus } from '@shared/protocol';
import type { PrSnapshot } from './git';

/** How often to look: quick while CI is moving, rarely once it is settled. */
export const FAST_MS = 15_000;
export const SLOW_MS = 60_000;
/** `gh` / `glab` missing or rate-limited: stop hammering it. */
export const BACKOFF_MS = 5 * 60_000;
/** Open PRs of sessions nobody has open: only the sidebar and inbox show them, so a slow look is enough. */
export const IDLE_MS = 5 * 60_000;
/** The first such look after start, once the app has settled. */
export const IDLE_FIRST_MS = 15_000;

export interface PrWatchConfig {
  autoFixCi?: boolean;
  autoMerge?: boolean;
  /** What the automation already handled, from the session meta. */
  done?: PrAutoDone;
}

export interface PrPending {
  event: PrEvent;
  /** The key the host records on the session once the turn has been handed over. */
  mark?: PrAutoDone;
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
    const w = forgeWords(pr.forge);
    const fix = cfg.autoFixCi ? prFixKey(pr) : null;
    const conflict = cfg.autoFixCi && pr.mergeable === 'conflicting' ? prHeadKey(pr) : null;
    // CI and conflicts can appear separately on the same head, or together in one look.
    const mark: PrAutoDone = {};
    if (conflict && cfg.done?.conflict !== conflict) mark.conflict = conflict;
    if (fix && cfg.done?.fix !== fix) mark.fix = fix;
    if (mark.conflict || mark.fix) {
      const summary: string[] = [];
      const instructions: string[] = [];
      if (mark.conflict) {
        const base = pr.base ?? tr('gitact.targetFallback');
        summary.push(tr('ag.prConflictWith', { base }));
        instructions.push(tr('ag.prResolveConflicts', { base }));
      }
      const failed = mark.fix ? pr.checks.filter((c) => c.st === 'fail').map((c) => ({ name: c.n, url: c.url })) : [];
      if (mark.fix) {
        summary.push(
          failed.length
            ? tr('ag.prFailedNamed', { names: failed.map((f) => f.name).join(tr('ag.prNamesSep')) })
            : tr('ag.prCiFailed'),
        );
        instructions.push(tr('ag.prFixCi', { checks: w.checks(pr.num) }));
      }
      if (fresh.length) summary.push(tr('ag.prNewComments', { n: fresh.length }));
      instructions.push(tr('ag.prFinishFix', { noun: w.noun, num: pr.num }));
      return {
        mark,
        event: {
          kind: mark.conflict ? 'conflict' : 'ci-fail',
          num: pr.num,
          url: pr.url,
          head: pr.head,
          summary: summary.join(' · '),
          ...(failed.length ? { failed } : {}),
          ...(fresh.length ? { notes: fresh } : {}),
          instruction: instructions.join('\n'),
        },
      };
    }
    if (cfg.autoFixCi && fresh.length) {
      const who = [...new Set(fresh.map((n) => `@${n.author}`))].join(tr('ag.prNamesSep'));
      return {
        event: {
          kind: 'notes',
          num: pr.num,
          url: pr.url,
          head: pr.head,
          summary: `${tr('ag.prNewComments', { n: fresh.length })} · ${who}`,
          notes: fresh,
          instruction: tr('ag.prNotes', { comments: w.comments(pr.num), inline: w.inlineComments(pr.num) }),
        },
      };
    }
    const merge = cfg.autoMerge && prReady(pr) ? prHeadKey(pr) : null;
    if (merge && cfg.done?.merge !== merge) {
      return {
        mark: { merge },
        event: {
          kind: 'merge',
          num: pr.num,
          url: pr.url,
          head: pr.head,
          summary: tr('ag.prReady'),
          instruction: tr('ag.prMerge', { merge: w.merge(pr.num) }),
        },
      };
    }
    return null;
  }
}
