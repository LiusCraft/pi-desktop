// @ts-nocheck -- ported from untyped JS; these tests feed deliberately malformed input to runtime validators.
// Session naming helpers: placeholder extraction, model reply cleanup and the
// "cheapest model from the same provider" choice.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { cleanTitle, pickNamingModel, titleFromPrompt } from '../src/agent/naming';


describe('titleFromPrompt', () => {
  it('uses the user\'s words, dropping @mentions and code', () => {
    assert.equal(
      titleFromPrompt('看看 @src/app.js 里 `formatDate` 的 ```js\nconst x = 1\n``` 问题'),
      '看看 里 formatDate 的 问题',
    );
  });

  it('collapses whitespace and truncates long messages', () => {
    assert.equal(titleFromPrompt('  fix\n\n  the   tests  '), 'fix the tests');
    const long = titleFromPrompt('a'.repeat(80));
    assert.equal(long.length, 61);
    assert.ok(long.endsWith('…'));
  });

  it('returns an empty string when nothing is left', () => {
    assert.equal(titleFromPrompt('@only-a-file'), '');
    assert.equal(titleFromPrompt(''), '');
  });
});

describe('cleanTitle', () => {
  it('strips labels, quotes, markdown and trailing punctuation', () => {
    assert.equal(cleanTitle('Title: "Fix date parsing."'), 'Fix date parsing');
    assert.equal(cleanTitle('**修复日期解析**'), '修复日期解析');
    assert.equal(cleanTitle('## Fix the pasted SVG icon'), 'Fix the pasted SVG icon');
  });

  it('takes the first line only', () => {
    assert.equal(cleanTitle('Fix date parsing\n\nHere is why…'), 'Fix date parsing');
  });

  it('rejects sentences, greetings and refusals', () => {
    assert.equal(cleanTitle('你好！我是离线演示模型，不需要 API Key，可以帮你做很多事情和更多的事情'), null);
    assert.equal(cleanTitle("I'm sorry, I can't help with that."), null);
    assert.equal(cleanTitle('   '), null);
  });
});

describe('pickNamingModel', () => {
  const model = (id, provider, input, output, extra = {}) => ({
    id, provider, cost: { input, output }, contextWindow: 200000, ...extra,
  });

  it('prefers the cheapest model from the session provider', () => {
    const models = [
      model('big-model', 'anthropic', 3, 15),
      model('claude-haiku-4-5', 'anthropic', 1, 5),
      model('tiny', 'openai', 0.1, 0.4),
    ];
    assert.equal(pickNamingModel(models, 'anthropic/big-model'), 'anthropic/claude-haiku-4-5');
  });

  it('falls back to the cheapest across providers and skips the demo model', () => {
    const models = [
      model('demo-coder', 'demo', 0, 0),
      model('big-model', 'xai', 3, 15),
      model('mini', 'openai', 0.1, 0.4),
    ];
    assert.equal(pickNamingModel(models, 'demo/demo-coder'), 'openai/mini');
  });

  it('returns null when only the offline demo model exists', () => {
    assert.equal(pickNamingModel([model('demo-coder', 'demo', 0, 0)], 'demo/demo-coder'), null);
    assert.equal(pickNamingModel([], null), null);
  });
});
