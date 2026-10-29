// Idle-context rebuild: which cache lifetime wins, and when a session is rebuilt at all.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  formatIdle, IDLE_RESET_DEFAULT_MINUTES, IDLE_RESET_MAX_MINUTES, idleMinutes, idleResetMinutes, modelKey,
} from '../src/shared/idle-reset';

const settings = (minutes: number, models: Record<string, number> = {}) => ({ idleResetMinutes: minutes, idleResetModels: models });

describe('idleResetMinutes', () => {
  const key = modelKey('anthropic', 'claude-sonnet-5');

  it('uses the global setting for a model with no value of its own', () => {
    assert.equal(idleResetMinutes(settings(60), key, undefined), 60);
  });

  it('follows the lifetime the model catalog declares when the user set nothing', () => {
    assert.equal(idleResetMinutes(settings(60), key, 5), 5);
  });

  it("lets the model's own value win over both", () => {
    assert.equal(idleResetMinutes(settings(60, { [key]: 480 }), key, 5), 480);
  });

  it('treats an own value of 0 as "never rebuild for this model"', () => {
    assert.equal(idleResetMinutes(settings(60, { [key]: 0 }), key, 5), 0);
  });

  it('treats a global 0 as off for every model, until that model gets its own value', () => {
    assert.equal(idleResetMinutes(settings(0), key, 5), 0);
    assert.equal(idleResetMinutes(settings(0, { [key]: 120 }), key, 5), 120);
  });

  it('ignores values that a hand-edited settings file could contain', () => {
    const junk = { idleResetMinutes: -1, idleResetModels: { [key]: Number.NaN } } as never;
    assert.equal(idleResetMinutes(junk, key, undefined), IDLE_RESET_DEFAULT_MINUTES);
  });

  it('keys models by provider, so the same id under two providers stays apart', () => {
    const models = { [modelKey('openai', 'gpt-5.6')]: 720 };
    assert.equal(idleResetMinutes(settings(60, models), modelKey('openai', 'gpt-5.6'), undefined), 720);
    assert.equal(idleResetMinutes(settings(60, models), modelKey('azure', 'gpt-5.6'), undefined), 60);
  });
});

describe('idleMinutes', () => {
  it('accepts a bounded number of minutes', () => {
    assert.equal(idleMinutes(0), 0);
    assert.equal(idleMinutes(1.5), 1.5);
    assert.equal(idleMinutes(IDLE_RESET_DEFAULT_MINUTES), 60);
  });

  it('rejects anything else, so the fallback stays in charge', () => {
    for (const value of [-0.1, IDLE_RESET_MAX_MINUTES + 1, Number.NaN, Infinity, '60', null, undefined, {}]) {
      assert.equal(idleMinutes(value), undefined);
    }
  });
});

describe('formatIdle', () => {
  it('stays short enough for one line', () => {
    assert.equal(formatIdle(5), '5m');
    assert.equal(formatIdle(0), '1m');
    assert.equal(formatIdle(60), '1h');
    assert.equal(formatIdle(90), '2h');
    assert.equal(formatIdle(49 * 60), '2d');
  });
});
