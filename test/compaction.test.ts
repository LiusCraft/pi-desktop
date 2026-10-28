// What the transcript shows while a compaction runs and once it ends.
import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '../src/shared/protocol';
import { applyPiEvent, collapsedItems, emptySession, newKey, replay, transcriptItems } from '../src/renderer/src/store/transcript';
import type { Item } from '../src/renderer/src/store/types';

const meta = { id: 's1', title: 'Main', kind: 'code', projectPath: '/p', cwd: '/p' } as SessionMeta;
const cards = (items: Item[]) => items.flatMap((i) => (i.kind === 'compaction' ? [i] : []));
const notes = (items: Item[]) => items.flatMap((i) => (i.kind === 'note' ? [i.text] : []));

describe('compaction in the transcript', () => {
  it('marks the session compacting, then replaces the note with a summary card', () => {
    const s = emptySession(meta);
    applyPiEvent(s, { type: 'compaction_start', reason: 'manual' }, 'normal');
    expect(s.compacting).toBe(true);
    expect(s.statusText).toBe('Compacting context…');

    const fx = applyPiEvent(s, { type: 'compaction_end', reason: 'manual', result: { summary: 'What happened', tokensBefore: 120_000, estimatedTokensAfter: 12_000 }, aborted: false }, 'normal');
    expect(s.compacting).toBe(false);
    expect(fx.refreshStats).toBe(true);
    expect(cards(s.items)).toEqual([expect.objectContaining({ summary: 'What happened', tokensBefore: 120_000, tokensAfter: 12_000, open: false, openSummary: true })]);
    expect(notes(s.items)).toEqual([]);
  });

  it('keeps the SDK failure text, without piling up its prefix', () => {
    const s = emptySession(meta);
    applyPiEvent(s, { type: 'compaction_start', reason: 'threshold' }, 'normal');
    applyPiEvent(s, { type: 'compaction_end', reason: 'threshold', aborted: false, errorMessage: 'Compaction failed: Nothing to compact (session too small)' }, 'normal');
    expect(s.compacting).toBe(false);
    expect(notes(s.items)).toEqual(['Compaction failed: Nothing to compact (session too small)']);
    expect(cards(s.items)).toEqual([]);
  });

  it('says nothing when the compaction was cancelled', () => {
    const s = emptySession(meta);
    applyPiEvent(s, { type: 'compaction_start', reason: 'manual' }, 'normal');
    applyPiEvent(s, { type: 'compaction_end', reason: 'manual', aborted: true }, 'normal');
    expect(s.compacting).toBe(false);
    expect(s.items).toEqual([]);
  });

  it('rebuilds the summary as a card when a reopened session replays it', () => {
    const s = emptySession(meta);
    replay(s, [
      { role: 'compactionSummary', summary: 'The work so far', tokensBefore: 1000, timestamp: 1 },
      { role: 'user', content: 'carry on', timestamp: 2, entryId: 'e1' },
    ] as any, 'normal');
    expect(cards(s.items)[0]).toMatchObject({ summary: 'The work so far', tokensBefore: 1000, open: false });
    expect(s.items.some((i) => i.kind === 'user')).toBe(true);
  });

  it('hides everything above a collapsed card, and only that far back', () => {
    const items: Item[] = [
      { kind: 'user', key: newKey(), text: 'a', attachments: [] },
      { kind: 'text', key: newKey(), text: 'b', live: false },
      { kind: 'compaction', key: 'c1', summary: 's', open: false, hidden: 0, openSummary: true },
      { kind: 'text', key: newKey(), text: 'c', live: false },
      { kind: 'compaction', key: 'c2', summary: 's', open: false, hidden: 0, openSummary: true },
      { kind: 'text', key: newKey(), text: 'd', live: false },
    ];
    const collapse = collapsedItems(items);
    expect(collapse.hidden.size).toBe(3);
    expect(collapse.before.get('c1')).toBe(2);
    expect(collapse.before.get('c2')).toBe(1);
    expect(collapse.hidden.has(items[3].key)).toBe(true);
    expect(collapse.hidden.has(items[5].key)).toBe(false);

    items[2] = { ...(items[2] as Extract<Item, { kind: 'compaction' }>), open: true };
    expect(collapsedItems(items).hidden.has(items[0].key)).toBe(false);
  });

  it('loads older messages already expanded, with their own summaries folded', () => {
    const items = transcriptItems(meta, [
      { role: 'compactionSummary', summary: 'older summary', tokensBefore: 10, timestamp: 1 },
      { role: 'user', content: 'an old message', timestamp: 2 },
    ] as any, 'normal');
    expect(cards(items)[0]).toMatchObject({ summary: 'older summary', open: true, openSummary: false, hidden: 0 });
  });
});
