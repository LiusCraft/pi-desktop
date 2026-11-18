// @vitest-environment jsdom
import { invoke } from './renderer-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostEvent, SessionMeta, UiRequest } from '../src/shared/protocol';

const { Toaster } = await import('../src/renderer/src/components/ui/sonner');
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
