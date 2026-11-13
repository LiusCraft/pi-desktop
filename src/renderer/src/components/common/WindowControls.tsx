import { MinusIcon, SquareIcon, XIcon } from 'lucide-react';
import type { WindowTarget } from '@shared/protocol';
import { call, isWin32 } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const CONTROLS = [
  { action: 'minimize', label: 'main.windowMinimize', Icon: MinusIcon },
  { action: 'maximize', label: 'main.windowMaximize', Icon: SquareIcon },
  { action: 'close', label: 'main.windowClose', Icon: XIcon },
] as const;

export function WindowControls({ target }: { target: WindowTarget }) {
  const t = useT();
  if (!isWin32) return null;
  return (
    <div className="no-drag flex h-full items-start">
      {CONTROLS.map(({ action, label, Icon }) => (
        <button
          key={action}
          type="button"
          aria-label={t(label)}
          title={t(label)}
          className={cn(
            'flex h-8 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
            action === 'close' && 'hover:text-destructive-foreground hover:bg-destructive',
          )}
          onClick={() => void call('window:control', target, action)}
        >
          <Icon className="size-3" strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}
