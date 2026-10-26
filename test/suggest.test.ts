// Next-message prediction: the excerpt handed to the cheap model and the cleanup
// that keeps a reply from becoming unusable ghost text.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { cleanSuggestion, transcriptExcerpt } from '../src/agent/suggest';

const message = (role: string, text: unknown) => ({ role, content: text });

describe('transcriptExcerpt', () => {
  it('keeps the last turns in order and drops hidden desktop messages', () => {
    const excerpt = transcriptExcerpt([
      message('user', '[pi-desktop] You are in PLAN MODE.'),
      message('user', '日期显示少了一个月，帮我修一下'),
      message('assistant', '修好了，测试全部通过。'),
    ]);
    assert.equal(excerpt?.text, '<user>日期显示少了一个月，帮我修一下</user>\n<assistant>修好了，测试全部通过。</assistant>');
    assert.equal(excerpt?.lastAssistant, '修好了，测试全部通过。');
  });

  it('reads text blocks only and flattens the formatting', () => {
    const excerpt = transcriptExcerpt([{
      role: 'assistant',
      content: [{ type: 'text', text: 'Done.\n\n  Tests pass.  ' }, { type: 'toolCall', name: 'bash' }],
    }]);
    assert.equal(excerpt?.text, '<assistant>Done. Tests pass.</assistant>');
  });

  it('drops attached context and keeps the end of long assistant replies', () => {
    const context = `修复日期\n\nAttached context:\n\nContext from "src/utils/date.js"`;
    assert.equal(transcriptExcerpt([message('user', context)])?.text, '<user>修复日期</user>');
    const long = `${'a'.repeat(900)}THE END`;
    const excerpt = transcriptExcerpt([message('assistant', long)]);
    assert.equal(excerpt?.text.length, '<assistant></assistant>'.length + 1 + 900);
    assert.ok(excerpt?.text.endsWith('THE END</assistant>'));
  });

  it('keeps only the newest turns and needs at least one message', () => {
    const messages = Array.from({ length: 10 }, (_, i) => (i % 2 ? message('assistant', `reply ${i}`) : message('user', `ask ${i}`)));
    const excerpt = transcriptExcerpt(messages);
    assert.equal(excerpt?.text.split('\n').length, 6);
    assert.ok(excerpt?.text.startsWith('<user>ask 4</user>'));
    assert.ok(excerpt?.text.endsWith('<assistant>reply 9</assistant>'));
    assert.equal(transcriptExcerpt([]), null);
    assert.equal(transcriptExcerpt([message('toolResult', 'output')]), null);
    assert.equal(transcriptExcerpt([message('user', '   ')]), null);
  });

  it('honors the configured message count', () => {
    const messages = Array.from({ length: 10 }, (_, i) => (i % 2 ? message('assistant', `reply ${i}`) : message('user', `ask ${i}`)));
    assert.equal(transcriptExcerpt(messages, { context: 2 })?.text, '<user>ask 8</user>\n<assistant>reply 9</assistant>');
    assert.equal(transcriptExcerpt(messages, { context: 99 })?.text.split('\n').length, 10);
    assert.equal(transcriptExcerpt(messages, { context: 0 })?.text.split('\n').length, 6);
  });

  it('sends the whole conversation for context all, bounded by the model window', () => {
    const messages = Array.from({ length: 10 }, (_, i) => message(i % 2 ? 'assistant' : 'user', `${i}:${'x'.repeat(300)}`));
    assert.equal(transcriptExcerpt(messages, { context: 'all' })?.text.split('\n').length, 10);
    const bounded = transcriptExcerpt(messages, { context: 'all', contextWindow: 1_000 });
    assert.ok(bounded);
    assert.ok(bounded.text.length <= 1_100);
    assert.ok(bounded.text.includes('9:'));
    assert.ok(!bounded.text.includes('0:'));
    // A single newest message over budget keeps its end, where the ask usually is.
    const huge = transcriptExcerpt([message('assistant', 'a'.repeat(5_000))], { context: 'all', contextWindow: 1_000 });
    assert.ok(huge);
    assert.ok(huge.text.length <= 1_100);
    assert.ok(huge.text.startsWith('<assistant>…'));
  });
});

describe('cleanSuggestion', () => {
  it('unwraps labels, quotes, markdown and code fences', () => {
    assert.equal(cleanSuggestion('Next message: "跑一下测试"'), '跑一下测试');
    assert.equal(cleanSuggestion('```\n好的，继续\n```'), '好的，继续');
    assert.equal(cleanSuggestion('  **commit and push**  '), 'commit and push');
  });

  it('rejects nothing, refusals, echoes of the assistant and overlong replies', () => {
    assert.equal(cleanSuggestion('NONE'), null);
    assert.equal(cleanSuggestion('无'), null);
    assert.equal(cleanSuggestion("I'm sorry, I can't predict that."), null);
    assert.equal(cleanSuggestion('修好了，测试通过。', '修好了，测试通过。'), null);
    assert.equal(cleanSuggestion('修好了', '修好了，测试全部通过，你可以再跑一次看看效果'), null);
    assert.equal(cleanSuggestion('a'.repeat(101)), null);
    assert.equal(cleanSuggestion('   '), null);
  });
});
