// Scheduled tasks run on this machine, inside the agent host: a timer checks the saved tasks once
// a minute and starts a fresh session for each one that is due. Like Claude Desktop's local tasks
// they only fire while the app is running; a miss while it was closed is made up with one catch-up run.
import { tr } from '@shared/i18n/runtime';
import crypto from 'node:crypto';
import type { PromptSubmission } from '@shared/attachments';
import type { CreateSessionOptions, SessionMeta } from '@shared/protocol';
import {
  CATCH_UP_MS,
  MAX_TASK_RUNS,
  nextRun,
  validateSchedule,
  type ScheduledTask,
  type TaskDraft,
  type TaskRun,
} from '@shared/schedule';
import type { Store } from './store';

/** What the scheduler needs from the session hub. */
export interface SchedulerHub {
  create(opts: CreateSessionOptions): Promise<SessionMeta>;
  prompt(id: string, payload: PromptSubmission, behavior: 'steer' | 'followUp'): Promise<unknown>;
  /** Tell the renderer about a session it did not create itself. */
  announce(meta: SessionMeta): void;
  isRunning(id: string): boolean;
}

const STORE_KEY = 'scheduled-tasks';
const TICK_MS = 30_000;

export class Scheduler {
  private tasks: ScheduledTask[];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Task ids with a run being started, so a slow worktree checkout is not fired twice. */
  private firing = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly hub: SchedulerHub,
    private readonly onChange: (tasks: ScheduledTask[]) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.tasks = this.store.get<ScheduledTask[]>(STORE_KEY, []);
  }

  list(): ScheduledTask[] {
    return this.tasks.map((t) => ({ ...t }));
  }

  /** Begin ticking, after one pass that catches up on what the closed app missed. */
  start() {
    void this.tick(true);
    this.timer = setInterval(() => void this.tick(false), TICK_MS);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private commit() {
    this.store.set(STORE_KEY, this.tasks);
    this.onChange(this.list());
    return this.list();
  }
  private find(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new Error(tr('ag.taskMissing'));
    return t;
  }

  save(draft: TaskDraft): ScheduledTask[] {
    const name = draft.name.trim();
    const prompt = draft.prompt.trim();
    if (!name) throw new Error(tr('ag.taskNeedName'));
    if (!prompt) throw new Error(tr('ag.taskNeedPrompt'));
    if (draft.kind === 'code' && !draft.projectPath) throw new Error(tr('ag.taskNeedProject'));
    const bad = validateSchedule(draft.schedule, this.now());
    if (bad) throw new Error(bad);
    const existing = draft.id ? this.find(draft.id) : null;
    if (this.tasks.some((t) => t.id !== existing?.id && t.kind === draft.kind && t.name === name))
      throw new Error(tr('ag.taskExists', { name }));
    const fields = {
      name,
      prompt,
      kind: draft.kind,
      projectPath: draft.projectPath,
      worktree: draft.kind === 'code' && draft.worktree,
      mode: draft.mode,
      model: draft.model,
      schedule: draft.schedule,
    };
    if (existing) {
      Object.assign(existing, fields);
      // Saving a finished one-off with a new time brings it back.
      if (draft.schedule.type === 'once') existing.enabled = true;
      existing.nextRunAt = existing.enabled ? nextRun(existing.schedule, this.now()) : null;
    } else {
      this.tasks.unshift({
        id: crypto.randomUUID(),
        ...fields,
        enabled: true,
        createdAt: this.now(),
        nextRunAt: nextRun(draft.schedule, this.now()),
        lastRunAt: null,
        runs: [],
      });
    }
    return this.commit();
  }

  setEnabled(id: string, enabled: boolean): ScheduledTask[] {
    const t = this.find(id);
    t.enabled = enabled;
    t.nextRunAt = enabled ? nextRun(t.schedule, this.now()) : null;
    return this.commit();
  }

  remove(id: string): ScheduledTask[] {
    this.find(id);
    this.tasks = this.tasks.filter((t) => t.id !== id);
    return this.commit();
  }

  /** Run now: starts a session immediately and leaves the schedule alone. */
  async runNow(id: string): Promise<SessionMeta> {
    const t = this.find(id);
    if (this.firing.has(id)) throw new Error(tr('ag.taskStarting'));
    return this.fire(t, false);
  }

  /** Visible for tests: fire whatever is due at `now()`. `startup` allows one catch-up run per task. */
  async tick(startup: boolean) {
    const now = this.now();
    for (const t of this.tasks) {
      if (!t.enabled || t.nextRunAt === null || t.nextRunAt > now) continue;
      const late = now - t.nextRunAt;
      // Only a gap seen at startup is a miss worth making up, and only a recent one.
      const missed = startup && late > TICK_MS * 2;
      if (missed && late > CATCH_UP_MS) {
        this.advance(t, now);
        continue;
      }
      if (this.firing.has(t.id)) continue;
      const running = t.runs.find((r) => r.sessionId)?.sessionId;
      if (running && this.hub.isRunning(running)) {
        this.record(t, { at: now, status: 'skipped', note: tr('ag.taskStillRunning') });
        this.advance(t, now);
        continue;
      }
      try {
        await this.fire(t, true, missed);
      } catch (err) {
        this.record(t, { at: now, status: 'skipped', note: err instanceof Error ? err.message : String(err) });
        this.advance(t, now);
      }
    }
    this.commit();
  }

  /** Move to the next occurrence; a finished one-off turns itself off. */
  private advance(t: ScheduledTask, after: number) {
    t.nextRunAt = nextRun(t.schedule, after);
    if (t.schedule.type === 'once') t.enabled = false;
  }

  private record(t: ScheduledTask, run: TaskRun) {
    t.runs = [run, ...t.runs].slice(0, MAX_TASK_RUNS);
  }

  private async fire(t: ScheduledTask, scheduled: boolean, catchUp = false): Promise<SessionMeta> {
    this.firing.add(t.id);
    try {
      const at = this.now();
      const meta = await this.hub.create({
        kind: t.kind,
        projectPath: t.projectPath,
        worktree: t.worktree,
        title: t.name,
        model: t.model,
        mode: t.mode,
      });
      this.hub.announce(meta);
      this.record(t, { at, sessionId: meta.id, status: 'started', note: catchUp ? tr('ag.taskCatchUp') : undefined });
      t.lastRunAt = at;
      if (scheduled) this.advance(t, at);
      this.commit();
      // The session is the run: a failure to start the turn shows up in it, not as a lost task.
      void this.hub.prompt(meta.id, { text: t.prompt, attachments: [] }, 'followUp').catch(() => {});
      return meta;
    } finally {
      this.firing.delete(t.id);
    }
  }
}
