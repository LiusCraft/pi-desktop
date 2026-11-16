// Searching a session's own file after its context was rebuilt: what the handoff card points at.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { searchTranscript } from '../src/agent/hub';

const created: string[] = [];

function writeSession(lines: unknown[]): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pidesk-search-')), 'session.jsonl');
  created.push(file);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'));
  return file;
}

const message = (role: string, content: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'message',
  id: `e${Math.random()}`,
  parentId: null,
  timestamp: new Date().toISOString(),
  message: { role, content, ...extra },
});

afterEach(() => {
  for (const file of created.splice(0)) fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

describe('searchTranscript', () => {
  it('finds a file name inside a tool call, not only in the prose', () => {
    const file = writeSession([
      message('user', 'please fix the parser'),
      message('assistant', [
        { type: 'text', text: 'Looking at it.' },
        { type: 'toolCall', id: 't1', name: 'edit', arguments: { path: 'src/parser.ts' } },
      ]),
      message('toolResult', [{ type: 'text', text: 'edited src/parser.ts · +3 −1' }], {
        toolCallId: 't1',
        toolName: 'edit',
      }),
    ]);
    const found = searchTranscript(file, 'parser.ts', 8);
    assert.equal(found.length, 2);
    assert.equal(found[0].role, 'assistant');
    assert.match(found[0].text, /edit\(src\/parser\.ts\)/);
    assert.equal(found[1].role, 'toolResult');
  });

  it('matches case-insensitively and keeps command output', () => {
    const file = writeSession([
      message('assistant', [{ type: 'toolCall', id: 'b1', name: 'bash', arguments: { command: 'npm test' } }]),
      message('toolResult', [{ type: 'text', text: 'FAIL src/parser.test.ts > rejects EOF' }], {
        toolCallId: 'b1',
        toolName: 'bash',
      }),
    ]);
    const found = searchTranscript(file, 'fail', 8);
    assert.equal(found.length, 1);
    assert.match(found[0].text, /rejects EOF/);
  });

  it('returns the newest matches last, capped by the limit', () => {
    const file = writeSession(Array.from({ length: 6 }, (_, i) => message('user', `deploy note ${i}`)));
    const found = searchTranscript(file, 'deploy note', 3);
    assert.equal(found.length, 3);
    assert.match(found.at(-1)!.text, /deploy note 5/);
    assert.doesNotMatch(found[0].text, /deploy note 5/);
  });

  it('skips app-injected user messages and nothing at all for an unmatched query', () => {
    const file = writeSession([message('user', '[pi-desktop] internal reminder about the parser')]);
    assert.deepEqual(searchTranscript(file, 'parser', 8), []);
    assert.deepEqual(searchTranscript(file, '   ', 8), []);
  });

  it('reads a file that is gone or half-written as no history', () => {
    assert.deepEqual(searchTranscript('/nope/session.jsonl', 'anything', 8), []);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pidesk-search-')), 'broken.jsonl');
    created.push(file);
    fs.writeFileSync(file, '{"type":"message"\nnot json\n');
    assert.deepEqual(searchTranscript(file, 'anything', 8), []);
  });
});
