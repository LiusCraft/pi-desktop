import { useEffect, useState, type ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import type { ContextBreakdown, ModelInfo, PermissionMode, ThinkingLevel } from '@shared/protocol';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { call } from '@/lib/api';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LEVEL_LABEL, MODES } from '@/lib/constants';
import { fmtTok, fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { chooseEffort, chooseModel, compactSession, fail, setPermMode } from '@/store/actions';
import { setApp, useApp } from '@/store/app';

/** A dropdown that a slash command (/model, /permissions) can also open. */
function useMenu(name: 'model' | 'mode' | 'context') {
  const open = useApp((s) => s.menu === name);
  return { open, onOpenChange: (o: boolean) => setApp((s) => void (s.menu = o ? name : null)) };
}

export function FootButton({ children, className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button {...props} className={cn('flex h-7 max-w-56 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent', className)}>
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
        <DropdownMenuItem onSelect={() => call('settings:open', 'models')}>管理模型…</DropdownMenuItem>
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

type Category = ContextBreakdown['categories'][number];
type Group = ContextBreakdown['items'][number]['group'];

const CATEGORY_COLOR: Record<Category['key'], string> = {
  messages: 'var(--info)',
  mcp: '#d97757',
  extension: '#a78bfa',
  system: '#4fa37a',
  skills: '#d4a03a',
  memory: '#4aa8b5',
  prompt: 'color-mix(in srgb, var(--muted-foreground) 70%, transparent)',
  buffer: 'color-mix(in srgb, var(--muted-foreground) 40%, transparent)',
  free: 'var(--muted)',
};
const GROUPS: Group[] = ['mcp', 'extension', 'system', 'skills', 'memory'];

const pctOf = (n: number, of: number) => `${of ? ((n / of) * 100).toFixed(1) : '0.0'}%`;

/** The context ring; click it for where the window goes (messages, tools, skills, system prompt, buffer). */
export function ContextRing({ pct, busy, sid }: { pct: number | null; busy?: boolean; sid?: string }) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  const menu = useMenu('context');
  const open = !!sid && menu.open;
  const [data, setData] = useState<ContextBreakdown | null | undefined>(undefined);
  const [expanded, setExpanded] = useState<Group | null>(null);
  useEffect(() => {
    if (!open || !sid) return;
    let live = true;
    call('sessions:context', sid).then((d) => live && setData(d), () => live && setData(null));
    return () => void (live = false);
  }, [open, sid, pct]);
  const ring = (
    <span className={cn('flex size-7 items-center justify-center rounded-md text-muted-foreground', sid && 'hover:bg-accent', busy && 'animate-pulse')} title={pct == null ? 'Context' : `Context: ${Math.round(p)}% used`}>
      <svg viewBox="0 0 20 20" className="size-[17px]">
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="1.6" />
        <circle cx="10" cy="10" r="7" fill="none" stroke="var(--info)" strokeWidth="2" strokeDasharray={`${((p / 100) * 44).toFixed(1)} 44`} strokeLinecap="round" transform="rotate(-90 10 10)" />
      </svg>
    </span>
  );
  if (!sid) return ring;
  const shown = data?.categories.filter((c) => c.tokens > 0 || c.key === 'messages' || c.key === 'free') ?? [];
  return (
    <Popover open={open} onOpenChange={menu.onOpenChange}>
      <PopoverTrigger asChild><button aria-label="Context window usage">{ring}</button></PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-[23rem] p-0">
        {data === undefined ? <div className="p-4 text-sm text-muted-foreground">Measuring context…</div> : !data ? (
          <div className="p-4 text-sm text-muted-foreground">Context usage is available once the session has a model.</div>
        ) : (
          <div className="text-sm">
            <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2">
              <span className="text-muted-foreground">Context window</span>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {fmtTok(data.used)} / {fmtTok(data.contextWindow)} ({Math.round((data.used / data.contextWindow) * 100)}%)
              </span>
            </div>
            <div className="mx-4 flex h-1.5 gap-px overflow-hidden rounded-full bg-muted">
              {shown.filter((c) => c.key !== 'free' && c.tokens > 0).map((c) => (
                <span key={c.key} className="h-full" style={{ width: pctOf(c.tokens, data.contextWindow), background: CATEGORY_COLOR[c.key], minWidth: 2 }} />
              ))}
            </div>
            <div className="space-y-0.5 px-4 pt-2.5 pb-2">
              {shown.map((c) => (
                <div key={c.key} className="grid grid-cols-[1fr_auto_3.5rem] items-center gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: CATEGORY_COLOR[c.key], outline: c.key === 'free' ? '1px solid var(--border)' : undefined }} />
                    <span className="truncate">{c.label}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{fmtTok(c.tokens)}</span>
                  <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">{pctOf(c.tokens, data.contextWindow)}</span>
                </div>
              ))}
            </div>
            <div className="max-h-56 overflow-y-auto border-t px-2 py-1.5">
              {GROUPS.map((g) => {
                const items = data.items.filter((i) => i.group === g);
                if (!items.length) return null;
                const label = data.categories.find((c) => c.key === g)?.label ?? g;
                const total = items.reduce((n, i) => n + i.tokens, 0);
                const isOpen = expanded === g;
                return (
                  <div key={g}>
                    <button className="grid w-full grid-cols-[1fr_auto_3.5rem] items-center gap-3 rounded-md px-2 py-1 text-left hover:bg-accent" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : g)}>
                      <span className="flex items-center gap-1.5">
                        {isOpen ? <ChevronDownIcon className="size-3.5 text-muted-foreground" /> : <ChevronRightIcon className="size-3.5 text-muted-foreground" />}{label}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">{fmtTok(total)}</span>
                      <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">{items.length}</span>
                    </button>
                    {isOpen && items.map((i) => (
                      <div key={i.name} className="grid grid-cols-[1fr_auto_3.5rem] gap-3 py-0.5 pr-2 pl-7 text-xs text-muted-foreground" title={i.name}>
                        <span className="truncate">{g === 'memory' ? fname(i.name) : i.name.replace('__', ' · ')}</span>
                        <span className="font-mono tabular-nums">{fmtTok(i.tokens)}</span>
                        <span />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2 border-t px-4 py-2.5">
              <Button size="sm" variant="secondary" className="h-7 text-xs" disabled={busy} onClick={() => { menu.onOpenChange(false); void compactSession(sid).catch(fail); }}>
                Compact now
              </Button>
              <span className="text-xs text-muted-foreground">{data.estimated ? 'All figures are estimated' : 'Tools, skills and prompt are estimated'}</span>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
