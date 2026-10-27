// The Activity log: one small JSON file in Pi Desktop's own data directory, appended to by the app.
import { dayKey, emptyDay, HOURS_PER_DAY, type ActivityLog } from '@shared/activity';
import type { SessionKind } from '@shared/protocol';
import type { Store } from './store';

const STORE_KEY = 'activity';

export class ActivityRecorder {
  private log: ActivityLog;

  constructor(private readonly store: Store) {
    this.log = store.get<ActivityLog>(STORE_KEY, {});
  }

  /** The user sent a prompt in a session working in `project` (`TEMPORARY_WORKSPACE` for a scratch folder). */
  recordPrompt(kind: SessionKind, sessionId: string, project: string, at = Date.now()) {
    const key = dayKey(at);
    const day = (this.log[key] ??= emptyDay());
    // Days written before hours and projects were tracked lack them.
    day.hours ??= Array(HOURS_PER_DAY).fill(0);
    day.projects ??= {};
    day.prompts[kind] = (day.prompts[kind] ?? 0) + 1;
    day.hours[new Date(at).getHours()]++;
    day.projects[project] = (day.projects[project] ?? 0) + 1;
    if (!day.sessions.includes(sessionId)) day.sessions.push(sessionId);
    this.store.set(STORE_KEY, this.log);
  }

  get(): ActivityLog {
    return this.log;
  }
}
