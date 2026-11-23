// @vitest-environment jsdom
import { invoke } from './renderer-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Sidebar } from '@/components/layout/Sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getApp, setApp } from '@/store/app';
import { emptySession } from '@/store/transcript';
import type { SessionKind, SessionMeta } from '@shared/protocol';

const title = 'Review layout';
const summary = 'The right panel now uses tabs.';

function mountSidebar(kind: SessionKind, description: string, unread = false) {
  const meta = {
    id: 's1',
    kind,
    title,
    description,
    projectPath: '/project',
    updatedAt: Date.now(),
  } as SessionMeta;
  setApp((state) => {
    state.view = kind;
    state.current = null;
    state.sessions = { [meta.id]: { ...emptySession(meta), loaded: true, unread } };
  });
  const { container } = render(
    <TooltipProvider delayDuration={0}>
      <Sidebar />
    </TooltipProvider>,
  );
  return { container, id: meta.id, session: screen.getByRole('button', { name: title }) };
}

it('keeps Code summaries out of the sidebar until the session is hovered', async () => {
  const { container, session } = mountSidebar('code', summary);
  expect(session.textContent).toBe(title);
  expect(screen.queryByRole('tooltip')).toBeNull();

  fireEvent.pointerMove(session, { pointerType: 'mouse' });
  const tooltip = await screen.findByRole('tooltip');
  expect(tooltip.textContent).toContain(`${title}\n${summary}\n`);
  expect(container.textContent).not.toContain(summary);
});

it('shows the Work session tooltip on keyboard focus without repeating the title', () => {
  const { session } = mountSidebar('work', title);
  act(() => session.focus());

  const tooltip = screen.getByRole('tooltip');
  expect(tooltip.id).toBe(session.getAttribute('aria-describedby'));
  expect(tooltip.textContent?.split('\n').filter((line) => line === title)).toHaveLength(1);

  fireEvent.keyDown(session, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('keeps modified clicks for selection and opens the session on a plain click', async () => {
  invoke.mockResolvedValue(null);
  const { id, session } = mountSidebar('work', summary, true);

  fireEvent.click(session, { ctrlKey: true });
  expect(getApp().current).toBeNull();
  expect(getApp().sessions[id].unread).toBe(true);
  expect(invoke).not.toHaveBeenCalledWith('sessions:state', id);

  fireEvent.click(session);
  expect(getApp().current).toBe(id);
  expect(getApp().sessions[id].unread).toBe(false);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('sessions:state', id));
});

it('opens inline rename on double click and restores the title on Escape', () => {
  const { session } = mountSidebar('work', summary);
  fireEvent.doubleClick(session);
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Rename' });
  expect(input.value).toBe(title);
  expect(screen.queryByRole('button', { name: title })).toBeNull();

  fireEvent.change(input, { target: { value: 'New title' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Rename' })).toBeNull();
  expect(screen.getByRole('button', { name: title })).toBeTruthy();
});
