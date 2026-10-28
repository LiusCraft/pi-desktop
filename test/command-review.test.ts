// Auto mode's command review: what the reviewer is asked and how its answer is read.
import { describe, expect, it } from 'vitest';
import { latestRequest, parseVerdict, reviewRequest } from '../src/agent/command-review';

describe('parseVerdict', () => {
  it('reads a plain answer', () => {
    expect(parseVerdict('{"verdict":"allow","reason":"Runs the tests the user asked for."}')).toEqual({ verdict: 'allow', reason: 'Runs the tests the user asked for.' });
    expect(parseVerdict('{"verdict":"ask","reason":"Deletes files"}')?.verdict).toBe('ask');
  });

  it('finds the object inside a fence or chatter', () => {
    expect(parseVerdict('```json\n{"verdict": "ask", "reason": "Uploads data"}\n```')).toEqual({ verdict: 'ask', reason: 'Uploads data' });
    expect(parseVerdict('Sure. {"verdict":"allow","reason":""} Done.')?.verdict).toBe('allow');
  });

  it('keeps the reason short and on one line', () => {
    const reason = parseVerdict(`{"verdict":"ask","reason":"${'a\\n'.repeat(200)}"}`)?.reason ?? '';
    expect(reason).not.toContain('\n');
    expect(reason.length).toBeLessThanOrEqual(160);
  });

  it('gives nothing for an answer it cannot trust', () => {
    expect(parseVerdict('')).toBeNull();
    expect(parseVerdict('allow')).toBeNull();
    expect(parseVerdict('{"verdict":"maybe"}')).toBeNull();
    expect(parseVerdict('{"verdict": allow}')).toBeNull();
    expect(parseVerdict('{"reason":"no verdict"}')).toBeNull();
  });
});

describe('reviewRequest', () => {
  it('carries the folder, the request and the command', () => {
    const text = reviewRequest({ command: 'npm test', cwd: '/p', kind: 'code', request: 'run the tests' });
    expect(text).toContain('Working folder: /p');
    expect(text).toContain('run the tests');
    expect(text).toContain('Command:\nnpm test');
  });

  it('says so when there is no request, and clips a huge command', () => {
    expect(reviewRequest({ command: 'ls', cwd: '/p', kind: 'work', request: null })).toContain('(none)');
    expect(reviewRequest({ command: 'x'.repeat(10_000), cwd: '/p', kind: 'code', request: '' }).length).toBeLessThan(5000);
  });
});

describe('latestRequest', () => {
  it('is the last user message, as text', () => {
    expect(latestRequest([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      { role: 'user', content: [{ type: 'text', text: 'second' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ])).toBe('second');
  });

  it('is null when nobody has asked yet', () => {
    expect(latestRequest([])).toBeNull();
    expect(latestRequest([{ role: 'assistant', content: 'hi' }])).toBeNull();
  });
});
