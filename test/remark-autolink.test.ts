// Where a bare address in a reply stops being a link.
import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { remarkTrimAutolinks } from '../src/renderer/src/lib/remark-autolink';

/** The paragraph as a flat list: links as `[text -> url]`, code spans as `` `x` ``, the rest as is. */
function shape(markdown: string): string[] {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkTrimAutolinks);
  const tree: any = processor.runSync(processor.parse(markdown));
  const render = (n: any): string =>
    n.type === 'link'
      ? `[${n.children.map(render).join('')} -> ${n.url}]`
      : n.type === 'inlineCode'
        ? `\`${n.value}\``
        : (n.value ?? '');
  return tree.children[0].children.map(render);
}

describe('autolinks next to CJK punctuation', () => {
  it('ends the link before a full-width bracket and keeps the code span that followed', () => {
    expect(shape('https://github.com/qbox/xrobotd/issues/3142（`LiusCraft`')).toEqual([
      '[https://github.com/qbox/xrobotd/issues/3142 -> https://github.com/qbox/xrobotd/issues/3142]',
      '（',
      '`LiusCraft`',
    ]);
  });

  it('ends the link before other full-width and CJK punctuation', () => {
    for (const mark of ['，', '。', '）', '；', '、', '！']) {
      expect(shape(`见 https://example.com/a/b${mark}然后`)[1]).toBe(
        '[https://example.com/a/b -> https://example.com/a/b]',
      );
    }
  });

  it('trims www links too', () => {
    expect(shape('www.example.com/x（说明')[0]).toBe('[www.example.com/x -> http://www.example.com/x]');
  });

  it('leaves ordinary links alone', () => {
    expect(shape('see https://example.com/a?b=1&c=2 now')[1]).toBe(
      '[https://example.com/a?b=1&c=2 -> https://example.com/a?b=1&c=2]',
    );
    expect(shape('[点这里（说明）](https://example.com)')).toEqual(['[点这里（说明） -> https://example.com]']);
    expect(shape('https://zh.wikipedia.org/wiki/中文')[0]).toBe(
      '[https://zh.wikipedia.org/wiki/中文 -> https://zh.wikipedia.org/wiki/中文]',
    );
  });
});
