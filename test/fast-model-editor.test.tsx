// @vitest-environment jsdom
import './renderer-dom';
import { fireEvent, render as renderView, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { EndpointModel } from '@shared/protocol';

const { TooltipProvider } = await import('../src/renderer/src/components/ui/tooltip');
const render = (node: Parameters<typeof renderView>[0]) => renderView(node, { wrapper: TooltipProvider });
const { ModelEditor } = await import('../src/renderer/src/settings/ModelEditor');
const { mergeModels } = await import('../src/renderer/src/settings/EndpointDialog');

it('allows turning off Fast detection for a known GPT model', () => {
  const model = { id: 'openai/gpt-6.1-sol' };
  const apply = vi.fn<(model: EndpointModel) => void>();
  render(<ModelEditor model={model} api="openai-responses" onApply={apply} onCancel={() => {}} />);
  const toggle = screen.getByRole('switch', { name: /Supports Fast/ });
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ id: model.id, supportsFast: false }));
  expect(mergeModels([{ ...model, supportsFast: false }], [model])[0].supportsFast).toBe(false);
});

it('allows opting in for an unlisted GPT model on compatible APIs only', () => {
  const model = { id: 'gpt-99' };
  const apply = vi.fn<(model: EndpointModel) => void>();
  const { rerender } = render(
    <ModelEditor model={model} api="openai-completions" onApply={apply} onCancel={() => {}} />,
  );
  const toggle = screen.getByRole('switch', { name: /Supports Fast/ });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ id: model.id, supportsFast: true }));
  rerender(<ModelEditor model={model} api="anthropic-messages" onApply={apply} onCancel={() => {}} />);
  expect(screen.queryByRole('switch')).toBeNull();
});
