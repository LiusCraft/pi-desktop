// remark-gfm's autolink literals run to the next space or `<`, and only ASCII punctuation is kept out
// of the end. In "https://host/issues/1（`name`" the full-width bracket and what follows (here a code
// span) would all become part of the clickable address. This plugin cuts such a link at the first
// CJK or full-width punctuation mark and hands the rest back as ordinary text.

/** CJK symbols and punctuation (、。「」…) and the Halfwidth and Fullwidth Forms block (，（）；！？…). */
const STOP = /[　-〿＀-￯]/u;
const CODE_SPAN = /`([^`\n]+)`/g;

/** The leftover of a trimmed link as nodes: its backtick spans were swallowed too, so they are rebuilt. */
function tailNodes(tail: string): any[] {
  const out: any[] = [];
  let last = 0;
  for (const m of tail.matchAll(CODE_SPAN)) {
    if (m.index! > last) out.push({ type: 'text', value: tail.slice(last, m.index) });
    out.push({ type: 'inlineCode', value: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < tail.length) out.push({ type: 'text', value: tail.slice(last) });
  return out;
}

/** Where a link written as a bare address (not `[text](url)`) has to end, or -1 when it needs no cut. */
function cutAt(link: any): number {
  const [only] = link.children ?? [];
  if (link.children?.length !== 1 || only.type !== 'text' || link.title) return -1;
  const text: string = only.value;
  if (!/^(?:https?:\/\/|www\.)/i.test(text) || (link.url !== text && link.url !== `http://${text}`)) return -1;
  const at = text.search(STOP);
  return at > 0 ? at : -1;
}

/** remark plugin; runs after remark-gfm. */
export function remarkTrimAutolinks() {
  const visit = (node: any) => {
    if (!node.children) return;
    const out: any[] = [];
    for (const child of node.children) {
      const at = child.type === 'link' ? cutAt(child) : -1;
      if (at < 0) {
        visit(child);
        out.push(child);
        continue;
      }
      const text: string = child.children[0].value;
      const removed = text.length - at;
      out.push({ ...child, url: child.url.slice(0, child.url.length - removed), children: [{ ...child.children[0], value: text.slice(0, at) }] });
      out.push(...tailNodes(text.slice(at)));
    }
    node.children = out;
  };
  return (tree: any) => visit(tree);
}
