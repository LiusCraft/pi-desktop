// @ts-nocheck -- ported from untyped JS; these tests feed deliberately malformed input to runtime validators.
// Session naming helpers: placeholder extraction and model reply cleanup.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { cleanTitle, titleFromPrompt } from '../src/agent/naming';


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
