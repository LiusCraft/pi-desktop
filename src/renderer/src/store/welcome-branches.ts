// Git is external state: show the last read for this project and revalidate on each welcome visit.
import { create } from 'zustand';
import { call } from '@/lib/api';

interface BranchInfo {
  current: string | null;
  branches: string[];
  defaultRef: string | null;
  selected: string | null;
}

// Absent = first read pending; null = read failed (not the same as a non-Git folder).
export const useWelcomeBranches = create<Record<string, BranchInfo | null>>(() => ({}));
const pending = new Map<string, Promise<void>>();

export function chooseBase(project: string, selected: string | null) {
  const info = useWelcomeBranches.getState()[project];
  if (info) useWelcomeBranches.setState({ [project]: { ...info, selected } });
}

export function refreshBranches(project: string) {
  const inFlight = pending.get(project);
  if (inFlight) return inFlight;
  const read = async () => {
    try {
      const [head, branches, defaultRef] = await Promise.all([
        call('git:branch', project),
        call('git:branches', project),
        call('git:defaultBranch', project),
      ]);
      const current = head === 'HEAD' ? null : head;
      const choice = useWelcomeBranches.getState()[project]?.selected;
      const selected = choice && (choice === current || branches.includes(choice)) ? choice : null;
      useWelcomeBranches.setState({ [project]: { current, branches, defaultRef: defaultRef ?? current, selected } });
    } catch {
      if (!useWelcomeBranches.getState()[project]) useWelcomeBranches.setState({ [project]: null });
    }
  };
  // Local refs do not depend on the network. Only re-read them if fetching actually updated the remote view.
  const request = Promise.all([read(), call('git:refresh', project).catch(() => false)])
    .then(([, fetched]) => (fetched ? read() : undefined))
    .finally(() => pending.delete(project));
  pending.set(project, request);
  return request;
}
