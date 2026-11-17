// @vitest-environment jsdom
import { deferred, invoke } from './renderer-dom';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DiffBase, DiffComparison, SessionMeta } from '../src/shared/protocol';

const { useDiffComparison } = await import('../src/renderer/src/components/workspace/useDiffComparison');
const { emptySession } = await import('../src/renderer/src/store/transcript');
const meta = { id: 'hook', cwd: '/project', kind: 'code', baseCommit: 'initial', branch: 'topic' } as SessionMeta;
const session = () => emptySession(meta);
const branch: DiffBase = { kind: 'branch', ref: 'main' };
const comparison = (base: string): DiffComparison => ({ base, files: [], commits: [] });

describe('mounted Diff comparisons', () => {
  it('loads only enabled sources and preserves unchanged data identity across refreshes', async () => {
    const data = comparison('base');
    invoke.mockResolvedValue(data);
    const s = session();
    const { result, rerender } = renderHook(
      ({ enabled, version }) => useDiffComparison({ ...s, changesVersion: version }, branch, enabled),
      { initialProps: { enabled: false, version: 0 } },
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
    rerender({ enabled: true, version: 0 });
    await waitFor(() => expect(result.current.data).toEqual(data));
    expect(invoke).toHaveBeenCalledWith('sessions:diff', meta.id, branch);
    const held = result.current.data;
    invoke.mockResolvedValue({ ...data, files: [], commits: [] });
    rerender({ enabled: true, version: 1 });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBe(held);
    invoke.mockResolvedValue(comparison('new-base'));
    rerender({ enabled: true, version: 2 });
    await waitFor(() => expect(result.current.data?.base).toBe('new-base'));
    expect(result.current.data).not.toBe(held);
  });

  it('reloads for turn records and repository changes but not unrelated renders', async () => {
    invoke.mockResolvedValue(comparison('turn'));
    let s = session();
    const { result, rerender } = renderHook(({ view }) => useDiffComparison(view, { kind: 'lastTurn' }, true), {
      initialProps: { view: s },
    });
    await waitFor(() => expect(result.current.data?.base).toBe('turn'));
    rerender({ view: { ...s, statusText: 'unrelated' } });
    expect(invoke).toHaveBeenCalledTimes(1);
    s = { ...s, turnChanges: [] };
    rerender({ view: s });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    s = { ...s, meta: { ...s.meta, baseCommit: 'another-base' } };
    rerender({ view: s });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
    rerender({ view: { ...s, meta: { ...s.meta, branch: 'another-branch' } } });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(4));
  });

  it('clears the previous comparison immediately and ignores late replies from an old scope or session', async () => {
    const oldBranch = deferred<DiffComparison>();
    const oldSession = deferred<DiffComparison>();
    const current = deferred<DiffComparison>();
    invoke
      .mockReturnValueOnce(oldBranch.promise)
      .mockReturnValueOnce(oldSession.promise)
      .mockReturnValueOnce(current.promise);
    const s = session();
    const { result, rerender } = renderHook(
      ({ id, target }) => useDiffComparison({ ...s, meta: { ...meta, id } }, target, true),
      { initialProps: { id: 'old-session', target: branch as DiffBase } },
    );
    rerender({ id: 'old-session', target: { kind: 'lastCommit' } });
    rerender({ id: 'new-session', target: { kind: 'lastCommit' } });
    expect(result.current.data).toBeUndefined();
    await act(async () => {
      current.resolve(comparison('current'));
      oldBranch.resolve(comparison('stale'));
      oldSession.reject(new Error('stale failure'));
    });
    expect(result.current.data?.base).toBe('current');
    expect(result.current.error).toBe(false);
    expect(invoke).toHaveBeenLastCalledWith('sessions:diff', 'new-session', { kind: 'lastCommit' });
  });

  it('does not expose cached data under another branch key while its request is pending', async () => {
    const pending = deferred<DiffComparison>();
    invoke.mockResolvedValueOnce(comparison('main')).mockReturnValueOnce(pending.promise);
    const s = session();
    const { result, rerender } = renderHook(({ ref }) => useDiffComparison(s, { kind: 'branch', ref }, true), {
      initialProps: { ref: 'main' },
    });
    await waitFor(() => expect(result.current.data?.base).toBe('main'));
    rerender({ ref: 'release' });
    expect(result.current.data).toBeUndefined();
    await act(async () => pending.resolve(comparison('release')));
    expect(result.current.data?.base).toBe('release');
  });

  it('reports current errors, retries on refresh, and ignores replies after disable or unmount', async () => {
    invoke.mockRejectedValueOnce(new Error('offline'));
    const s = session();
    const { result, rerender, unmount } = renderHook(
      ({ version, enabled }) => useDiffComparison({ ...s, changesVersion: version }, branch, enabled),
      { initialProps: { version: 0, enabled: true } },
    );
    await waitFor(() => expect(result.current.error).toBe(true));
    invoke.mockResolvedValueOnce(comparison('recovered'));
    rerender({ version: 1, enabled: true });
    await waitFor(() => expect(result.current.data?.base).toBe('recovered'));
    expect(result.current.error).toBe(false);
    const disabled = deferred<DiffComparison>();
    invoke.mockReturnValueOnce(disabled.promise);
    rerender({ version: 2, enabled: true });
    rerender({ version: 2, enabled: false });
    await act(async () => disabled.resolve(comparison('disabled')));
    expect(result.current.data?.base).toBe('recovered');
    const removed = deferred<DiffComparison>();
    invoke.mockReturnValueOnce(removed.promise);
    rerender({ version: 2, enabled: true });
    unmount();
    await act(async () => removed.reject(new Error('after unmount')));
    expect(result.current.error).toBe(false);
  });
});
