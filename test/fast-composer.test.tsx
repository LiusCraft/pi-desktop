// @vitest-environment jsdom
import { invoke } from './renderer-dom';
import { fireEvent, render as renderView, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import type { SessionMeta } from '@shared/protocol';

const { TooltipProvider } = await import('../src/renderer/src/components/ui/tooltip');
const render = (node: Parameters<typeof renderView>[0]) => renderView(node, { wrapper: TooltipProvider });
const { FastButton } = await import('../src/renderer/src/components/composer/FastButton');
const { getApp, read, setApp } = await import('../src/renderer/src/store/app');
const { useDrafts } = await import('../src/renderer/src/store/drafts');
const model = 'openai/gpt-6.1-sol';
const otherModel = 'gateway/gpt-6.1-sol';
const button = () => screen.getByRole('button', { name: 'Fast' });

beforeEach(() => {
  useDrafts.setState({ drafts: {}, active: null });
  setApp((st) => {
    st.prefs.fastModels = [];
    st.models = ['openai', 'gateway'].map((provider) => ({ provider, id: 'gpt-6.1-sol', supportsFast: true }));
  });
});

it('remembers both states per model and provider, and hides Fast for other models', () => {
  const { rerender } = render(<FastButton model={model} />);
  expect(button().getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(button());
  expect(button().getAttribute('aria-pressed')).toBe('true');
  expect(read('pd_fast_models', [])).toEqual([model]);
  rerender(<FastButton model={otherModel} />);
  expect(button().getAttribute('aria-pressed')).toBe('false');
  rerender(<FastButton model={model} />);
  expect(button().getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(button());
  expect(read('pd_fast_models', [model])).toEqual([]);
  expect(invoke).not.toHaveBeenCalled();

  rerender(<FastButton model="anthropic/claude" />);
  expect(screen.queryByRole('button', { name: 'Fast' })).toBeNull();
});

it('sends the selected session and model to the host and renders host-owned state', async () => {
  invoke.mockResolvedValue(undefined);
  const session = { id: 'session', model } as SessionMeta;
  const { rerender } = render(<FastButton model={model} session={session} />);
  fireEvent.click(button());
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('sessions:setFast', 'session', model, true));
  await waitFor(() => expect(getApp().prefs.fastModels).toEqual([model]));
  expect(button().getAttribute('aria-pressed')).toBe('false');
  rerender(<FastButton model={model} />);
  expect(button().getAttribute('aria-pressed')).toBe('true');

  rerender(<FastButton model={model} session={{ ...session, fastModel: model }} />);
  await waitFor(() => expect((button() as HTMLButtonElement).disabled).toBe(false));
  expect(button().getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(button());
  await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('sessions:setFast', 'session', model, false));
  await waitFor(() => expect(getApp().prefs.fastModels).toEqual([]));
});
