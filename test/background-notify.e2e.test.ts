// End-to-end: a real pi AgentSession with desktop-kit, driven by a scripted offline model.
// Proves the wake-up the prompt relies on: a background task that finishes while the
// session sits idle (its turn already ended) starts a new turn by itself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage as msg, fauxProvider, fauxText as text, fauxToolCall as call } from '@earendil-works/pi-ai';
import { createDesktopKit } from '../src/agent/desktop-kit';
import { toWireEvent } from '../src/agent/events';
import { applyPiEvent, emptySession } from '../src/renderer/src/store/transcript';
import type { PiEvent, SessionMeta, TaskUpdate } from '../src/shared/protocol';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-notify-'));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits for `cond`, failing the test rather than hanging when it never comes true. */
async function until(cond: () => boolean, ms = 20_000) {
  for (let waited = 0; waited < ms; waited += 50) {
    if (cond()) return;
    await sleep(50);
  }
  expect(cond()).toBe(true);
}

/**
 * A real session in its own folder with the desktop kit and a scripted model: step `n`
 * is the model's n-th request of the session.
 */
async function makeSession(script: (step: number) => ReturnType<typeof msg>) {
  const cwd = fs.mkdtempSync(path.join(tmp, 'session-'));
  const agentDir = path.join(tmp, 'agent');
  fs.mkdirSync(agentDir, { recursive: true });
  // Offline: the test needs a model runtime, not the real catalog.
  const models = await ModelRuntime.create({
    authPath: path.join(agentDir, 'auth.json'),
    modelsPath: path.join(agentDir, 'models.json'),
    refreshOnCreate: false,
  });
  let step = 0;
  const faux = fauxProvider({
    provider: 'scripted',
    models: [{ id: 'm', name: 'Scripted', contextWindow: 100_000, maxTokens: 4_000 }],
    tokensPerSecond: 10_000,
  });
  const next = () => {
    faux.appendResponses([next]);
    step += 1;
    return script(step);
  };
  faux.setResponses([next]);
  models.registerNativeProvider(faux.provider);

  const tasks: TaskUpdate[] = [];
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    extensionFactories: [
      createDesktopKit({
        // bypass: the point of the test is the notification, not the permission card.
        state: { mode: 'bypass', profile: 'code', outputStyle: 'default', allowed: new Set() },
        ask: async () => ({ cancelled: true }),
        setMode: () => {},
        taskUpdate: (update) => tasks.push(update),
      }),
    ],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime: models, model: models.getModel('scripted', 'm')!, resourceLoader, settingsManager,
    sessionManager: SessionManager.inMemory(cwd), tools: ['+grep', '+find', '+ls'],
  });
  await session.bindExtensions({});
  const custom: any[] = [];
  const wire: PiEvent[] = [];
  session.subscribe((event: any) => {
    if (event.type === 'message_end' && event.message.role === 'custom') custom.push(event.message);
    const forwarded = toWireEvent(event);
    if (forwarded) wire.push(forwarded);
  });
  return { session, tasks, custom, wire };
}

const assistantTexts = (session: { messages: unknown }) =>
  (session.messages as any[]).filter((m) => m.role === 'assistant')
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []).filter((c: any) => c.type === 'text').map((c: any) => c.text));

describe('background task notifications', () => {
  it('wakes the model when a shell command exits after the turn ended', async () => {
    const { session, tasks, custom, wire } = await makeSession((step) => (step === 1
      ? msg([call('pidesk_bg_shell', { command: 'node -e "setTimeout(() => console.log(\'bg-done\'), 800)"', description: 'Slow command' })], { stopReason: 'toolUse' })
      : msg([text(`answer ${step}`)])));

    await session.prompt('start a slow command in the background');
    // The turn ended on its own (step 2 answered), while the command still runs.
    expect(session.isIdle).toBe(true);
    expect(assistantTexts(session)).toContain('answer 2');
    expect(tasks.filter((t) => t.state !== 'running')).toEqual([]);
    expect(custom).toHaveLength(0);

    // Nobody prompts: the exit notification has to start the next turn itself.
    await until(() => assistantTexts(session).includes('answer 3'));
    expect(custom).toHaveLength(1);
    expect(custom[0].customType).toBe('pi-desktop-task-notification');
    expect(custom[0].content).toMatch(/exited with code 0/);
    expect(custom[0].content).toMatch(/bg-done/);
    expect(tasks.at(-1)).toMatchObject({ state: 'done', shell: { exitCode: 0 } });

    // What the app shows: the events the host forwards to the renderer put the wake-up turn
    // in the transcript, and the notification itself stays invisible.
    const view = emptySession({ id: 's1' } as SessionMeta);
    const wake = wire.findIndex((e, i) => e.type === 'agent_start' && i > 0);
    expect(wake).toBeGreaterThan(0);
    for (const [i, event] of wire.entries()) {
      applyPiEvent(view, event, 'normal');
      if (i === wake) expect(view.running).toBe(true); // the UI shows the new turn as running
    }
    const shown = view.items.flatMap((item) => (item.kind === 'text' ? [item.text] : []));
    expect(shown).toContain('answer 2');
    expect(shown).toContain('answer 3');
    // Only the prompt the test sent: the notification is a custom message and gets no bubble.
    const users = view.items.flatMap((item) => (item.kind === 'user' ? [item.text] : []));
    expect(users).toEqual(['start a slow command in the background']);
    expect(view.running).toBe(false);
  }, 60_000);
});
