// Model management end to end against the real pi SDK: provider catalog, custom
// endpoint discovery, models.dev alignment, auth.json credentials and logout.
// Network is disabled (PI_OFFLINE) and discovery talks to a local test server.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HostEvent } from '@shared/protocol';
import { SessionHub } from '../src/agent/hub';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-model-admin-'));
const agentDir = path.join(tmp, 'agent');
const dataDir = path.join(tmp, 'data');
process.env.PI_OFFLINE = '1';
process.env.PI_CODING_AGENT_DIR = agentDir;

let server: http.Server;
let baseUrl: string;
let hub: SessionHub;
const events: HostEvent[] = [];

async function waitFor<T extends HostEvent['type']>(
  type: T,
  timeoutMs = 5_000,
): Promise<Extract<HostEvent, { type: T }>> {
  const started = Date.now();
  for (;;) {
    const hit = events.find((event) => event.type === type);
    if (hit) return hit as Extract<HostEvent, { type: T }>;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${type}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const authJson = () => JSON.parse(fs.readFileSync(path.join(agentDir, 'auth.json'), 'utf8'));
const modelsJson = () => JSON.parse(fs.readFileSync(path.join(agentDir, 'models.json'), 'utf8'));

beforeAll(async () => {
  fs.mkdirSync(path.join(dataDir, 'cache'), { recursive: true });
  // Seed the models.dev cache so alignment never reaches the network.
  fs.writeFileSync(
    path.join(dataDir, 'cache', 'models-dev.json'),
    JSON.stringify({
      fetchedAt: Date.now(),
      providers: {
        openai: [{ id: 'test-model', name: 'Test Model', context: 12345, output: 6789, cost: { input: 1, output: 2 } }],
      },
    }),
  );
  server = http.createServer((req, res) => {
    if (req.url?.endsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'test-model' }, { id: 'mystery-model' }] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;

  hub = new SessionHub({ dataDir, agentDir, emit: (event) => events.push(event) });
  await hub.init();
});

afterAll(async () => {
  await hub?.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('SessionHub model admin', () => {
  it('lists providers and their auth methods', async () => {
    const catalog = await hub.admin.catalog();
    const ids = catalog.providers.map((provider) => provider.id);
    expect(ids).toContain('anthropic');
    expect(ids).toContain('openai');
    const anthropic = catalog.providers.find((provider) => provider.id === 'anthropic')!;
    expect(anthropic.oauth).toBe(true);
    expect(anthropic.apiKeyLogin).toBe(true);
    expect(anthropic.configured).toBe(false);
    expect(catalog.paths.auth).toBe(path.join(agentDir, 'auth.json'));
    expect(catalog.paths.models).toBe(path.join(agentDir, 'models.json'));
    expect(catalog.catalogAt).toBeGreaterThan(0);
  });

  it('discovers models from an endpoint and aligns their metadata', async () => {
    const result = await hub.admin.discover({ id: 'local-gw', baseUrl, api: 'openai-completions', models: [] });
    expect(result.error).toBeUndefined();
    expect(result.models.map((model) => model.id)).toEqual(['mystery-model', 'test-model']);
    expect(result.models.find((model) => model.id === 'test-model')).toMatchObject({
      name: 'Test Model',
      contextWindow: 12345,
      maxTokens: 6789,
      cost: { input: 1, output: 2 },
      source: 'models.dev',
    });
  });

  it('saves the endpoint, stores its key in auth.json and makes the models available', async () => {
    const discovered = await hub.admin.discover({ id: 'local-gw', baseUrl, api: 'openai-completions', models: [] });
    const catalog = await hub.admin.saveEndpoint({
      id: 'local-gw',
      name: 'Local Gateway',
      baseUrl,
      api: 'openai-completions',
      apiKey: 'secret-key',
      models: discovered.models,
    });
    const endpoint = catalog.endpoints.find((item) => item.id === 'local-gw')!;
    expect(endpoint).toMatchObject({ name: 'Local Gateway', builtin: false, keySet: true, api: 'openai-completions' });
    expect(endpoint.models).toHaveLength(2);
    // Key stays out of models.json and lands in pi's credential store.
    expect(modelsJson().providers['local-gw'].apiKey).toBeUndefined();
    expect(authJson()['local-gw']).toMatchObject({ type: 'api_key', key: 'secret-key' });
    const models = await hub.listModels();
    expect(models.models.map((model) => `${model.provider}/${model.id}`)).toContain('local-gw/test-model');
    const configured = (await hub.admin.catalog()).providers.find((provider) => provider.id === 'local-gw')!;
    expect(configured).toMatchObject({ configured: true, authType: 'api_key', credential: true, custom: true });
  });

  it('relogins through the pi prompt flow and removes the credential on logout', async () => {
    events.length = 0;
    const pending = hub.admin.login('local-gw', 'api_key');
    const prompt = await waitFor('auth_prompt');
    expect(prompt.prompt).toMatchObject({ type: 'secret' });
    hub.admin.respond(prompt.loginId, prompt.requestId, 'rotated-key');
    await pending;
    expect(authJson()['local-gw']).toMatchObject({ key: 'rotated-key' });

    await hub.admin.logout('local-gw');
    expect(authJson()['local-gw']).toBeUndefined();
    const endpoint = (await hub.admin.catalog()).endpoints.find((item) => item.id === 'local-gw')!;
    expect(endpoint.keySet).toBe(false);
  });

  it('uses the documented placeholder key for a keyless local endpoint', async () => {
    await hub.admin.saveEndpoint({
      id: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      models: [{ id: 'qwen2.5-coder:7b' }],
    });
    expect(modelsJson().providers.ollama.apiKey).toBe('local');
    const endpoint = (await hub.admin.catalog()).endpoints.find((item) => item.id === 'ollama')!;
    expect(endpoint.keySet).toBe(true);
    expect(endpoint.keySource).toBe('models.json');
  });

  it('loads manual overrides and recovers endpoints with old zero limits', async () => {
    await hub.admin.saveEndpoint({
      id: 'editable',
      baseUrl,
      api: 'openai-completions',
      models: [
        {
          id: 'test-model',
          name: 'My Model',
          contextWindow: 64000,
          maxTokens: 4000,
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0.25, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
    const overridden = (await hub.admin.catalog()).endpoints.find((item) => item.id === 'editable')!.models[0];
    expect(overridden).toMatchObject({
      name: 'My Model',
      contextWindow: 64000,
      maxTokens: 4000,
      cost: { input: 0, output: 0.25 },
    });
    const data = modelsJson();
    data.providers.editable.models.push({ id: 'image-model', contextWindow: 0, maxTokens: 0 });
    fs.writeFileSync(path.join(agentDir, 'models.json'), JSON.stringify(data));
    const endpoint = (await hub.admin.catalog()).endpoints.find((item) => item.id === 'editable')!;
    const saved = await hub.admin.saveEndpoint(endpoint);
    expect(saved.errors).toEqual([]);
    expect(modelsJson().providers.editable.models[1]).toEqual({ id: 'image-model' });
    const available = (await hub.listModels()).models.find(
      (model) => model.provider === 'editable' && model.id === 'test-model',
    );
    expect(available).toBeDefined();
  });

  it('removes an endpoint and its credential', async () => {
    await hub.admin.saveEndpoint({
      id: 'gone',
      baseUrl,
      api: 'openai-completions',
      apiKey: 'x',
      models: [{ id: 'test-model' }],
    });
    expect(authJson().gone).toMatchObject({ key: 'x' });
    const catalog = await hub.admin.removeEndpoint('gone');
    expect(catalog.endpoints.some((item) => item.id === 'gone')).toBe(false);
    expect(modelsJson().providers.gone).toBeUndefined();
    expect(authJson().gone).toBeUndefined();
  });
});
