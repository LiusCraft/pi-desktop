import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fastPayload, supportsFast } from '../src/agent/request-hook/fast';
import { recordRequests } from '../src/agent/request-hook/hook';
import { RequestLog } from '../src/agent/request-hook/log';
import { withOrigin } from '../src/agent/request-hook/origin';

const id = 'gpt-6.1-sol';
const apiModel = { provider: 'openai', id, api: 'openai-responses', baseUrl: 'https://api.openai.com/v1' };
const codexModel = {
  provider: 'openai-codex',
  id,
  api: 'openai-codex-responses',
  baseUrl: 'https://chatgpt.com/backend-api',
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pidesk-fast-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const fakeCodexToken = `x.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test' } })).toString('base64')}.x`;

function responseFor(tier: 'priority' | 'default') {
  const event = {
    type: 'response.completed',
    response: {
      id: 'resp_test',
      status: 'completed',
      output: [],
      service_tier: tier,
      usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
    },
  };
  return new Response(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('OpenAI Fast requests', () => {
  it.each([apiModel, codexModel])('runs the real $provider serializer with a mocked server', async ({ provider }) => {
    const authPath = path.join(dir, 'auth.json');
    if (provider === 'openai-codex') {
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          [provider]: {
            type: 'oauth',
            access: fakeCodexToken,
            refresh: 'test-refresh',
            expires: Date.now() + 3_600_000,
            accountId: 'test',
          },
        }),
      );
    }
    const runtime = await ModelRuntime.create({ authPath, refreshOnCreate: false });
    const model = runtime.getModel(provider, id);
    expect(model).toBeDefined();
    if (!model) return;
    let selected: string | undefined = `${provider}/${id}`;
    const log = new RequestLog(dir);
    log.tagSession('sdk-id', { origin: 'work', session: 'desktop-id' });
    log.tagSession('another-sdk-id', { origin: 'code', session: 'another-desktop-id' });
    recordRequests(runtime, log, undefined, {
      modelForSession: (sid) => (sid === 'desktop-id' ? selected : undefined),
    });

    const sent: { service_tier?: string; reasoning?: { effort: string }; marker?: boolean }[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const req = new Request(input, init);
      expect(req.url).toBe(
        provider === 'openai'
          ? 'https://api.openai.com/v1/responses'
          : 'https://chatgpt.com/backend-api/codex/responses',
      );
      const bytes = Buffer.from(await req.arrayBuffer());
      const body = JSON.parse(
        (req.headers.get('content-encoding') === 'zstd' ? zstdDecompressSync(bytes) : bytes).toString(),
      );
      sent.push(body);
      return responseFor(body.service_tier === 'priority' ? 'priority' : 'default');
    });
    const options = {
      fetch,
      transport: 'sse',
      apiKey: provider === 'openai' ? 'test-api-key' : undefined,
      sessionId: 'sdk-id',
      reasoning: 'high',
      onPayload: (payload: unknown) => ({ ...(payload as object), marker: true }),
    } as const;
    const ask = (overrides: Partial<Parameters<ModelRuntime['streamSimple']>[2]> = {}) =>
      runtime.completeSimple(
        model,
        { messages: [{ role: 'user', content: 'Hi', timestamp: 1 }] },
        {
          ...options,
          ...overrides,
        },
      );
    const fast = await ask();
    const other = await ask({ sessionId: 'another-sdk-id' });
    const side = await withOrigin({ origin: 'sideChat', session: 'desktop-id' }, () => ask());
    const warm = await ask({ maxTokens: 1, disableContinuation: true, maxRetries: 0 });
    selected = undefined;
    const standard = await ask();

    for (const result of [fast, other, side, warm, standard]) {
      expect(result).toMatchObject({ stopReason: 'stop' });
    }
    expect(sent.map((body) => body.service_tier)).toEqual(['priority', undefined, undefined, undefined, undefined]);
    expect(sent[0]).toMatchObject({ reasoning: { effort: 'high' }, marker: true });
    expect(fast.usage.cost.total).toBeCloseTo(2 * standard.usage.cost.total, 10);
    expect(standard.usage.cost.total).toBeGreaterThan(0);
  });

  it('detects models independently of vendors and respects per-endpoint overrides', () => {
    expect(supportsFast(apiModel)).toBe(true);
    expect(supportsFast(codexModel)).toBe(true);
    const thirdParty = { provider: 'gateway', id: 'openai/gpt-5.6-luna', api: 'openai-completions' };
    expect(supportsFast(thirdParty)).toBe(true);
    expect(supportsFast(thirdParty, false)).toBe(false);
    expect(supportsFast({ ...thirdParty, id: 'gpt-99' })).toBe(false);
    expect(supportsFast({ ...thirdParty, id: 'gpt-99' }, true)).toBe(true);
    expect(supportsFast({ ...thirdParty, api: 'anthropic-messages' }, true)).toBe(false);
    expect(supportsFast({ ...thirdParty, id: 'not-gpt-99' }, true)).toBe(false);
    expect(fastPayload({}, apiModel, `openai-codex/${id}`)).toBeUndefined();
    expect(fastPayload({ service_tier: 'flex' }, apiModel, `openai/${id}`)).toBeUndefined();
    expect(fastPayload('not an object', apiModel, `openai/${id}`)).toBeUndefined();
  });
});
