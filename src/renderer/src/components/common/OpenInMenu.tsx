import type { ReactElement } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ExternalLinkIcon } from 'lucide-react';
import { OpenTargetIcon } from '@/components/common/OpenTargetIcon';
import { call, isRemote } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { OPEN_TARGET_INFO, refreshOpenTargets, useOpenTargets } from '@/lib/open-targets';
import { fail } from '@/store/actions';

function OpenInItems({ id }: { id: string }) {
  const targets = useOpenTargets();
  const t = useT();
  return (
    <>
      <DropdownMenuLabel className="mb-0.5">{t('open.label')}</DropdownMenuLabel>
      {targets.map((o) => (
        <DropdownMenuItem key={o.id} onSelect={() => call('sessions:openIn', id, o.id).catch(fail)}>
          <OpenTargetIcon target={o} />
          {OPEN_TARGET_INFO[o.id].label}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** The same targets inside a panel's overflow menu. */
export function OpenInSubmenu({ id }: { id: string }) {
  const t = useT();
  if (isRemote) return null;
  return (
    <DropdownMenuSub onOpenChange={(open) => open && refreshOpenTargets()}>
      <DropdownMenuSubTrigger>
        <ExternalLinkIcon />
        {t('panel.openIn')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        <OpenInItems id={id} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** The editors that are installed, plus terminal and file manager, for opening the session's folder. */
export function OpenInMenu({
  id,
  children,
}: {
  id: string;
  /** The button that opens the menu. */ children: ReactElement;
}) {
  if (isRemote) return null;
  return (
    <DropdownMenu onOpenChange={(o) => o && refreshOpenTargets()}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <OpenInItems id={id} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
