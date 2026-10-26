// Background side requests (session naming, next-message prediction) pick the
// cheapest chat model from the session's own provider.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { pickSideModel } from '../src/agent/side-model';

const model = (id: string, provider: string, input: number, output: number, extra: Record<string, unknown> = {}) => ({
  id, provider, cost: { input, output }, contextWindow: 200000, ...extra,
});

describe('pickSideModel', () => {
  it('prefers the cheapest model from the session provider', () => {
    const models = [
      model('big-model', 'anthropic', 3, 15),
      model('claude-haiku-4-5', 'anthropic', 1, 5),
      model('tiny', 'openai', 0.1, 0.4),
    ];
    assert.equal(pickSideModel(models, 'anthropic/big-model'), 'anthropic/claude-haiku-4-5');
  });

  it('falls back to the cheapest across providers and skips the demo model', () => {
    const models = [
      model('demo-coder', 'demo', 0, 0),
      model('big-model', 'xai', 3, 15),
      model('mini', 'openai', 0.1, 0.4),
    ];
    assert.equal(pickSideModel(models, 'demo/demo-coder'), 'openai/mini');
  });

  it('returns null when only the offline demo model exists', () => {
    assert.equal(pickSideModel([model('demo-coder', 'demo', 0, 0)], 'demo/demo-coder'), null);
    assert.equal(pickSideModel([], null), null);
  });
});
