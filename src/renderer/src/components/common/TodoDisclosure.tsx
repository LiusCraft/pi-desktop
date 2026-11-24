import type { ReactNode } from 'react';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { Collapsible } from '@/components/ui/collapsible';
import { call } from '@/lib/api';
import { fail } from '@/store/actions';
import { useApp } from '@/store/app';

/** All checklists share the app preference, independently of their session and contents. */
export function TodoDisclosure({ children, className }: { children: ReactNode; className?: string }) {
  const open = useApp((s) => s.settings.todosExpanded ?? DEFAULT_SETTINGS.todosExpanded);
  return (
    <Collapsible
      className={className}
      open={open}
      onOpenChange={(todosExpanded) => void call('settings:set', { todosExpanded }).catch(fail)}
    >
      {children}
    </Collapsible>
  );
}
