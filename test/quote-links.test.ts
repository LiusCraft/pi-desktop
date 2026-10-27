import { describe, expect, it } from 'vitest';
import { referencePrompt } from '../src/shared/context-reference';
import { quoteLinks } from '../src/renderer/src/lib/quote-links';
import type { Item } from '../src/renderer/src/store/types';

const user = (key: string, text: string) => ({ kind: 'user', key, text }) as Item;
const text = (key: string, body: string) => ({ kind: 'text', key, text: body, live: false }) as Item;

describe('quoteLinks', () => {
  it('pins the passage a reply quotes, matching rendered text against markdown', () => {
    const items = [
      user('u1', '帮我看看'),
      text('a1', '这里 **有一个** bug：\n\n- 空指针'),
      user('u2', referencePrompt('为什么', [{ id: 'q', kind: 'quote', path: '', text: '有一个 bug：空指针', comment: '细说' }])),
    ];
    const { pins, targets } = quoteLinks(items);
    expect(pins.get('a1')).toEqual([{ userKey: 'u2', comment: '细说', text: '有一个 bug：空指针' }]);
    expect(targets.get('u2')).toEqual(['a1']);
  });

  it('leaves a quote of nothing findable unlinked', () => {
    const items = [user('u1', referencePrompt('', [{ id: 'q', kind: 'quote', path: '', text: '不存在' }]))];
    expect(quoteLinks(items).targets.get('u1')).toEqual([null]);
  });
});
