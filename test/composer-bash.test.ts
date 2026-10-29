// The renderer's side of `!command`: the transcript item it opens, the streamed output, and the result.
//
// The store talks to the host through `window.piDesktop`, so this file puts a bridge in place before
// importing it — the same shape the preload exposes in the real window.
import { beforeEach, describe, expect, it } from 'vitest';
import type { HostEvent } from '../src/shared/protocol';
import type { SessionMeta } from '../src/shared/protocol';

const meta = { id: 's1', title: 'Main', kind: 'code', projectPath: '/p', cwd: '/p' } as SessionMeta;

/** What the fake host answers for `sessions:bash`; the test decides per call. */
let answer: (command: string) => Promise<unknown>;
const ran: { command: string; options: { excludeFromContext?: boolean; id?: string } }[] = [];
/** Frames `requestAnimationFrame` queued: host events are folded a frame at a time. */
const frames: (() => void)[] = [];

/** A DOM node stub; `sonner` injects its stylesheet at import time. */
const node = () => ({
  style: {} as Record<string, unknown>,
  appendChild: () => {},
  setAttribute: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
});

Object.assign(globalThis, {
  window: {
    piDesktop: {
      platform: 'linux',
      boot: { settings: {}, info: {} },
      getPathForFile: () => '',
      invoke: (channel: string, ...args: unknown[]) => {
        if (channel !== 'sessions:bash') return Promise.resolve(null);
        const record = {
          command: String(args[1]),
          options: args[2] as { excludeFromContext?: boolean; id?: string },
        };
        ran.push(record);
        return answer(record.command);
      },
      on: () => () => {},
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  },
  document: {
    hidden: false,
    documentElement: node(),
    head: node(),
    body: node(),
    createElement: node,
    createTextNode: (text: string) => ({ text }),
    addEventListener: () => {},
    removeEventListener: () => {},
    hasFocus: () => true,
    querySelector: () => null,
  },
  requestAnimationFrame: (cb: () => void) => frames.push(cb),
  cancelAnimationFrame: () => {},
});

const { runBash, send, handleHostEvent } = await import('../src/renderer/src/store/actions');
const { emptySession, findByKey } = await import('../src/renderer/src/store/transcript');
const { getApp, setApp } = await import('../src/renderer/src/store/app');
const { activeDraft, drafts, sessionDraftKey } = await import('../src/renderer/src/store/drafts');
type ShellItem = Extract<import('../src/renderer/src/store/types').Item, { kind: 'bash' }>;

const item = () => {
  const found = findByKey(getApp().sessions[meta.id], ran.at(-1)!.options.id);
  return found?.kind === 'bash' ? (found as ShellItem) : undefined;
};
/** Fold the host events queued this frame, as the next paint would. */
const frame = () => frames.splice(0).forEach((cb) => cb());
const update = (key: string, delta: string) =>
  handleHostEvent({
    type: 'pi',
    sessionId: meta.id,
    event: { type: 'bash_execution_update', id: key, delta },
  } as HostEvent);

beforeEach(() => {
  ran.length = 0;
  frames.length = 0;
  setApp((st) => {
    st.sessions[meta.id] = emptySession(meta);
    st.current = meta.id;
  });
});

describe('runBash', () => {
  it('opens a running item, streams the output into it, then shows the result', async () => {
    let finish!: (result: unknown) => void;
    answer = () => new Promise((resolve) => (finish = resolve));
    const run = runBash(meta.id, 'npm test', false);
    expect(ran[0]).toEqual({ command: 'npm test', options: { excludeFromContext: false, id: expect.any(String) } });
    const key = ran[0].options.id!;
    expect(item()).toMatchObject({ command: 'npm test', output: '', running: true, excluded: false });
    update(key, 'ok 1\n');
    update(key, 'ok 2\n');
    frame();
    expect(item()!.output).toBe('ok 1\nok 2\n');
    finish({ output: 'ok 1\nok 2\n', exitCode: 0, cancelled: false, truncated: false });
    await run;
    expect(item()).toMatchObject({ running: false, output: 'ok 1\nok 2\n', exitCode: 0 });
    // Events are batched: a chunk that lands after the result must not append to it a second time.
    update(key, 'ok 2\n');
    frame();
    expect(item()!.output).toBe('ok 1\nok 2\n');
  });

  it('marks the item failed when the host refuses the command, and keeps ``!!`` marked', async () => {
    answer = async () => {
      throw new Error("Error invoking remote method 'sessions:bash': “!”后面要写命令");
    };
    await runBash(meta.id, '   ', true);
    expect(ran[0].options.excludeFromContext).toBe(true);
    expect(item()).toMatchObject({ running: false, excluded: true });
    // The Electron prefix is stripped for the reader.
    expect(item()!.error).toBe('“!”后面要写命令');
  });

  it('leaves an item that is no longer there alone', async () => {
    answer = async () => ({ output: '', cancelled: false, truncated: false });
    const run = runBash(meta.id, 'ls', false);
    // The session went away while the command ran (deleted, or the host restarted).
    setApp((st) => void delete st.sessions[meta.id]);
    await run;
    expect(getApp().sessions[meta.id]).toBeUndefined();
  });

  it('is what sending a `!` message does, instead of prompting the model', async () => {
    answer = async () => ({ output: 'hi\n', cancelled: false, truncated: false });
    const key = sessionDraftKey(meta.id);
    drafts.activate(key);
    drafts.setText(key, '!echo hi');
    await send();
    expect(ran).toHaveLength(1);
    expect(ran[0].command).toBe('echo hi');
    // The message becomes the command: the input box is empty again, nothing was prompted.
    expect(activeDraft()!.text).toBe('');
    const ranItem = item()!;
    expect(ranItem).toMatchObject({ command: 'echo hi', output: 'hi\n', running: false });
  });
});
