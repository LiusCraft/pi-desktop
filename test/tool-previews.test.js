const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const previews = require('../renderer/tool-previews');
const text = (value, details) => ({ content: [{ type: 'text', text: value }], details });

describe('native tool preview normalization', () => {
  it('loads the same helper as a browser UMD global without Node APIs', () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/tool-previews.js'), 'utf8'), context);
    assert.equal(typeof context.ToolPreviews.read, 'function');
    assert.equal(context.ToolPreviews.read({ offset: 20 }, text('raw')).startLine, 20);
  });
  it('keeps raw source and numbers from read offset, including empty lines', () => {
    const p = previews.read({ offset: 37 }, text('    const n = 1;\n\n9 not a gutter\n'));
    assert.deepEqual(p.lines, ['    const n = 1;', '', '9 not a gutter', '']);
    assert.equal(p.startLine, 37);
    assert.equal(p.nextOffset, null);
  });
  it('separates line-limit and byte-limit continuation footers from real source', () => {
    for (const suffix of ['', ' (50.0KB limit)']) {
      const source = 'first\n\nlast';
      const footer = `[Showing lines 601-603 of 980${suffix}. Use offset=604 to continue.]`;
      const p = previews.read({ offset: 601 }, text(`${source}\n\n${footer}`, { truncation: { truncated: true, content: source } }));
      assert.deepEqual(p.lines, ['first', '', 'last']);
      assert.equal(p.footer, footer);
      assert.equal(p.startLine, 601);
      assert.equal(p.totalLines, 980);
      assert.equal(p.nextOffset, 604);
    }
    const limited = previews.read({ offset: 4, limit: 2 }, text('a\nb\n\n[9 more lines in file. Use offset=6 to continue.]'));
    assert.deepEqual(limited.lines, ['a', 'b']);
    assert.equal(limited.totalLines, 14);
    assert.equal(limited.nextOffset, 6);
  });
  it('uses structured truncation content and leaves non-terminal lookalikes untouched', () => {
    const p = previews.read({}, text('do not infer the source here', { truncation: { truncated: true, content: 'actual\nsource' } }));
    assert.deepEqual(p.lines, ['actual', 'source']);
    const literal = '[Showing lines 1-2 of 9. Use offset=3 to continue.]\ncode';
    assert.deepEqual(previews.read({}, text(literal)).lines, literal.split('\n'));
  });
  it('never renders read failures or oversized-first-line notices as numbered source', () => {
    assert.equal(previews.read({}, text('ENOENT'), true).type, 'error');
    assert.equal(previews.read({}, text('[Line 1 is too long]', { truncation: { firstLineExceedsLimit: true, content: '' } })).type, 'notice');
    assert.equal(previews.read({ offset: -5 }, text('a')).startLine, 1);
  });
  it('keeps read images as controlled raster data, never fabricated source rows', () => {
    const result = { content: [{ type: 'text', text: 'Read image file [image/png]' }, { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }] };
    const p = previews.read({}, result);
    assert.equal(p.type, 'image');
    assert.equal(p.images[0].src, 'data:image/png;base64,aGVsbG8=');
    for (const block of [{ type: 'image', mimeType: 'image/svg+xml', data: 'aGVsbG8=' }, { type: 'image', mimeType: 'image/png', data: 'https://bad.test/x' }]) {
      assert.deepEqual(previews.read({}, { content: [block] }).images, []);
    }
    assert.equal(previews.read({}, result, true).type, 'error');
  });
  it('parses native numbered diff markers, padded numbers and gaps, not unified patches', () => {
    const diff = '    ...\n  42 context\n- 43   old\n+ 43   new\n+ 44 extra\n  44 next\n    ...';
    const p = previews.edit({}, text('ok', { diff, firstChangedLine: 43, patch: '@@ ignored' }));
    assert.equal(p.type, 'diff');
    assert.equal(p.firstChangedLine, 43);
    assert.equal(p.add, 2);
    assert.equal(p.del, 1);
    assert.deepEqual(p.rows[2], { t: '-', o: 43, s: '  old' });
    assert.deepEqual(p.rows[3], { t: '+', n: 43, s: '  new' });
    assert.deepEqual(p.rows[0], { gap: true });
    assert.equal(previews.edit({}, text('ok', { diff: '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new' })).type, 'notice');
  });
  it('counts the full native diff even when rendering will bound its preview', () => {
    const diff = Array.from({ length: 500 }, (_, i) => `+${i + 2201} line${i}`).join('\n');
    const p = previews.edit({}, text('ok', { diff, firstChangedLine: 2201 }));
    assert.equal(p.add, 500);
    assert.equal(p.rows.length, 500);
    assert.equal(p.firstChangedLine, 2201);
    assert.equal(previews.edit({}, text('Permission denied', { diff }), true).add, undefined);
  });
  it('treats writes as submitted snapshots without inventing new files or add counts', () => {
    const p = previews.write({ content: 'already existed\nnew content' }, text('Successfully wrote'));
    assert.equal(p.type, 'snapshot');
    assert.deepEqual(p.lines, ['already existed', 'new content']);
    assert.equal(p.add, undefined);
    assert.match(p.note, /previous version unavailable/);
    assert.equal(previews.write({ content: '' }, text('ok')).empty, true);
    assert.equal(previews.write({ content: 'not written' }, text('Denied'), true).type, 'error');
  });
  it('windows long current files around the real target and can page both ways', () => {
    const source = Array.from({ length: 5200 }, (_, i) => `line ${i + 1}`).join('\n');
    const p = previews.lineWindow(source, 3201);
    assert.equal(p.lines.length, 1000);
    assert.equal(p.startLine, 2701);
    assert.equal(p.targetLine, 3201);
    assert.equal(p.lines[p.targetLine - p.startLine], 'line 3201');
    const next = previews.lineWindow(source, 3201, p.next);
    assert.equal(next.startLine, 3701);
    assert.equal(previews.lineWindow(source, 3201, next.previous).startLine, p.startLine);
    assert.equal(previews.lineWindow(source, 6000).targetLine, 5200);
    assert.equal(previews.lineWindow('one\ntwo', 500).targetLine, 2);
    assert.equal(previews.lineWindow('one\ntwo', 500).startLine, 1);
    assert.equal(previews.lineWindow('', 500).targetLine, 1);
    assert.equal(previews.lineWindow(source, 1, undefined, true).lines.length, 5200);
  });
});
