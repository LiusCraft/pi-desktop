// @vitest-environment jsdom
import './renderer-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Sidebar } from '@/components/layout/Sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setApp } from '@/store/app';
import { emptySession } from '@/store/transcript';
import type { SessionKind, SessionMeta } from '@shared/protocol';

const title = 'Review layout';
const summary = 'The right panel now uses tabs.';

function mountSidebar(kind: SessionKind, description: string) {
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
    state.sessions = { [meta.id]: emptySession(meta) };
  });
  const { container } = render(
    <TooltipProvider delayDuration={0}>
      <Sidebar />
    </TooltipProvider>,
  );
  return { container, session: screen.getByRole('button', { name: title }) };
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
