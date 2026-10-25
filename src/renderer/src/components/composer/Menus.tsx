import type { ReactNode } from 'react';
import { CheckIcon } from 'lucide-react';
import type { ModelInfo, PermissionMode, ThinkingLevel } from '@shared/protocol';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LEVEL_LABEL, MODES } from '@/lib/constants';
import { fmtTok } from '@/lib/format';
import { cn } from '@/lib/utils';
import { chooseEffort, chooseModel, setPermMode } from '@/store/actions';
import { setApp, useApp } from '@/store/app';
import { dialogs } from '@/store/dialogs';

/** A dropdown that a slash command (/model, /permissions) can also open. */
function useMenu(name: 'model' | 'mode') {
  const open = useApp((s) => s.menu === name);
  return { open, onOpenChange: (o: boolean) => setApp((s) => void (s.menu = o ? name : null)) };
}

export function FootButton({ children, className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button {...props} className={cn('flex h-7 max-w-56 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent', className)}>
      {children}
    </button>
  );
}

function Option({ active, title, hint, onSelect }: { active: boolean; title: ReactNode; hint?: ReactNode; onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="items-start gap-2 py-1.5">
      <CheckIcon className={cn('mt-0.5 size-3.5 shrink-0', !active && 'invisible')} />
      <span className="min-w-0">
        <span className="block truncate">{title}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </DropdownMenuItem>
  );
}

export function ModelMenu({ model, trigger, align = 'end' }: { model: string | null; trigger: ReactNode; align?: 'start' | 'end' }) {
  const models = useApp((s) => s.models);
  const menu = useMenu('model');
  const byProvider = new Map<string, ModelInfo[]>();
  for (const m of models) byProvider.set(m.provider, [...(byProvider.get(m.provider) ?? []), m]);
  return (
    <DropdownMenu {...menu}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} side="top" className="max-h-[min(70vh,560px)] w-72 overflow-y-auto">
        {[...byProvider].map(([provider, list], i) => (
          <div key={provider}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs text-muted-foreground">{provider}</DropdownMenuLabel>
            {list.map((m) => {
              const id = `${m.provider}/${m.id}`;
              return (
                <Option
                  key={id}
                  active={id === model}
                  title={m.name || m.id}
                  hint={[m.contextWindow ? `${fmtTok(m.contextWindow)} context` : '', m.reasoning ? 'reasoning' : ''].filter(Boolean).join(' · ')}
                  onSelect={() => void chooseModel(id)}
                />
              );
            })}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void dialogs.keys()}>Add API key…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EffortMenu({ levels, effort }: { levels: ThinkingLevel[]; effort: ThinkingLevel | null }) {
  if (!levels.length || (levels.length === 1 && levels[0] === 'off')) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FootButton title="Thinking effort">{effort ? LEVEL_LABEL[effort] ?? effort : 'Effort'}</FootButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Thinking effort</DropdownMenuLabel>
        {levels.map((l) => <Option key={l} active={l === effort} title={LEVEL_LABEL[l] ?? l} onSelect={() => void chooseEffort(l)} />)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const MODE_TONE: Partial<Record<PermissionMode, string>> = {
  plan: 'text-info',
  acceptEdits: 'text-primary',
  bypass: 'text-destructive',
};

export function ModeMenu({ mode }: { mode: PermissionMode }) {
  const menu = useMenu('mode');
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  return (
    <DropdownMenu {...menu}>
      <DropdownMenuTrigger asChild>
        <FootButton title="Mode  Shift+Tab" className={MODE_TONE[mode]}>{current.name}</FootButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-80">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Mode · ⇧Tab to cycle</DropdownMenuLabel>
        {MODES.map((m) => <Option key={m.id} active={m.id === mode} title={m.name} hint={m.desc} onSelect={() => setPermMode(m.id)} />)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ContextRing({ pct, busy }: { pct: number | null; busy?: boolean }) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <span className={cn('flex size-7 items-center justify-center text-muted-foreground', busy && 'animate-pulse')} title={pct == null ? 'Context · /compact 可以压缩' : `Context: ${Math.round(p)}% used · /compact 可以压缩`}>
      <svg viewBox="0 0 20 20" className="size-[17px]">
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="1.6" />
        <circle cx="10" cy="10" r="7" fill="none" stroke="var(--info)" strokeWidth="2" strokeDasharray={`${((p / 100) * 44).toFixed(1)} 44`} strokeLinecap="round" transform="rotate(-90 10 10)" />
      </svg>
    </span>
  );
}
