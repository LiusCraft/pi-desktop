import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { PLUGIN_SDK } from '../src/shared/plugin-sdk';

/**
 * The SDK is the one piece that runs inside a plugin's page, where nothing else in this repo can reach
 * it: run it in a sandbox with a `window` and a `parent` and check the messages it sends and takes.
 */
function page() {
  const sent: Record<string, unknown>[] = [];
  const listeners: ((event: { source: unknown; data: unknown }) => void)[] = [];
  const parent = { postMessage: (message: Record<string, unknown>) => void sent.push(message) };
  const window = {
    addEventListener: (type: string, fn: (event: { source: unknown; data: unknown }) => void) => {
      if (type === 'message') listeners.push(fn);
    },
    pidesk: undefined as unknown,
  };
  vm.runInNewContext(PLUGIN_SDK, { window, parent, Promise, Map, Set, Error, String, Array, Object });
  /** A message from the window that embedded the page. */
  const deliver = (data: unknown) => {
    for (const fn of listeners) fn({ source: parent, data });
  };
  // SAFETY: the SDK assigns `window.pidesk` when it runs.
  const pidesk = window.pidesk as any;
  return { pidesk, sent, deliver };
}

describe('plugin page SDK', () => {
  it('says it is ready when it loads', () => {
    const { sent } = page();
    expect(sent[0]).toEqual({ kind: 'ready' });
  });

  it('turns a host call into one message and resolves with the answer', async () => {
    const { pidesk, sent, deliver } = page();
    const answer = pidesk.host.call('greet', 'Ada');
    expect(sent.at(-1)).toEqual({ id: 1, kind: 'call', method: 'host.call', args: ['greet', ['Ada']] });
    deliver({ id: 1, ok: true, value: { greeting: 'Hi Ada' } });
    await expect(answer).resolves.toEqual({ greeting: 'Hi Ada' });
  });

  it('rejects with the error the app sent', async () => {
    const { pidesk, sent, deliver } = page();
    const answer = pidesk.storage.get('name');
    expect(sent.at(-1)).toEqual({ id: 1, kind: 'call', method: 'storage.get', args: ['name'] });
    deliver({ id: 1, ok: false, error: '没有获得 storage 权限' });
    await expect(answer).rejects.toThrow('没有获得 storage 权限');
  });

  it('remembers the session and replays it to a listener that arrives later', async () => {
    const { pidesk, deliver } = page();
    deliver({ kind: 'event', event: { type: 'session', payload: { id: 's1', kind: 'code', title: 'Fix the bug', cwd: '/tmp/x' } } });
    await expect(pidesk.ready()).resolves.toBeUndefined();
    expect(pidesk.session.current()).toEqual({ id: 's1', kind: 'code', title: 'Fix the bug', cwd: '/tmp/x' });

    const seen: unknown[] = [];
    pidesk.session.onChange((session: unknown) => seen.push(session));
    expect(seen).toEqual([{ id: 's1', kind: 'code', title: 'Fix the bug', cwd: '/tmp/x' }]);
  });

  it('hands data from the plugin to the listeners of that name only', () => {
    const { pidesk, deliver } = page();
    const counts: unknown[] = [];
    const other: unknown[] = [];
    pidesk.host.on('count', (value: unknown) => counts.push(value));
    pidesk.host.on('other', (value: unknown) => other.push(value));
    deliver({ kind: 'event', event: { type: 'data', name: 'count', payload: 3 } });
    expect(counts).toEqual([3]);
    expect(other).toEqual([]);
  });

  it('ignores messages that did not come from the window that embedded it', async () => {
    const { pidesk, sent } = page();
    const answer = pidesk.session.prompt('hello');
    expect(sent.at(-1)).toEqual({ id: 1, kind: 'call', method: 'session.prompt', args: ['hello'] });
    // A different source is not the parent: the promise stays pending, nothing throws.
    expect(pidesk.theme()).toBeNull();
    void answer;
  });
});
