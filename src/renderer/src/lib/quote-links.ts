import { decodeReferencePrompt } from '@shared/context-reference';
import type { Item } from '@/store/types';

export interface QuotePin {
  /** The user message that quoted the passage. */
  userKey: string;
  comment?: string;
  /** The quoted text itself. */
  text: string;
}
export interface QuoteLinks {
  /** Item key → the replies that quote it. */
  pins: Map<string, QuotePin[]>;
  /** User item key → for each of its references, the item it quotes (null when it quotes nothing findable). */
  targets: Map<string, (string | null)[]>;
}

// A selection copies rendered text, the item holds markdown: compare without whitespace and markup characters.
export const squash = (text: string) => text.replace(/[\s*_`~#>|-]+/g, '');

const textOf = (item: Item): string | null => {
  if (item.kind === 'text' || item.kind === 'note') return item.text;
  if (item.kind === 'plan') return item.md;
  if (item.kind === 'user') return decodeReferencePrompt(item.text)?.text ?? item.text;
  return null;
};

/** Which earlier items each reply-to-a-passage reference points at. */
export function quoteLinks(items: Item[]): QuoteLinks {
  const pins = new Map<string, QuotePin[]>();
  const targets = new Map<string, (string | null)[]>();
  items.forEach((item, i) => {
    if (item.kind !== 'user') return;
    const decoded = decodeReferencePrompt(item.text);
    if (!decoded?.references.some((r) => r.kind === 'quote')) return;
    const found = decoded.references.map((reference) => {
      const needle = reference.kind === 'quote' && reference.text ? squash(reference.text) : '';
      if (!needle) return null;
      for (let j = i - 1; j >= 0; j--) {
        const text = textOf(items[j]);
        if (!text || !squash(text).includes(needle)) continue;
        const list = pins.get(items[j].key) ?? [];
        list.push({ userKey: item.key, comment: reference.comment, text: reference.text ?? '' });
        pins.set(items[j].key, list);
        return items[j].key;
      }
      return null;
    });
    targets.set(item.key, found);
  });
  return { pins, targets };
}

/** The DOM range of `quote` inside `root`, matched like `squash` does (the page shows rendered text, the quote was copied from it). */
export function findRange(root: HTMLElement, quote: string): Range | null {
  const needle = squash(quote);
  if (!needle) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('[data-quote-pins]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let flat = '';
  const at: { node: Text; offset: number }[] = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const data = node.data;
    for (let i = 0; i < data.length; i++) {
      if (squash(data[i])) {
        flat += data[i];
        at.push({ node, offset: i });
      }
    }
  }
  const start = flat.indexOf(needle);
  if (start < 0) return null;
  const range = document.createRange();
  range.setStart(at[start].node, at[start].offset);
  range.setEnd(at[start + needle.length - 1].node, at[start + needle.length - 1].offset + 1);
  return range;
}

const QUOTE_REF = 'quote-ref';
const QUOTE_FLASH = 'quote-flash';

// Injected at runtime: the CSS pipeline (lightningcss) doesn't know `::highlight()` and warns.
let styled = false;
function highlights() {
  if (typeof Highlight === 'undefined') return null;
  if (!styled) {
    styled = true;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      `::highlight(${QUOTE_REF}) { background: color-mix(in srgb, var(--info) 14%, transparent); }
::highlight(${QUOTE_FLASH}) { background: color-mix(in srgb, var(--warning) 45%, transparent); }`,
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  return CSS.highlights;
}

/** Marks every passage that has been replied to, until the returned cleanup runs. */
export function markQuoted(ranges: Range[]): () => void {
  const registry = highlights();
  if (!registry || !ranges.length) return () => {};
  registry.set(QUOTE_REF, new Highlight(...ranges));
  return () => void registry.delete(QUOTE_REF);
}

/** Scroll to a transcript item, or to the exact `quote` inside it, and flash it once. */
export function revealItem(key: string, quote?: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-item-key="${CSS.escape(key)}"]`);
  if (!el) return false;
  const range = quote ? findRange(el, quote) : null;
  const registry = highlights();
  if (range && registry) {
    range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    registry.set(QUOTE_FLASH, new Highlight(range));
    window.setTimeout(() => registry.delete(QUOTE_FLASH), 1800);
    return true;
  }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.removeAttribute('data-flash');
  void el.offsetWidth;
  el.setAttribute('data-flash', '1');
  el.addEventListener('animationend', () => el.removeAttribute('data-flash'), { once: true });
  return true;
}
