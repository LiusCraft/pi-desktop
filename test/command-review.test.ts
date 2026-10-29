// Auto mode's command review: what the reviewer is asked and how its answer is read.
import { describe, expect, it } from 'vitest';
import { latestRequest, parseVerdict, recentConversation, recentSteps, reviewRequest, SYSTEM_PROMPT } from '../src/agent/command-review';

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

describe('recentConversation', () => {
  const text = (t: string) => [{ type: 'text', text: t }];

  it("is the messages before the latest request, with the assistant's last words last", () => {
    expect(recentConversation([
      { role: 'user', content: 'clean the build folder' },
      { role: 'assistant', content: [...text('Sure, listing first.'), { type: 'toolCall', name: 'bash' }] },
      { role: 'toolResult', content: text('dist build') },
      { role: 'user', content: 'do it' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'secret plan' }, ...text('I will look at the folder.')] },
    ])).toBe('User: clean the build folder\nAssistant: Sure, listing first.\nAssistant: I will look at the folder.');
  });

  it('leaves out thinking, tool output and empty messages, and is null with nothing to show', () => {
    expect(recentConversation([{ role: 'user', content: 'hi' }])).toBeNull();
    expect(recentConversation([])).toBeNull();
    expect(recentConversation([{ role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }] }, { role: 'user', content: 'go' }])).toBeNull();
  });

  it('is cut to the last few messages, and to a length', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `message ${i}` }));
    const out = recentConversation(many)!;
    expect(out.split('\n')).toHaveLength(6);
    expect(out).toContain('message 19');
    expect(out).not.toContain('message 18'); // the latest request, which has its own place in the review request
    expect(out).not.toContain('message 3\n');
    const long = recentConversation([{ role: 'user', content: 'x'.repeat(5000) }, { role: 'assistant', content: 'y'.repeat(5000) }, { role: 'user', content: 'go' }])!;
    expect(long.length).toBeLessThanOrEqual(2400);
  });

  it('goes into the review request', () => {
    const body = reviewRequest({ command: 'ls -a', cwd: '/p', kind: 'code', request: 'delete it', history: 'User: clean up\nAssistant: looking first' });
    expect(body).toContain('Recent conversation, oldest first:\nUser: clean up');
    expect(reviewRequest({ command: 'ls', cwd: '/p', kind: 'code', request: 'x' })).not.toContain('Recent conversation');
  });
});

describe('recentSteps', () => {
  it("is the assistant's tool calls since the latest request, oldest first", () => {
    expect(recentSteps([
      { role: 'user', content: 'old task' },
      { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'rm old' } }] },
      { role: 'user', content: 'find the bug' },
      { role: 'assistant', content: [{ type: 'text', text: 'Looking.' }, { type: 'toolCall', name: 'grep', arguments: { pattern: 'parse' } }, { type: 'toolCall', name: 'read', arguments: { path: 'src/a.ts' } }] },
      { role: 'toolResult', content: [{ type: 'text', text: 'output' }] },
      { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'cd ../lib &&\n  npm test' } }] },
    ])).toBe('grep: parse\nread: src/a.ts\nbash: cd ../lib && npm test');
  });

  it('is null before any step, and goes into the review request', () => {
    expect(recentSteps([{ role: 'user', content: 'go' }])).toBeNull();
    expect(reviewRequest({ command: 'ls', cwd: '/p', kind: 'code', request: 'x', steps: 'read: a.ts' })).toContain("The assistant's steps since that request, oldest first:\nread: a.ts");
  });
});

describe("the reviewer's instructions", () => {
  it('judge harm, not scope, against the work as it unfolded', () => {
    expect(SYSTEM_PROMPT).toContain('safety check, not a scope check');
    expect(SYSTEM_PROMPT).toContain('recent conversation');
    expect(SYSTEM_PROMPT).toContain('part of the task');
  });
});
