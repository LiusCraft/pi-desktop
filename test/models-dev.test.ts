// models.dev alignment: custom endpoint model ids inherit context, output
// limits and prices from the public catalog, without hitting the network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ModelsDevCatalog, lookupKeys } from '../src/agent/models-dev';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-models-dev-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

interface FixtureModel {
  id: string;
  name?: string;
  context?: number;
  output?: number;
  cost?: Record<string, number>;
  reasoning?: boolean;
  image?: boolean;
}

function catalogFile(providers: Record<string, FixtureModel[]>) {
  const file = path.join(tmp, `cache-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify({ fetchedAt: 1_700_000_000_000, providers }));
  return file;
}

describe('lookupKeys', () => {
  it('covers the id, the vendor-stripped id and known suffixes', () => {
    expect(lookupKeys('openai/gpt-5')).toEqual(['openai/gpt-5', 'gpt-5']);
    expect(lookupKeys('anthropic/claude-sonnet-4.5:free')).toEqual([
      'anthropic/claude-sonnet-4.5:free',
      'claude-sonnet-4.5:free',
      'anthropic/claude-sonnet-4.5',
      'claude-sonnet-4.5',
    ]);
    expect(lookupKeys('gemini-2.5-pro@001')).toContain('gemini-2.5-pro');
    expect(lookupKeys('gpt-5-latest')).toContain('gpt-5');
  });
});

describe('ModelsDevCatalog', () => {
  it('matches exact, canonical and gateway-prefixed model ids', () => {
    const file = catalogFile({
      anthropic: [
        { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', context: 200000, output: 64000, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, reasoning: true, image: true },
      ],
      openai: [{ id: 'gpt-5', name: 'GPT-5', context: 400000, output: 128000, cost: { input: 1.25, output: 10 } }],
      openrouter: [
        { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5 (OpenRouter)', context: 1000000, output: 64000, cost: { input: 3, output: 15 } },
        { id: 'openai/gpt-5', name: 'GPT-5', context: 500000, output: 128000, cost: { input: 1.25, output: 10 } },
      ],
    });
    const catalog = new ModelsDevCatalog(file);
    catalog.ensure();

    expect(catalog.lastFetched).toBe(1_700_000_000_000);
    expect(catalog.lookup('claude-sonnet-4-5')).toMatchObject({
      name: 'Claude Sonnet 4.5',
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      source: 'models.dev',
    });
    // A vendor-prefixed id matches its exact entry (the gateway's own data) first…
    expect(catalog.lookup('openai/gpt-5')).toMatchObject({ contextWindow: 500000 });
    // …while a bare id takes the first catalog in priority order.
    expect(catalog.lookup('gpt-5')).toMatchObject({ contextWindow: 400000 });
    // …and the vendor prefix is also stripped for gateways that use it.
    expect(catalog.lookup('anthropic/claude-sonnet-4.5')?.contextWindow).toBe(1_000_000);
    expect(catalog.lookup('unknown-model')).toBeUndefined();
  });

  it('prefers the hinted provider when the same id exists twice', () => {
    const file = catalogFile({
      openai: [{ id: 'gpt-5', context: 400000, output: 128000, cost: { input: 1.25, output: 10 } }],
      azure: [{ id: 'gpt-5', context: 200000, output: 32000, cost: { input: 2, output: 8 } }],
    });
    const catalog = new ModelsDevCatalog(file);
    catalog.ensure();
    // OpenAI ranks first globally; a custom provider called `azure` sees its own entry.
    expect(catalog.lookup('gpt-5')?.contextWindow).toBe(400000);
    expect(catalog.lookup('gpt-5', 'azure')?.contextWindow).toBe(200000);
  });

  it('keeps working with a missing cache file', () => {
    const catalog = new ModelsDevCatalog(path.join(tmp, 'does-not-exist.json'));
    expect(catalog.lookup('gpt-5')).toBeUndefined();
    expect(catalog.lastFetched).toBeNull();
  });
});
