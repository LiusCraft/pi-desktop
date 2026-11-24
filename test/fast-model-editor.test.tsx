// @vitest-environment jsdom
import { invoke } from './renderer-dom';
import { fireEvent, render as renderView, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { EndpointInfo, EndpointModel } from '@shared/protocol';

const { TooltipProvider } = await import('../src/renderer/src/components/ui/tooltip');
const render = (node: Parameters<typeof renderView>[0]) => renderView(node, { wrapper: TooltipProvider });
const { ModelEditor } = await import('../src/renderer/src/settings/ModelEditor');
const { EndpointDialog, mergeModels } = await import('../src/renderer/src/settings/EndpointDialog');

it('allows turning off Fast detection for a known GPT model', () => {
  const model = { id: 'openai/gpt-6.1-sol' };
  const apply = vi.fn<(model: EndpointModel) => void>();
  render(<ModelEditor model={model} api="openai-responses" onApply={apply} onCancel={() => {}} />);
  const toggle = screen.getByRole('switch', { name: /Supports Fast/ });
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ id: model.id, supportsFast: false }));
  expect(mergeModels([{ ...model, supportsFast: false }], [{ ...model, supportsFast: true }])[0].supportsFast).toBe(
    false,
  );
  expect(mergeModels([model], [{ ...model, supportsFast: true }])[0].supportsFast).toBe(true);
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

it('saves the Fast choice through the custom endpoint dialog', async () => {
  const endpoint: EndpointInfo = {
    id: 'gateway',
    name: 'Gateway',
    baseUrl: 'https://gateway.example/v1',
    api: 'openai-responses',
    builtin: false,
    keySet: true,
    models: [{ id: 'gpt-99' }],
    extra: [],
  };
  const saved = vi.fn<React.ComponentProps<typeof EndpointDialog>['onSaved']>();
  invoke.mockResolvedValue({ endpoints: [endpoint] });
  render(<EndpointDialog endpoint={endpoint} catalogAt={null} onClose={() => {}} onSaved={saved} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit model gpt-99' }));
  fireEvent.click(screen.getByRole('switch', { name: /Supports Fast/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(invoke).toHaveBeenCalledWith(
    'models:endpointSave',
    expect.objectContaining({
      api: 'openai-responses',
      models: [expect.objectContaining({ id: 'gpt-99', supportsFast: true })],
    }),
  );
});
