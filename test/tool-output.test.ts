import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parseJsonOutput, splitFences, splitScriptHeader } from '@/lib/tool-output';
import { nestedCalls, skillOf, toolFromArgs } from '@/lib/tools';

describe('tool output rendering', () => {
  it('keeps an output without fences as one text run', () => {
    assert.deepEqual(splitFences('line one\nline two'), [{ kind: 'text', text: 'line one\nline two' }]);
  });
  it('splits a fenced block and highlights its language', () => {
    const segments = splitFences(
      'codemode tool declaration:\n```ts\ndeclare const tools: {\n  run(): void;\n};\n```\n',
    );
    assert.deepEqual(segments, [
      { kind: 'text', text: 'codemode tool declaration:' },
      { kind: 'code', lang: 'ts', code: 'declare const tools: {\n  run(): void;\n};' },
    ]);
  });
  it('handles a fence without a language and text on both sides', () => {
    const segments = splitFences('before\n```\ncode\n```\nafter');
    assert.deepEqual(
      segments.map((s) => s.kind),
      ['text', 'code', 'text'],
    );
    assert.deepEqual(segments[1], { kind: 'code', lang: '', code: 'code' });
  });
  it('leaves an unclosed fence as text', () => {
    assert.deepEqual(splitFences('a\n```js\nconst x = 1;'), [{ kind: 'text', text: 'a\n```js\nconst x = 1;' }]);
  });
  it('strips the codemode header from the body, and marks a failed script', () => {
    const ok = splitScriptHeader('Script completed\nWall time 1.4 seconds\nOutput:\nhello')!;
    assert.equal(ok.ok, true);
    assert.equal(ok.secs, '1.4');
    assert.equal(ok.body, 'hello');
    const failed = splitScriptHeader('Script failed\nWall time 0.3 seconds\nOutput:\nScript error:\nboom')!;
    assert.equal(failed.ok, false);
    assert.equal(failed.body, 'Script error:\nboom');
  });
  it('leaves output without the codemode header alone', () => {
    assert.equal(splitScriptHeader('Get a list of datasets'), null);
    assert.equal(splitScriptHeader('Script completed\n'), null);
  });
  it('reads a JSON object or array as structured data', () => {
    assert.deepEqual(parseJsonOutput('{"a": 1}'), { value: { a: 1 } });
    assert.deepEqual(parseJsonOutput(' \n[1, 2]\n'), { value: [1, 2] });
    assert.deepEqual(parseJsonOutput('{"rows": [{"id": 1}]}'), { value: { rows: [{ id: 1 }] } });
  });
  it('keeps text, scalars and broken JSON out of the structured view', () => {
    assert.equal(parseJsonOutput('Get a list of datasets'), null);
    assert.equal(parseJsonOutput('42'), null);
    assert.equal(parseJsonOutput('"a string"'), null);
    assert.equal(parseJsonOutput('{"a": 1'), null);
    assert.equal(parseJsonOutput('[1, 2}'), null);
  });
});

describe('codemode nested calls', () => {
  it('keeps the host fields and drops malformed calls', () => {
    const calls = nestedCalls([
      { id: 'c/1', name: 'read', args: '{"path":"a.ts"}', status: 'ok', durationMs: 12 },
      { id: 'c/2', name: 'bash', args: '{}', status: 'error', error: 'exit 1', durationMs: 300 },
      { name: 'models.classify', args: '', status: 'ok', cost: 0.0004 },
      { args: '{}', status: 'ok' },
      { name: 'weird', status: 'exploded' },
      null,
      'read',
    ]);
    assert.deepEqual(calls, [
      { name: 'read', args: '{"path":"a.ts"}', status: 'ok', durationMs: 12 },
      { name: 'bash', args: '{}', status: 'error', error: 'exit 1', durationMs: 300 },
      { name: 'models.classify', args: '', status: 'ok', cost: 0.0004 },
      { name: 'weird', args: '', status: 'ok' },
    ]);
  });
  it('reads a missing or non-array details.calls as no calls', () => {
    assert.deepEqual(nestedCalls(undefined), []);
    assert.deepEqual(nestedCalls({ calls: [] }), []);
  });
});

describe('skill use in the transcript', () => {
  const read = (path: string) => toolFromArgs('t1', 'read', { path });
  it('names the skill when a SKILL.md is read', () => {
    assert.equal(skillOf(read('C:/Users/me/.pi/agent/skills/make-slides/SKILL.md')), 'make-slides');
    assert.equal(skillOf(read('/home/me/.agents/skills/voiceover/SKILL.md')), 'voiceover');
  });
  it('ignores other reads, and files the skill brings along', () => {
    assert.equal(skillOf(read('notes/README.md')), undefined);
    assert.equal(skillOf(read('/home/me/.agents/skills/voiceover/rules/a.md')), undefined);
    assert.equal(skillOf(toolFromArgs('t2', 'write', { path: '/x/skills/a/SKILL.md' })), undefined);
  });
});
