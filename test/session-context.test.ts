import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextBreakdown } from '../src/shared/protocol';
import { notifyResource } from '../src/renderer/src/store/resources';

const request = vi.hoisted(() =>
  vi.fn<(channel: 'sessions:context', sid: string) => Promise<ContextBreakdown | null>>(),
);
vi.mock('@/lib/api', () => ({ call: request }));

const { watchSessionContext } = await import('../src/renderer/src/lib/session-context');
const stops: (() => void)[] = [];
const context = (used: number): ContextBreakdown => ({
  contextWindow: 10_000,
  used,
  estimated: true,
  cache: { input: 0, cacheRead: 0, cacheWrite: 0 },
  cost: 0,
  categories: [],
  items: [],
});
function pending() {
  let resolve!: (value: ContextBreakdown | null) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ContextBreakdown | null>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const watch = (sid: string, update: (data: ContextBreakdown | null) => void) => {
  const stop = watchSessionContext(sid, update);
  stops.push(stop);
  return stop;
};
beforeEach(() => request.mockReset());
afterEach(() => stops.splice(0).forEach((stop) => stop()));

describe('session context view lifecycle', () => {
  it('loads on mount and reload signals, but ignores unrelated resource changes', async () => {
    const first = context(100);
    const next = context(200);
    const update = vi.fn<(data: ContextBreakdown | null) => void>();
    request.mockResolvedValueOnce(first).mockResolvedValueOnce(next);
    watch('s1', update);
    expect(request).toHaveBeenCalledExactlyOnceWith('sessions:context', 's1');
    await Promise.resolve();
    expect(update).toHaveBeenLastCalledWith(first);
    notifyResource('customize');
    expect(request).toHaveBeenCalledTimes(1);
    notifyResource('sessionResources');
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(next);
  });

  it('shows a missing result or request failure as null and recovers on reload', async () => {
    const update = vi.fn<(data: ContextBreakdown | null) => void>();
    request
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(context(300));
    watch('s1', update);
    await Promise.resolve();
    expect(update).toHaveBeenLastCalledWith(null);
    notifyResource('sessionResources');
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(null);
    notifyResource('sessionResources');
    await Promise.resolve();
    expect(update).toHaveBeenLastCalledWith(context(300));
  });

  it.each(['success', 'failure'] as const)('ignores a late %s after unmount and unsubscribes', async (outcome) => {
    const result = pending();
    const update = vi.fn<(data: ContextBreakdown | null) => void>();
    request.mockReturnValueOnce(result.promise);
    const stop = watch('s1', update);
    stop();
    if (outcome === 'success') result.resolve(context(100));
    else result.reject(new Error('unmounted'));
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
    notifyResource('sessionResources');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'failure'] as const)(
    'does not let an older %s overwrite the reloaded result',
    async (outcome) => {
      const old = pending();
      const update = vi.fn<(data: ContextBreakdown | null) => void>();
      const fresh = context(500);
      request.mockReturnValueOnce(old.promise).mockResolvedValueOnce(fresh);
      watch('s1', update);
      notifyResource('sessionResources');
      await Promise.resolve();
      expect(update).toHaveBeenCalledExactlyOnceWith(fresh);
      if (outcome === 'success') old.resolve(context(100));
      else old.reject(new Error('outdated'));
      await Promise.resolve();
      expect(update).toHaveBeenCalledExactlyOnceWith(fresh);
    },
  );

  it('keeps subscriptions independent for separate mounted views', async () => {
    const first = vi.fn<(data: ContextBreakdown | null) => void>();
    const second = vi.fn<(data: ContextBreakdown | null) => void>();
    request.mockImplementation(async (_channel, sid) => context(sid === 's1' ? 100 : 200));
    const stopFirst = watch('s1', first);
    watch('s2', second);
    await Promise.resolve();
    expect(first).toHaveBeenCalledExactlyOnceWith(context(100));
    expect(second).toHaveBeenCalledExactlyOnceWith(context(200));
    stopFirst();
    notifyResource('sessionResources');
    await Promise.resolve();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });
});
