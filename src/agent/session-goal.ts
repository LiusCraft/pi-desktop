import type { ExtensionContext, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { tr } from '@shared/i18n/runtime';
import { StringEnum } from './tool-schema';

const ENTRY = 'pi-desktop-goal';
const MAX_CONTINUATIONS = 10;
const OUTCOMES = ['complete', 'blocked'] as const;
interface Goal {
  objective: string;
  status: 'active' | 'paused' | (typeof OUTCOMES)[number];
  reason?: string;
}
const labels = {
  active: 'ag.goalActive',
  paused: 'ag.goalPaused',
  blocked: 'ag.goalBlocked',
  complete: 'ag.goalComplete',
} as const;

/** Each main session has one goal. The SDK's settle boundary, not a timer or a synthetic user turn,
 * decides when another request is needed. Pi retains ownership of cancellation and permission checks. */
export const sessionGoal: ExtensionFactory = (pi) => {
  let goal: Goal | null = null;
  let continuations = 0;
  const save = (next: Goal | null) => {
    pi.appendEntry(ENTRY, next);
    goal = next;
  };
  const restore = (ctx: ExtensionContext) => {
    goal = null;
    for (const entry of ctx.sessionManager.getBranch().slice().reverse()) {
      if (entry.type !== 'custom' || entry.customType !== ENTRY) continue;
      const saved = entry.data as Goal | null;
      if (saved?.objective && Object.hasOwn(labels, saved.status)) {
        // Opening a session is not consent to start another paid run.
        goal = saved.status === 'active' ? { ...saved, status: 'paused' } : saved;
      }
      break;
    }
  };
  pi.on('session_start', (_event, ctx) => restore(ctx));
  pi.on('session_tree', (_event, ctx) => restore(ctx));

  const status = () =>
    goal ? `${tr(labels[goal.status])}: ${goal.objective}${goal.reason ? `\n${goal.reason}` : ''}` : tr('ag.goalUsage');
  pi.registerCommand('goal', {
    description: tr('ag.goalDescription'),
    handler: async (raw, ctx) => {
      const arg = raw.trim();
      if (!arg) return ctx.ui.notify(status(), 'info');
      if (arg === 'clear' || arg === 'pause') {
        const runningGoal = goal?.status === 'active';
        if (arg === 'clear') save(null);
        else if (runningGoal) save({ objective: goal!.objective, status: 'paused' });
        if (runningGoal && !ctx.isIdle()) ctx.abort();
        return ctx.ui.notify(arg === 'clear' ? tr('ag.goalCleared') : status(), 'info');
      }
      if (arg === 'resume' && (!goal || goal.status === 'complete' || goal.status === 'active'))
        return ctx.ui.notify(status(), 'info');
      if (!ctx.isIdle()) return ctx.ui.notify(tr('ag.goalBusy'), 'warning');
      const objective = arg === 'resume' ? goal!.objective : arg;
      save({ objective, status: 'active' });
      continuations = 0;
      pi.sendUserMessage(objective);
    },
  });
  const instruction = () => tr('ag.goalInstruction', { objective: goal!.objective });
  pi.on('before_agent_start', () => {
    if (goal?.status === 'active') return { message: { customType: ENTRY, content: instruction(), display: false } };
    return undefined;
  });
  pi.registerTool({
    name: 'pidesk_goal_result',
    label: 'Goal result',
    description:
      'Stop the active /goal. Use complete only with evidence that the objective is met. Use blocked when waiting for external work, user input or permission. Never mark a goal complete merely because a turn ended.',
    parameters: Type.Object({ status: StringEnum(OUTCOMES), reason: Type.String({ minLength: 1 }) }),
    async execute(_id, { status: result, reason }) {
      if (goal?.status !== 'active') throw new Error(tr('ag.goalNotActive'));
      if (!reason.trim()) throw new Error(tr('ag.goalNeedReason'));
      save({ ...goal, status: result, reason: reason.trim() });
      return { content: [{ type: 'text', text: status() }], details: { status: result } };
    },
  });
  pi.on('agent_before_settle', (event, ctx) => {
    if (goal?.status !== 'active') return;
    if (event.outcome !== 'completed' || continuations >= MAX_CONTINUATIONS) {
      save({
        ...goal,
        status: 'paused',
        reason: tr(event.outcome === 'completed' ? 'ag.goalLimit' : 'ag.goalInterrupted'),
      });
      ctx.ui.notify(status(), 'warning');
      return;
    }
    continuations++;
    return {
      entries: [
        ...event.entries,
        { type: 'custom_message', customType: ENTRY, content: instruction(), display: false },
      ],
      continue: true,
    };
  });
  pi.on('agent_settled', (event) => {
    if (event.aborted && goal?.status === 'active')
      save({ ...goal, status: 'paused', reason: tr('ag.goalInterrupted') });
  });
};
