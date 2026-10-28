import type { ReactElement } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { OpenTargetIcon } from '@/components/common/OpenTargetIcon';
import { call, isRemote } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { OPEN_TARGET_INFO, refreshOpenTargets, useOpenTargets } from '@/lib/open-targets';
import { fail } from '@/store/actions';

/** The editors that are installed, plus terminal and file manager, for opening the session's folder. */
export function OpenInMenu({ id, children }: { id: string; /** The button that opens the menu. */ children: ReactElement }) {
  const targets = useOpenTargets();
  const t = useT();
  if (isRemote) return null;
  return (
    <DropdownMenu onOpenChange={(o) => o && refreshOpenTargets()}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t('open.label')}</DropdownMenuLabel>
        {targets.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => call('sessions:openIn', id, o.id).catch(fail)}>
            <OpenTargetIcon target={o} />
            {OPEN_TARGET_INFO[o.id].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
