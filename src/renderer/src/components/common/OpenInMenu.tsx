import type { ReactElement } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { OpenTargetIcon } from '@/components/common/OpenTargetIcon';
import { call } from '@/lib/api';
import { OPEN_TARGET_INFO, refreshOpenTargets, useOpenTargets } from '@/lib/open-targets';
import { fail } from '@/store/actions';

/** The editors that are installed, plus terminal and file manager, for opening the session's folder. */
export function OpenInMenu({ id, children }: { id: string; /** The button that opens the menu. */ children: ReactElement }) {
  const targets = useOpenTargets();
  return (
    <DropdownMenu onOpenChange={(o) => o && refreshOpenTargets()}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Open in</DropdownMenuLabel>
        {targets.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => call('sessions:openIn', id, t.id).catch(fail)}>
            <OpenTargetIcon target={t} />
            {OPEN_TARGET_INFO[t.id].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
