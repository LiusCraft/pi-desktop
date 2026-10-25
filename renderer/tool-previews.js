// Native pi tool results normalized without inventing a before-version or line numbers.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ToolPreviews = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PREVIEW_LINES = 200;
  const WINDOW_LINES = 1000;
  const positiveLine = (value, fallback = 1) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  const textOf = (content) => typeof content === 'string' ? content : (Array.isArray(content) ? content : []).filter((b) => b?.type === 'text').map((b) => String(b.text || '')).join('\n');
  const linesOf = (text) => String(text).split('\n');
  const imageOf = (block) => {
    if (!block || block.type !== 'image' || !/^image\/(png|jpeg|gif|webp)$/.test(block.mimeType || '')) return null;
    if (typeof block.data !== 'string' || !block.data.length || block.data.length > 28 * 1024 * 1024 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(block.data)) return null;
    return { mimeType: block.mimeType, src: `data:${block.mimeType};base64,${block.data}` };
  };
  function read(args = {}, result = {}, isError = false) {
    const text = textOf(result.content);
    if (isError) return { type: 'error', text };
    const blocks = Array.isArray(result.content) ? result.content : [];
    const images = blocks.map(imageOf).filter(Boolean);
    if (blocks.some((b) => b?.type === 'image') || /^Read image file \[image\//.test(text)) {
      return { type: 'image', text, images };
    }
    const truncation = result.details?.truncation;
    if (truncation?.firstLineExceedsLimit) return { type: 'notice', text };
    // Only a native, terminal continuation footer is metadata. File text remains raw.
    const footer = text.match(/\n\n(\[(?:Showing lines (\d+)-(\d+) of (\d+)(?: \([^\]\n]+ limit\))?\. Use offset=(\d+) to continue\.|(\d+) more lines in file\. Use offset=(\d+) to continue\.)\])$/);
    let source = footer ? text.slice(0, footer.index) : text;
    if (truncation?.truncated && typeof truncation.content === 'string') source = truncation.content;
    const startLine = positiveLine(args.offset);
    const lines = linesOf(source);
    const totalLines = footer ? (footer[4] ? Number(footer[4]) : startLine + lines.length - 1 + Number(footer[6])) : null;
    return { type: 'code', lines, startLine, totalLines, footer: footer?.[1] || '', nextOffset: footer ? Number(footer[5] || footer[7]) : null };
  }
  function parseNativeDiff(diff) {
    if (typeof diff !== 'string') return null;
    const rows = [];
    let add = 0, del = 0;
    for (const line of diff.split('\n')) {
      if (/^ +\.\.\.$/.test(line)) { rows.push({ gap: true }); continue; }
      if (!line && !diff) continue;
      const match = line.match(/^([ +\-]) *(\d+) (.*)$/);
      if (!match || !positiveLine(match[2], 0)) return null;
      const t = match[1], number = Number(match[2]);
      rows.push({ t, ...(t === '-' ? { o: number } : { n: number }), s: match[3] });
      if (t === '+') add++;
      if (t === '-') del++;
    }
    return { rows, add, del };
  }
  function edit(args = {}, result = {}, isError = false) {
    const text = textOf(result.content);
    if (isError) return { type: 'error', text };
    const parsed = parseNativeDiff(result.details?.diff);
    const firstChangedLine = positiveLine(result.details?.firstChangedLine, 0) || (parsed?.rows.find((r) => r.t === '+' || r.t === '-')?.n ?? parsed?.rows.find((r) => r.t === '-')?.o) || 1;
    if (!parsed) return { type: 'notice', text: typeof result.details?.diff === 'string' ? result.details.diff : text, firstChangedLine };
    return { type: 'diff', ...parsed, firstChangedLine };
  }
  function write(args = {}, result = {}, isError = false) {
    if (isError) return { type: 'error', text: textOf(result.content) };
    if (typeof args.content !== 'string') return { type: 'notice', text: textOf(result.content) };
    return { type: 'snapshot', lines: linesOf(args.content), startLine: 1, empty: args.content === '', note: 'Written content · previous version unavailable' };
  }
  // A bounded window can include any target, including lines beyond the first 2,000.
  function lineWindow(text, target = 1, start, all = false) {
    const lines = linesOf(text), total = lines.length;
    const requested = positiveLine(target);
    const targetLine = Math.min(requested, total);
    const from = all ? 1 : Math.max(1, Math.min(positiveLine(start, Math.max(1, requested - Math.floor(WINDOW_LINES / 2))), Math.max(1, total - WINDOW_LINES + 1)));
    const to = all ? total : Math.min(total, from + WINDOW_LINES - 1);
    return { lines: lines.slice(from - 1, to), startLine: from, endLine: to, totalLines: total, targetLine, previous: from > 1 ? Math.max(1, from - WINDOW_LINES) : null, next: to < total ? from + WINDOW_LINES : null };
  }
  return { PREVIEW_LINES, WINDOW_LINES, positiveLine, textOf, read, edit, write, parseNativeDiff, lineWindow };
});
