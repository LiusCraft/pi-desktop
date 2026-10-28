import { describe, expect, it } from 'vitest';
import { cacheHitRate } from '../src/shared/usage';

describe('cacheHitRate', () => {
  it('is the share of prompt tokens read from the cache', () => {
    expect(cacheHitRate({ input: 1000, cacheRead: 9000, cacheWrite: 0 })).toBeCloseTo(0.9);
    expect(cacheHitRate({ input: 0, cacheRead: 500, cacheWrite: 500 })).toBe(0.5);
  });

  it('is 0 when the prompt was only written to the cache', () => {
    expect(cacheHitRate({ input: 0, cacheRead: 0, cacheWrite: 2000 })).toBe(0);
  });

  it('is unknown when no model call reported anything or no cache was ever used', () => {
    expect(cacheHitRate({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull();
    expect(cacheHitRate({ input: 12_000, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });
});
