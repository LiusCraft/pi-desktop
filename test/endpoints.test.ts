// Custom endpoints: models.json stays pi-compatible, hand-edited fields survive,
// discovery normalizes the three model-list shapes, and local servers get the
// documented key placeholder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { alignModel } from '../src/agent/model-admin';
import { EndpointStore, LOCAL_KEY, discoveryUrls, isLocalUrl, parseModelList, stripJsonComments, validProviderId } from '../src/agent/endpoints';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-endpoints-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const storeAt = (name: string) => new EndpointStore(path.join(tmp, `${name}.json`));

describe('models.json helpers', () => {
  it('reads files with comments and trailing commas', () => {
    expect(JSON.parse(stripJsonComments('{\n // comment\n "a": 1, /* block */\n "b": [1,2,],\n}'))).toEqual({ a: 1, b: [1, 2] });
  });

  it('recognizes local endpoints', () => {
    expect(isLocalUrl('http://localhost:11434/v1')).toBe(true);
    expect(isLocalUrl('http://127.0.0.1:1234/v1')).toBe(true);
    expect(isLocalUrl('http://192.168.1.5:8000/v1')).toBe(true);
    expect(isLocalUrl('http://172.20.0.3:8000/v1')).toBe(true);
    expect(isLocalUrl('https://api.openai.com/v1')).toBe(false);
    expect(isLocalUrl('not a url')).toBe(false);
  });

  it('validates provider ids', () => {
    expect(validProviderId('my-endpoint')).toBe(true);
    expect(validProviderId('a.b_c-1')).toBe(true);
    expect(validProviderId('My Endpoint')).toBe(false);
    expect(validProviderId('-nope')).toBe(false);
  });
});

describe('parseModelList', () => {
  it('reads OpenAI-style lists with context hints', () => {
    expect(parseModelList({ data: [{ id: 'gpt-5', context_length: 400000, max_completion_tokens: 128000 }, { id: 'o4-mini' }] })).toEqual([
      { id: 'gpt-5', name: undefined, contextWindow: 400000, maxTokens: 128000, source: 'endpoint' },
      { id: 'o4-mini', name: undefined, contextWindow: undefined, maxTokens: undefined, source: 'endpoint' },
    ]);
  });

  it('reads Anthropic-style lists with display names', () => {
    expect(parseModelList({ data: [{ id: 'claude-opus-4', display_name: 'Claude Opus 4' }], has_more: false })).toEqual([
      { id: 'claude-opus-4', name: 'Claude Opus 4', contextWindow: undefined, maxTokens: undefined, source: 'endpoint' },
    ]);
  });

  it('reads Google-style lists and strips the models/ prefix', () => {
    expect(
      parseModelList({
        models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', inputTokenLimit: 1048576, outputTokenLimit: 65536 }],
      }),
    ).toEqual([{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1048576, maxTokens: 65536, source: 'endpoint' }]);
  });

  it('accepts plain arrays, dedupes and drops junk', () => {
    expect(parseModelList(['llama3.1:8b', { id: 'llama3.1:8b' }, null, { name: 42 }])).toEqual([
      { id: 'llama3.1:8b', name: undefined, contextWindow: undefined, maxTokens: undefined, source: 'endpoint' },
    ]);
  });
});

describe('discoveryUrls', () => {
  it('tries the versioned path first when the base URL has none', () => {
    expect(discoveryUrls('https://api.example.com', 'openai-completions')).toEqual(['https://api.example.com/v1/models', 'https://api.example.com/models']);
  });
  it('keeps an existing version segment untouched', () => {
    expect(discoveryUrls('https://example.com/api/v1/', 'openai-completions')).toEqual(['https://example.com/api/v1/models']);
  });
  it('tries /v1 for an Anthropic root address', () => {
    expect(discoveryUrls('https://api.anthropic.com', 'anthropic-messages')).toEqual(['https://api.anthropic.com/v1/models', 'https://api.anthropic.com/models']);
  });
  it('uses the versioned base for Google', () => {
    expect(discoveryUrls('https://generativelanguage.googleapis.com/v1beta', 'google-generative-ai')).toEqual(['https://generativelanguage.googleapis.com/v1beta/models']);
  });
});

describe('EndpointStore', () => {
  it('writes a new endpoint and keeps everything else in the file', () => {
    const store = storeAt('new');
    fs.writeFileSync(
      store.file,
      JSON.stringify({ providers: { existing: { baseUrl: 'https://keep.me/v1', api: 'openai-completions' } } }, null, 2),
    );
    store.save({
      id: 'My-Endpoint',
      name: 'My Endpoint',
      baseUrl: 'https://api.example.com/v1/',
      api: 'openai-completions',
      apiKey: 'sk-test',
      models: [
        { id: 'gpt-5', contextWindow: 400000, maxTokens: 128000, cost: { input: 1.25, output: 10 } },
        { id: 'gpt-5' },
      ],
    });
    const written = JSON.parse(fs.readFileSync(store.file, 'utf8'));
    expect(written.$schema).toBe('https://pi.dev/schemas/models.schema.json');
    expect(written.providers.existing).toEqual({ baseUrl: 'https://keep.me/v1', api: 'openai-completions' });
    expect(written.providers['my-endpoint']).toEqual({
      baseUrl: 'https://api.example.com/v1',
      api: 'openai-completions',
      name: 'My Endpoint',
      models: [{ id: 'gpt-5', contextWindow: 400000, maxTokens: 128000, cost: { input: 1.25, output: 10, cacheRead: 0, cacheWrite: 0 } }],
    });
    // The key never lands in models.json.
    expect(JSON.stringify(written)).not.toContain('sk-test');
  });

  it('adds the documented placeholder for a keyless local endpoint', () => {
    const store = storeAt('local');
    store.save({ id: 'ollama', baseUrl: 'http://localhost:11434/v1', api: 'openai-completions', models: [{ id: 'qwen2.5-coder:7b' }] });
    expect(JSON.parse(fs.readFileSync(store.file, 'utf8')).providers.ollama.apiKey).toBe(LOCAL_KEY);

    // A real key replaces the placeholder.
    store.save({ id: 'ollama', baseUrl: 'http://localhost:11434/v1', api: 'openai-completions', apiKey: 'real', models: [{ id: 'qwen2.5-coder:7b' }] });
    expect(JSON.parse(fs.readFileSync(store.file, 'utf8')).providers.ollama.apiKey).toBeUndefined();
  });

  it('keeps hand-edited model fields when the editor saves again', () => {
    const store = storeAt('merge');
    fs.writeFileSync(
      store.file,
      JSON.stringify({
        providers: {
          proxy: {
            baseUrl: 'https://proxy.example.com/v1',
            api: 'openai-completions',
            apiKey: '$PROXY_KEY',
            headers: { 'x-team': 'mine' },
            models: [{ id: 'gpt-5', samplingParams: { temperature: 0.2 }, contextWindow: 400000 }],
          },
        },
      }),
    );
    store.save({
      id: 'proxy',
      baseUrl: 'https://proxy.example.com/v1',
      api: 'openai-completions',
      models: [{ id: 'gpt-5', name: 'GPT-5', maxTokens: 128000 }],
    });
    const provider = JSON.parse(fs.readFileSync(store.file, 'utf8')).providers.proxy;
    expect(provider.headers).toEqual({ 'x-team': 'mine' });
    expect(provider.apiKey).toBe('$PROXY_KEY');
    expect(provider.models).toEqual([{ id: 'gpt-5', samplingParams: { temperature: 0.2 }, contextWindow: 400000, name: 'GPT-5', maxTokens: 128000 }]);
  });

  it('refuses to overwrite a malformed file', () => {
    const store = storeAt('broken');
    fs.writeFileSync(store.file, '{ not json');
    expect(() => store.save({ id: 'x', baseUrl: 'https://x.dev/v1', api: 'openai-completions', models: [] })).toThrow(/models\.json/);
    expect(fs.readFileSync(store.file, 'utf8')).toBe('{ not json');
  });

  it('lists endpoints with aligned metadata and removes them', () => {
    const store = storeAt('list');
    store.save({
      id: 'gateway',
      name: 'Gateway',
      baseUrl: 'https://gw.example.com/v1',
      api: 'openai-completions',
      models: [{ id: 'claude-sonnet-4-5' }, { id: 'manual-model', cost: { input: 1, output: 2 } }],
    });
    const aligned = alignModel({ id: 'claude-sonnet-4-5' }, {
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: true,
      cost: { input: 3, output: 15 },
      source: 'models.dev',
    });
    expect(aligned).toMatchObject({ contextWindow: 200000, maxTokens: 64000, reasoning: true, source: 'models.dev' });

    const list = store.list(new Set(['openai']), () => ({ keySet: true, keySource: 'auth.json' }), (id) =>
      id === 'claude-sonnet-4-5'
        ? { name: 'Claude Sonnet 4.5', contextWindow: 200000, maxTokens: 64000, cost: { input: 3, output: 15 }, source: 'models.dev' }
        : undefined,
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'gateway', name: 'Gateway', builtin: false, keySet: true, keySource: 'auth.json' });
    expect(list[0].models[0]).toMatchObject({ name: 'Claude Sonnet 4.5', contextWindow: 200000, maxTokens: 64000, source: 'models.dev' });
    expect(list[0].models[1].cost).toEqual({ input: 1, output: 2 });

    store.remove('gateway');
    expect(JSON.parse(fs.readFileSync(store.file, 'utf8')).providers).toEqual({});
  });
});
