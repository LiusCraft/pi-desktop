// @vitest-environment jsdom
import { invoke } from './renderer-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostEvent, SessionMeta, UiRequest } from '../src/shared/protocol';

const { Toaster } = await import('../src/renderer/src/components/ui/sonner');
const { PermItem } = await import('../src/renderer/src/components/thread/Items');
const { toolFromArgs } = await import('../src/renderer/src/lib/tools');
const { handleHostEvent } = await import('../src/renderer/src/store/actions');
const { getApp, setApp } = await import('../src/renderer/src/store/app');
const { emptySession } = await import('../src/renderer/src/store/transcript');
const sid = 'background';
const request = (r: UiRequest): HostEvent => ({ type: 'ui_request', sessionId: sid, request: r });
const permission = (id: string, title: string): UiRequest => ({ kind: 'permission', id, title, toolCallId: id });
const resolved = (requestId: string): HostEvent => ({ type: 'ui_resolved', sessionId: sid, requestId, label: 'Deny' });

async function frame(...events: HostEvent[]) {
  await act(async () => {
    events.forEach(handleHostEvent);
    await new Promise(requestAnimationFrame);
  });
}

beforeEach(() => {
  invoke.mockResolvedValue(null);
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  setApp((st) => {
    st.sessions = {};
    for (const id of [sid, 'foreground']) {
      const s = emptySession({ id, title: id, kind: 'work' } as SessionMeta);
      s.loaded = true;
      st.sessions[id] = s;
    }
    st.current = 'foreground';
  });
  render(<Toaster position="bottom-right" />);
});

describe('in-window request shortcuts', () => {
  it('shows one unlabelled summary and the raw command in the permission card', async () => {
    const command = 'git push --force origin main';
    const id = 'review';
    const commandSummary = 'Force-pushes main to origin.';
    const tool = toolFromArgs(id, 'bash', { command });
    setApp((st) => {
      st.current = sid;
      st.sessions[sid].items.push({ kind: 'group', key: 'tools', thoughts: [], tools: [tool], open: false });
    });
    await frame(request({ id, kind: 'permission', title: `Run ${command}`, toolCallId: id, commandSummary }));
    const item = getApp().sessions[sid].items.find((item) => item.kind === 'perm');
    if (!item) throw new Error('Expected a permission item');
    render(<PermItem sid={sid} item={item} />);
    expect(screen.getByText('Allow Pi Desktop to run this command?')).toBeTruthy();
    expect(screen.getByText(commandSummary)).toBeTruthy();
    expect(screen.getByText(command)).toBeTruthy();
  });

  it('shows the AI summary in a background toast but requires opening the session for a long command', async () => {
    const command = `git config --global test.value ${'x'.repeat(200)}`;
    await frame(
      request({
        id: 'review',
        kind: 'permission',
        title: `Run ${command}`,
        toolCallId: 'review',
        commandSummary: 'Changes a global Git setting.',
      }),
    );
    expect(await screen.findByText(/^Changes a global Git setting\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open session' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });

  it('answers the indicated permission even after another request arrives in the same frame', async () => {
    await frame(request(permission('first', 'Run npm test')), request(permission('second', 'Edit README')));
    const first = (await screen.findByText('Run npm test')).closest('[data-sonner-toast]')!;
    const allow = Array.from(first.querySelectorAll('button')).find((button) => button.textContent === 'Allow')!;
    fireEvent.click(allow);
    expect(invoke).toHaveBeenCalledWith('sessions:respond', sid, 'first', { value: 'Allow' });
    expect(getApp().current).toBe('foreground');
    expect(first.contains(allow)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(invoke).toHaveBeenCalledWith('sessions:respond', sid, 'second', { value: 'Deny' });
  });

  it('shows the confirmation message and sends a negative answer, not a dismissal', async () => {
    await frame(request({ id: 'confirm', kind: 'confirm', title: 'Restart?', message: 'Unsaved work will be lost.' }));
    expect(await screen.findByText(/Unsaved work will be lost/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(invoke).toHaveBeenCalledWith('sessions:respond', sid, 'confirm', { confirmed: false });
  });

  it('opens the requested plan for review without approving it', async () => {
    await frame(request({ id: 'plan', kind: 'plan', toolCallId: 'tool', title: 'Implementation plan' }));
    act(() => setApp((st) => void (st.sessions[sid].detail = null)));
    fireEvent.click(await screen.findByRole('button', { name: 'Open plan' }));
    await waitFor(() =>
      expect(getApp().sessions[sid].detail).toEqual({ type: 'plan', key: getApp().sessions[sid].waiting }),
    );
    expect(getApp().current).toBe(sid);
    expect(invoke.mock.calls.some(([c]) => c === 'sessions:respond')).toBe(false);
  });

  it('does not approve a truncated prompt or leave resolved actions behind', async () => {
    const long = permission('long', 'Run a command\nwith\nseveral\nlines');
    await frame(request(long));
    expect(await screen.findByRole('button', { name: 'Open session' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    await frame(resolved(long.id));
    expect(screen.queryByRole('button', { name: 'Open session' })).toBeNull();
    expect(invoke.mock.calls.some(([c]) => c === 'sessions:respond')).toBe(false);
  });

  it('does not notify for a request resolved in the same frame or already visible in the session', async () => {
    const warning = vi.spyOn((await import('sonner')).toast, 'warning');
    await frame(request(permission('gone', 'Run npm test')), resolved('gone'));
    await frame({ type: 'ui_request', sessionId: 'foreground', request: permission('visible', 'Run npm test') });
    expect(warning).not.toHaveBeenCalled();
  });
});
