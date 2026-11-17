// /reload is a host operation, never a model prompt; host change signals refresh every loaded view.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionMeta, SlashCommand } from '../src/shared/protocol';

vi.mock('sonner', () => ({
  toast: { error: vi.fn<(message: string) => void>(), warning: vi.fn<(message: string) => void>() },
}));

const calls: { channel: string; args: unknown[] }[] = [];
let reload: () => Promise<void>;
let commands: SlashCommand[] = [];
const invoke = (channel: string, ...args: unknown[]) => {
  calls.push({ channel, args });
  if (channel === 'sessions:reload') return reload();
  if (channel === 'sessions:commands') return Promise.resolve(commands);
  if (channel === 'sessions:state')
    return Promise.resolve({ model: 'demo/demo-coder', thinking: 'low', levels: ['low'], stats: null });
  return Promise.resolve(null);
};
Object.assign(globalThis, {
  window: {
    piDesktop: { platform: 'linux', boot: { settings: {}, info: {} }, invoke },
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  },
});

const { send, handleHostEvent } = await import('../src/renderer/src/store/actions');
const { emptySession } = await import('../src/renderer/src/store/transcript');
const { getApp, setApp } = await import('../src/renderer/src/store/app');
const { activeDraft, drafts, sessionDraftKey } = await import('../src/renderer/src/store/drafts');
const { desktopCommands } = await import('../src/renderer/src/lib/constants');
const { toast } = await import('sonner');
const meta = { id: 's1', title: 'Main', kind: 'code', projectPath: '/p', cwd: '/p' } as SessionMeta;
const key = sessionDraftKey(meta.id);

beforeEach(() => {
  calls.length = 0;
  commands = [];
  reload = async () => {};
  vi.clearAllMocks();
  setApp((st) => {
    st.sessions = { [meta.id]: emptySession(meta) };
    st.sessions[meta.id].loaded = true;
    st.sessions[meta.id].items = [{ kind: 'note', key: 'kept', text: 'Keep this history' }];
    st.current = meta.id;
  });
  drafts.activate(key);
  drafts.clear(key);
  drafts.setText(key, '/reload');
});

describe('composer reload', () => {
  it('offers /reload and sends it to the host without adding a conversation message', async () => {
    let finish!: () => void;
    reload = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    expect(desktopCommands().some(([name]) => name === '/reload')).toBe(true);
    const pending = send();
    expect(calls).toEqual([{ channel: 'sessions:reload', args: [meta.id] }]);
    expect(getApp().sessions[meta.id].historyBusy).toBe(true);
    finish();
    await pending;
    expect(activeDraft()!.text).toBe('');
    expect(getApp().sessions[meta.id].historyBusy).toBe(false);
    expect(getApp().sessions[meta.id].items).toEqual([{ kind: 'note', key: 'kept', text: 'Keep this history' }]);
  });

  it('keeps the command for retry and unlocks the composer when reload fails', async () => {
    reload = async () => {
      throw new Error('busy');
    };
    await send();
    expect(activeDraft()!.text).toBe('/reload');
    expect(getApp().sessions[meta.id].historyBusy).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('busy');
  });

  it('does not clear text edited while resources were loading', async () => {
    let finish!: () => void;
    reload = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    const pending = send();
    drafts.setText(key, 'Next question');
    finish();
    await pending;
    expect(activeDraft()!.text).toBe('Next question');
  });

  it('does not create a session just to reload or send attached context to the model', async () => {
    setApp((st) => void (st.current = null));
    await send();
    expect(calls).toEqual([]);
    expect(activeDraft()!.text).toBe('/reload');
    expect(toast.warning).toHaveBeenCalledOnce();
    setApp((st) => void (st.current = meta.id));
    drafts.addReference(key, { id: 'ref', kind: 'quote', path: '', text: 'Quoted context' });
    await send();
    expect(calls).toEqual([]);
    expect(activeDraft()!.references).toHaveLength(1);
  });

  it('refreshes commands and state for every loaded session on the host signal, without replaying history', async () => {
    setApp((st) => {
      st.sessions.s2 = emptySession({ ...meta, id: 's2' });
      st.sessions.s2.loaded = true;
      st.sessions.s3 = emptySession({ ...meta, id: 's3' });
    });
    commands = [{ name: 'skill:reloaded', description: 'New skill', source: 'skill' }];
    handleHostEvent({ type: 'changed', resource: 'sessionResources' });
    await vi.waitFor(() => {
      expect(getApp().sessions.s1.commands).toEqual(commands);
      expect(getApp().sessions.s2.commands).toEqual(commands);
    });
    expect(calls.filter((c) => c.channel === 'sessions:state').map((c) => c.args[0])).toEqual(['s1', 's2']);
    expect(calls.some((c) => c.channel === 'sessions:open')).toBe(false);
    expect(getApp().sessions.s1.items).toHaveLength(1);
    expect(getApp().sessions.s3.commands).toEqual([]);
  });
});
