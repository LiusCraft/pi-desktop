// A turn Pi Desktop starts on its own because something happened on the pull request.
// The model has to receive it as a message (that is the only way to start a turn), but the
// conversation must not look like the user typed it: the same text carries a footer the
// transcript decodes into an event card. Modelled on shared/peer-message.ts.

const NOTICE =
  'Pi Desktop\'s own PR watcher started this turn, not the user: it saw a change on the pull request and the user left ' +
  'that automation on. Do the work the instruction asks for — use gh (GitHub) or glab (GitLab) and git for anything it refers to — and keep the ' +
  'usual permission rules in mind.';

/** Separates the human-readable situation from what to do about it. */
const ASK = '## 交给 Pi 的处理';
const FOOTER = '<!-- pi-desktop: ';
const FOOTER_END = ' -->';

export type PrEventKind = 'ci-fail' | 'notes' | 'merge';

/** One comment or review body, as the code host reports it. */
export interface PrNote {
  id: string;
  author: string;
  body: string;
  url?: string;
  /** Written by the account this app is logged in as (our own turns reply too). */
  self?: boolean;
}

export interface PrFailedCheck {
  name: string;
  url?: string;
}

export interface PrEvent {
  kind: PrEventKind;
  num: number;
  url: string;
  head?: string;
  /** One line for the card, e.g. `build (ubuntu) 失败` or `2 条新评论`. */
  summary: string;
  failed?: PrFailedCheck[];
  notes?: PrNote[];
  /** What the agent should do. The card keeps it behind a toggle. */
  instruction: string;
}

/** Keep stored history small: a long review body is context, not the whole point. */
const MAX_BODY = 2000;

const stored = (e: PrEvent): Omit<PrEvent, 'instruction'> => ({
  kind: e.kind, num: e.num, url: e.url, head: e.head, summary: e.summary,
  ...(e.failed?.length ? { failed: e.failed } : {}),
  ...(e.notes?.length ? { notes: e.notes.map((n) => ({ ...n, body: n.body.slice(0, MAX_BODY) })) } : {}),
});

export function encodePrEvent(e: PrEvent): string {
  const lines = [NOTICE, '', e.summary];
  for (const f of e.failed ?? []) lines.push(`- 失败的检查：${f.name}${f.url ? ` (${f.url})` : ''}`);
  for (const n of e.notes ?? []) lines.push(`--- @${n.author}${n.url ? ` (${n.url})` : ''} ---\n${n.body}`);
  lines.push('', ASK, e.instruction, '', `${FOOTER}${JSON.stringify(stored(e))}${FOOTER_END}`);
  return `<pr-event kind="${e.kind}">\n${lines.join('\n')}\n</pr-event>`;
}

/** The event behind a wire message, or null when this is an ordinary message. */
export function decodePrEvent(wire: string): PrEvent | null {
  const text = wire.trim();
  const open = /^<pr-event kind="([a-z-]+)">\n([\s\S]*)\n<\/pr-event>$/.exec(text);
  if (!open) return null;
  const body = open[2];
  const from = body.lastIndexOf(FOOTER);
  const to = body.lastIndexOf(FOOTER_END);
  if (from < 0 || to < from) return null;
  try {
    const data = JSON.parse(body.slice(from + FOOTER.length, to));
    if (!data || typeof data !== 'object') return null;
    const askAt = body.lastIndexOf(`${ASK}\n`);
    const instruction = askAt < 0 ? '' : body.slice(askAt + ASK.length + 1, from).trim();
    return { ...data, kind: data.kind ?? open[1], instruction } as PrEvent;
  } catch {
    return null;
  }
}

export const isPrEvent = (wire: string) => wire.startsWith('<pr-event ');
