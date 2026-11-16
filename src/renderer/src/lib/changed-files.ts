import type { ChangedFile } from '@/store/types';

export interface SessionFileOutput {
  path: string;
  kind: 'write' | 'edit';
  t: number;
}

export interface ChangedFileSummary extends SessionFileOutput {
  created: boolean;
  change?: ChangedFile;
}

/** Join the files recorded by output tools with the latest git diff metadata. */
export function changedFileSummaries(
  outputs: readonly SessionFileOutput[],
  changes: readonly ChangedFile[],
): ChangedFileSummary[] {
  const byPath = new Map(changes.map((file) => [file.path, file]));
  return [...outputs]
    .sort((a, b) => b.t - a.t)
    .map((file) => {
      const change = byPath.get(file.path);
      return {
        ...file,
        change,
        created: change?.status === 'A' || (!change && file.kind === 'write'),
      };
    });
}
