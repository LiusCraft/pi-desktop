// The model may only change the settings on the whitelist, and only to values the Settings page could also set.
import { describe, expect, it } from 'vitest';
import { checkAiSettingsPatch } from '../src/shared/ai-settings';

const pets = ['clawd', 'fox'];

describe('checkAiSettingsPatch', () => {
  it('accepts valid values', () => {
    const patch = { theme: 'dark', pet: false, petSkin: 'fox', suggestionContext: 10, suggestionModelId: null };
    expect(checkAiSettingsPatch(patch, pets)).toEqual(patch);
  });

  it('refuses the ai switches, the shell and folders', () => {
    for (const key of ['aiSettings', 'aiSchedule', 'aiCustomize', 'terminalShell', 'worktreeDir']) {
      expect(() => checkAiSettingsPatch({ [key]: true }, pets)).toThrow(/cannot be changed/);
    }
  });

  it('refuses values of the wrong kind or range', () => {
    expect(() => checkAiSettingsPatch({ theme: 'pink' }, pets)).toThrow(/theme/);
    expect(() => checkAiSettingsPatch({ pet: 'yes' }, pets)).toThrow(/pet/);
    expect(() => checkAiSettingsPatch({ petSkin: 'ghost' }, pets)).toThrow(/petSkin/);
    expect(() => checkAiSettingsPatch({ suggestionContext: 0 }, pets)).toThrow(/suggestionContext/);
    expect(() => checkAiSettingsPatch({ suggestionContext: 1.5 }, pets)).toThrow(/suggestionContext/);
  });

  it('refuses an empty patch', () => {
    expect(() => checkAiSettingsPatch({}, pets)).toThrow(/at least one/);
  });
});
