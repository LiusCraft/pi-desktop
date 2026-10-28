// What the transcript shows while a compaction runs and once it ends.
import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '../src/shared/protocol';
import { applyPiEvent, emptySession, replay } from '../src/renderer/src/store/transcript';

const meta = { id: 's1', title: 'Main', kind: 'code', projectPath: '/p', cwd: '/p' } as SessionMeta;
const notes = (s: ReturnType<typeof emptySession>) => s.items.flatMap((i) => (i.kind === 'note' ? [i.text] : []));

describe('compaction in the transcript', () => {
  it('marks the session compacting until the summary is in, then notes the new size', () => {
    const s = emptySession(meta);
    applyPiEvent(s, { type: 'compaction_start', reason: 'manual' }, 'normal');
    expect(s.compacting).toBe(true);
    expect(s.statusText).toBe('Compacting context…');

    const fx = applyPiEvent(s, { type: 'compaction_end', reason: 'manual', result: { tokensBefore: 120_000, estimatedTokensAfter: 12_000 }, aborted: false }, 'normal');
    expect(s.compacting).toBe(false);
    expect(fx.refreshStats).toBe(true);
    expect(notes(s)).toEqual(['Compacted · 120.0k → ~12.0k tokens']);
  });

  it('keeps the SDK failure text, without piling up its prefix', () => {
    const s = emptySession(meta);
    applyPiEvent(s, { type: 'compaction_start', reason: 'threshold' }, 'normal');
    applyPiEvent(s, { type: 'compaction_end', reason: 'threshold', aborted: false, errorMessage: 'Compaction failed: Nothing to compact (session too small)' }, 'normal');
    expect(s.compacting).toBe(false);
    expect(notes(s)).toEqual(['Compaction failed: Nothing to compact (session too small)']);
  });

  it('says nothing when the compaction was cancelled', () => {
    const s = emptySession(meta);
    applyPiEvent(s, { type: 'compaction_start', reason: 'manual' }, 'normal');
    applyPiEvent(s, { type: 'compaction_end', reason: 'manual', aborted: true }, 'normal');
    expect(s.compacting).toBe(false);
    expect(notes(s)).toEqual([]);
  });

  it('drops a stale compacting state when the history is rebuilt', () => {
    const s = emptySession(meta);
    s.compacting = true;
    replay(s, [], 'normal');
    expect(s.compacting).toBe(false);
  });
});
