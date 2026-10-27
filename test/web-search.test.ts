// Web search: engine failover that sticks to the engine that worked, a fixed engine without fallback, and the page fetcher's text conversion and address checks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPage, htmlToText, isPrivateAddress } from '../src/agent/web-fetch';
import { WebSearch } from '../src/agent/web-search';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pidesk-web-')); });
afterEach(() => { vi.unstubAllGlobals(); fs.rmSync(dir, { recursive: true, force: true }); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const q = { query: 'pi desktop', maxResults: 3 };

describe('WebSearch', () => {
  it('moves to the next engine when one fails and starts from it next time', async () => {
    const web = new WebSearch(dir);
    web.save({ engine: 'auto', keys: { exa: 'e', brave: 'b' } });
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(new URL(String(url)).hostname);
      if (String(url).includes('exa.ai')) return json({ error: 'out of credits' }, 402);
      return json({ web: { results: [{ title: 'T', url: 'https://x.test', description: 'D' }] } });
    }));

    const first = await web.search(q);
    expect(first.engine).toBe('brave');
    expect(first.failed.map((f) => f.engine)).toEqual(['exa']);
    expect(web.info().current).toBe('brave');

    calls.length = 0;
    await web.search(q);
    expect(calls).toEqual(['api.search.brave.com']);
  });

  it('uses a fixed engine alone, and says when everything failed', async () => {
    const web = new WebSearch(dir);
    web.save({ engine: 'exa', keys: { exa: 'e', brave: 'b' } });
    const fetchMock = vi.fn(async () => json({}, 429));
    vi.stubGlobal('fetch', fetchMock);
    await expect(web.search(q)).rejects.toThrow(/Exa: HTTP 429/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks for a key when none is set, and keeps or removes keys on save', async () => {
    const web = new WebSearch(dir);
    await expect(web.search(q)).rejects.toThrow(/not set up/);
    web.save({ engine: 'auto', keys: { tavily: 'k' } });
    expect(web.save({ engine: 'auto', keys: { tavily: '' } }).keys.tavily).toBe(true);
    expect(web.save({ engine: 'auto', keys: { tavily: null } }).keys.tavily).toBe(false);
  });
});

describe('web fetch', () => {
  it('turns html into readable text with absolute links', () => {
    const { title, text } = htmlToText('<html><head><title>Hi &amp; bye</title><style>x{}</style></head><body><h1>Head</h1><p>One <a href="/a">link</a></p><script>x()</script><ul><li>a</li></ul></body></html>', 'https://e.test/p/');
    expect(title).toBe('Hi & bye');
    expect(text).toBe('# Head\n\nOne [link](https://e.test/a)\n\n- a');
  });

  it('refuses private addresses', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    await expect(fetchPage('http://127.0.0.1:8080/')).rejects.toThrow(/not a public address/);
    await expect(fetchPage('file:///etc/passwd')).rejects.toThrow(/Only http/);
  });
});
