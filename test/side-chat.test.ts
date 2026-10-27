// Side chat (/btw): the transcript handed to the model and the request built from the
// side conversation. Nothing here may touch the session itself.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { sideMessages, sideTranscript, sideUserText } from '../src/agent/side-chat';

describe('sideTranscript', () => {
  it('keeps formatting, shrinks tool calls and output, and skips hidden turns', () => {
    const text = sideTranscript([
      { role: 'user', content: '[pi-desktop] You are in PLAN MODE.' },
      { role: 'user', content: '修一下日期\n\n```js\nfoo()\n```' },
      { role: 'assistant', content: [{ type: 'text', text: '好的' }, { type: 'toolCall', name: 'read', arguments: { path: 'a.ts' } }] },
      { role: 'toolResult', content: [{ type: 'text', text: 'x'.repeat(2000) }] },
    ]);
    assert.ok(!text.includes('PLAN MODE'));
    assert.ok(text.includes('<user>修一下日期\n\n```js\nfoo()\n```</user>'));
    assert.ok(text.includes('[tool call: read {"path":"a.ts"}]'));
    assert.ok(text.includes(`<tool_result>${'x'.repeat(600)}…</tool_result>`));
  });

  it('drops the oldest turns first when over budget', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `${i}:${'y'.repeat(1000)}` }));
    const text = sideTranscript(messages, { contextWindow: 2000 });
    assert.ok(text.startsWith('[earlier conversation omitted]'));
    assert.ok(text.includes('<user>19:'));
    assert.ok(!text.includes('<user>0:'));
  });
});

describe('sideMessages', () => {
  it('puts the quote before the question', () => {
    assert.equal(sideUserText({ role: 'user', text: '为什么？', quote: 'a\nb' }), '> a\n> b\n\n为什么？');
  });

  it('wraps the transcript and the side dialogue into one user message', () => {
    const request = sideMessages('<user>hi</user>', [
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'a1' },
      { role: 'user', text: 'q2', quote: 'passage' },
    ]);
    assert.equal(request?.length, 1);
    assert.equal(request?.[0].role, 'user');
    const content = request![0].content;
    assert.ok(content.includes('<conversation>\n<user>hi</user>\n</conversation>'));
    assert.ok(content.includes('<user>q1</user>\n<assistant>a1</assistant>\n<user>> passage\n\nq2</user>'));
  });

  it('needs a question to answer', () => {
    assert.equal(sideMessages('', []), null);
    assert.equal(sideMessages('', [{ role: 'assistant', text: 'a' }]), null);
  });
});
