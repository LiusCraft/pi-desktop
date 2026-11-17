import { useEffect, useState } from 'react';
import type { DiffBase, DiffComparison } from '@shared/protocol';
import { call } from '@/lib/api';
import type { SessionView } from '@/store/types';

/** Follow the existing git refresh flow, and discard replies from an older session or comparison. */
export function useDiffComparison(s: SessionView, target: DiffBase, enabled: boolean) {
  const kind = target.kind;
  const ref = target.kind === 'branch' ? target.ref : null;
  const key = JSON.stringify([s.meta.id, kind, ref]);
  const [result, setResult] = useState<{ key: string; data?: DiffComparison; error?: boolean } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const base: DiffBase = kind === 'branch' ? { kind, ref } : { kind };
    call('sessions:diff', s.meta.id, base).then(
      (data) => {
        if (cancelled) return;
        // Refreshing unchanged data must not rebuild the viewer's selections and open comments.
        setResult((previous) =>
          previous?.key === key && JSON.stringify(previous.data) === JSON.stringify(data) ? previous : { key, data },
        );
      },
      () => {
        if (!cancelled) setResult({ key, error: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, kind, ref, enabled, s.meta.id, s.changesVersion, s.turnChanges, s.meta.baseCommit, s.meta.branch]);
  const current = result?.key === key ? result : null;
  return { data: current?.data, error: !!current?.error };
}
