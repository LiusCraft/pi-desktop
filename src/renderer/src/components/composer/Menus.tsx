import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ListChecksIcon,
  PencilLineIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  WandSparklesIcon,
  type LucideIcon,
} from 'lucide-react';
import {
  THINKING_LEVELS,
  type ContextBreakdown,
  type ModelInfo,
  type PermissionMode,
  type ThinkingLevel,
} from '@shared/protocol';
import { cacheHitRate } from '@shared/usage';
import { Button } from '@/components/ui/button';
import { ModelVendorIcon } from '@/components/common/ModelVendorIcon';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipHint, TooltipTrigger } from '@/components/ui/tooltip';
import { Tip } from '@/components/common/Tip';
import { call } from '@/lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { levelLabel, MODES } from '@/lib/constants';
import { useT } from '@/lib/i18n';
import { fmtCost, fmtTok, fname } from '@/lib/format';
import { fuzzyEntry, fuzzyRank } from '@/lib/fuzzy';
import { cn } from '@/lib/utils';
import { chooseEffort, chooseModel, compactSession, fail, setPermMode } from '@/store/actions';
import { setApp, useApp } from '@/store/app';

/** A dropdown that a slash command (/model, /permissions) can also open. */
function useMenu(name: 'model' | 'mode' | 'context') {
  const open = useApp((s) => s.menu === name);
  return { open, onOpenChange: (o: boolean) => setApp((s) => void (s.menu = o ? name : null)) };
}

const MODEL_LIST_HEIGHT = 460;
const MODEL_MENU_CHROME_HEIGHT = 80;
const MODEL_LIST_HEIGHT_STYLE = `min(${MODEL_LIST_HEIGHT}px, calc(var(--radix-popover-content-available-height) - ${MODEL_MENU_CHROME_HEIGHT}px))`;

export function FootButton({ children, className, title, ...props }: React.ComponentProps<'button'>) {
  const button = (
    <button
      {...props}
      className={cn(
        'flex h-8 max-w-56 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent',
        className,
      )}
    >
      {children}
    </button>
  );
  return <TooltipHint title={title}>{button}</TooltipHint>;
}

function Option({
  active,
  title,
  hint,
  icon: Icon,
  tone,
  onSelect,
}: {
  active: boolean;
  title: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className={cn('items-center gap-2 py-1.5', active && 'bg-accent/70 focus:bg-accent')}
    >
      {Icon ? (
        <span
          className={cn(
            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/50 text-muted-foreground',
            active && 'border-primary/20 bg-primary/10 text-primary',
            tone,
          )}
        >
          <Icon className="size-4" strokeWidth={1.8} />
        </span>
      ) : (
        <CheckIcon className={cn('mt-0.5 size-3.5 shrink-0 text-primary', !active && 'invisible')} />
      )}
      <span className="min-w-0">
        <span className="block truncate font-medium">{title}</span>
        {hint && <span className="block truncate text-[12px] leading-snug text-muted-foreground">{hint}</span>}
      </span>
      {Icon && <CheckIcon className={cn('ml-auto size-4 shrink-0 text-primary', !active && 'invisible')} />}
    </DropdownMenuItem>
  );
}

export function ModelMenu({
  model,
  trigger,
  align = 'end',
}: {
  model: string | null;
  trigger: ReactNode;
  align?: 'start' | 'end';
}) {
  const t = useT();
  const models = useApp((s) => s.models);
  const menu = useMenu('model');
  const [query, setQuery] = useState('');
  const entries = useMemo(() => models.map((m) => fuzzyEntry(m, `${m.provider} ${m.id} ${m.name ?? ''}`)), [models]);
  const filtered = useMemo(() => {
    const byProvider = new Map<string, ModelInfo[]>();
    for (const { item } of fuzzyRank(entries, query, entries.length)) {
      byProvider.set(item.provider, [...(byProvider.get(item.provider) ?? []), item]);
    }
    return [...byProvider];
  }, [entries, query]);
  const close = () => menu.onOpenChange(false);
  const selectModel = (id: string) => {
    close();
    void chooseModel(id);
  };
  const onOpenChange = (open: boolean) => {
    if (!open) setQuery('');
    menu.onOpenChange(open);
  };
  return (
    <Popover open={menu.open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} side="top" className="w-72 overflow-hidden p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('menu.searchModels')}
            aria-label={t('menu.searchModels')}
            className="text-[13px]"
          />
          <CommandList
            className="max-h-none"
            style={{ height: MODEL_LIST_HEIGHT_STYLE, maxHeight: MODEL_LIST_HEIGHT_STYLE }}
          >
            <CommandEmpty>{t('menu.noMatchingModels')}</CommandEmpty>
            {filtered.map(([provider, list]) => (
              <CommandGroup key={provider} heading={provider}>
                {list.map((m) => {
                  const id = `${m.provider}/${m.id}`;
                  return (
                    <CommandItem
                      key={id}
                      value={id}
                      onSelect={() => selectModel(id)}
                      className="items-start gap-2 py-1 text-[13px]"
                    >
                      <ModelVendorIcon model={m} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{m.name || m.id}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {[
                            m.contextWindow ? t('menu.contextWindowUsed', { size: fmtTok(m.contextWindow) }) : '',
                            m.reasoning ? t('menu.reasoning') : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      {id === model && <CheckIcon className="ml-auto size-3.5 shrink-0 self-center" />}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="border-t p-1">
            <button
              type="button"
              className="relative flex w-full cursor-default items-center rounded-sm px-2 py-1.5 text-[13px] outline-hidden select-none hover:bg-accent focus:bg-accent"
              onClick={() => {
                close();
                void call('settings:open', 'models');
              }}
            >
              {t('menu.manageModels')}
            </button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const EFFORT_TONE_CLASSES = [
  'text-slate-400',
  'text-sky-400',
  'text-violet-400',
  'text-fuchsia-400',
  'text-amber-300',
] as const;

const EFFORT_THUMB_COLORS = ['#94a3b8', '#60a5fa', '#a78bfa', '#e879f9', '#fbbf24'] as const;
const EFFORT_WIDE_LEVEL_COUNT = 6;

/** Keep the slider ordered by thinking strength while retaining only this model's supported levels. */
function orderedThinkingLevels(levels: ThinkingLevel[]) {
  return THINKING_LEVELS.filter((level) => levels.includes(level));
}

function closestThinkingLevelIndex(levels: ThinkingLevel[], effort: ThinkingLevel | null) {
  if (!levels.length || !effort) return 0;
  const target = THINKING_LEVELS.indexOf(effort);
  let closest = 0;
  let distance = Number.POSITIVE_INFINITY;
  levels.forEach((level, index) => {
    const nextDistance = Math.abs(THINKING_LEVELS.indexOf(level) - target);
    if (nextDistance < distance) {
      closest = index;
      distance = nextDistance;
    }
  });
  return closest;
}

function effortTone(index: number, lastIndex: number) {
  const stop = lastIndex ? Math.round((index / lastIndex) * (EFFORT_TONE_CLASSES.length - 1)) : 0;
  return EFFORT_TONE_CLASSES[Math.min(stop, EFFORT_TONE_CLASSES.length - 1)];
}

function effortThumbColor(index: number, lastIndex: number) {
  const stop = lastIndex ? Math.round((index / lastIndex) * (EFFORT_THUMB_COLORS.length - 1)) : 0;
  return EFFORT_THUMB_COLORS[Math.min(stop, EFFORT_THUMB_COLORS.length - 1)];
}

export function EffortMenu({ levels, effort }: { levels: ThinkingLevel[]; effort: ThinkingLevel | null }) {
  const t = useT();
  const availableLevels = useMemo(() => orderedThinkingLevels(levels), [levels]);
  const resolvedIndex = closestThinkingLevelIndex(availableLevels, effort);
  const [draftIndex, setDraftIndex] = useState(resolvedIndex);
  const draftRef = useRef(resolvedIndex);
  const interacting = useRef(false);
  const lastIndex = Math.max(availableLevels.length - 1, 0);

  useEffect(() => {
    if (interacting.current) return;
    draftRef.current = resolvedIndex;
    setDraftIndex(resolvedIndex);
  }, [availableLevels, resolvedIndex]);

  if (availableLevels.length < 2) return null;

  const activeLevel = availableLevels[draftIndex] ?? availableLevels[resolvedIndex];
  const progress = lastIndex ? (draftIndex / lastIndex) * 100 : 0;
  const tone = effortTone(draftIndex, lastIndex);
  const contentWidth = availableLevels.length >= EFFORT_WIDE_LEVEL_COUNT ? 'w-72' : 'w-56';
  const selectIndex = (index: number) => {
    const next = Math.max(0, Math.min(lastIndex, index));
    interacting.current = true;
    draftRef.current = next;
    setDraftIndex(next);
  };
  const commit = () => {
    const next = availableLevels[draftRef.current];
    if (!next) return;
    interacting.current = false;
    if (next !== effort) void chooseEffort(next);
  };
  const rangeStyle = {
    '--thinking-progress': `${progress}%`,
    '--thinking-thumb': effortThumbColor(draftIndex, lastIndex),
  } as CSSProperties;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <FootButton title={t('menu.thinkingEffort')} className={tone}>
          {activeLevel ? levelLabel(activeLevel) : t('menu.effort')}
        </FootButton>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className={`${contentWidth} p-3`}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{t('menu.thinkingEffort')}</span>
          <span className={cn('text-sm font-medium', tone)}>{activeLevel && levelLabel(activeLevel)}</span>
        </div>
        <div className="thinking-range-shell mt-2">
          <div className="thinking-range-track" style={rangeStyle} aria-hidden="true" />
          <input
            type="range"
            min={0}
            max={lastIndex}
            step={1}
            value={draftIndex}
            aria-label={t('menu.thinkingEffort')}
            aria-valuetext={activeLevel ? levelLabel(activeLevel) : undefined}
            className="thinking-range relative z-10 block w-full"
            onChange={(event) => selectIndex(event.currentTarget.valueAsNumber)}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
            style={rangeStyle}
          />
        </div>
        <div
          className="mt-0.5 grid gap-0.5"
          style={{ gridTemplateColumns: `repeat(${availableLevels.length}, minmax(0, 1fr))` }}
        >
          {availableLevels.map((level, index) => (
            <span
              key={level}
              className={cn(
                'min-w-0 truncate text-center text-[10px] leading-tight transition-colors',
                index === draftIndex ? effortTone(index, lastIndex) : 'text-muted-foreground',
              )}
              title={levelLabel(level)}
            >
              {levelLabel(level)}
            </span>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const MODE_TONE: Partial<Record<PermissionMode, string>> = {
  plan: 'text-info',
  acceptEdits: 'text-primary',
  bypass: 'text-warning',
};
const MODE_ICON: Record<PermissionMode, LucideIcon> = {
  auto: WandSparklesIcon,
  default: ShieldCheckIcon,
  acceptEdits: PencilLineIcon,
  plan: ListChecksIcon,
  bypass: TriangleAlertIcon,
};

export function ModeMenu({ mode }: { mode: PermissionMode }) {
  const t = useT();
  const menu = useMenu('mode');
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  return (
    <DropdownMenu {...menu}>
      <DropdownMenuTrigger asChild>
        <FootButton title={`${t('menu.mode')}  Shift+Tab`} className={MODE_TONE[mode]}>
          {current.name}
        </FootButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-[22rem]">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t('menu.modeLabel')}</DropdownMenuLabel>
        {MODES.map((m) => (
          <Option
            key={m.id}
            active={m.id === mode}
            title={m.name}
            hint={m.desc}
            icon={MODE_ICON[m.id]}
            tone={MODE_TONE[m.id]}
            onSelect={() => setPermMode(m.id)}
          />
        ))}
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
export function ContextRing({
  pct,
  cacheRate,
  cost,
  busy,
  sid,
}: {
  pct: number | null;
  cacheRate?: number | null;
  cost?: number | null;
  busy?: boolean;
  sid?: string;
}) {
  const t = useT();
  const p = Math.max(0, Math.min(100, pct ?? 0));
  const cachePct = cacheRate == null ? null : Math.round(cacheRate * 100);
  const spent = cost != null && cost > 0 ? fmtCost(cost) : null;
  const menu = useMenu('context');
  const open = !!sid && menu.open;
  const [data, setData] = useState<ContextBreakdown | null | undefined>(undefined);
  const [expanded, setExpanded] = useState<Group | null>(null);
  const cache = data ? cacheHitRate(data.cache) : null;
  useEffect(() => {
    if (!open || !sid) return;
    let live = true;
    call('sessions:context', sid).then(
      (d) => live && setData(d),
      () => live && setData(null),
    );
    return () => void (live = false);
  }, [open, sid, pct, busy]);
  const ringTitle = [
    pct == null ? t('menu.context') : t('menu.contextUsed', { pct: Math.round(p) }),
    cachePct == null ? '' : t('menu.cacheRatePct', { pct: cachePct }),
    spent == null ? '' : t('menu.spendLine', { cost: spent }),
  ]
    .filter(Boolean)
    .join('\n');
  const ring = (
    <span
      className={cn(
        'flex size-7 items-center justify-center rounded-md text-muted-foreground',
        sid && 'hover:bg-accent',
        busy && 'animate-pulse',
      )}
    >
      <svg viewBox="0 0 20 20" className="size-[17px]">
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="1.6" />
        <circle
          cx="10"
          cy="10"
          r="7"
          fill="none"
          stroke="var(--info)"
          strokeWidth="2"
          strokeDasharray={`${((p / 100) * 44).toFixed(1)} 44`}
          strokeLinecap="round"
          transform="rotate(-90 10 10)"
        />
      </svg>
    </span>
  );
  if (!sid)
    return (
      <Tooltip>
        <TooltipTrigger asChild>{ring}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[320px] whitespace-pre-line">
          {ringTitle}
        </TooltipContent>
      </Tooltip>
    );
  const shown = data?.categories.filter((c) => c.tokens > 0 || c.key === 'messages' || c.key === 'free') ?? [];
  return (
    <Popover open={open} onOpenChange={menu.onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button aria-label={t('menu.contextUsage')}>{ring}</button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="end" className="max-w-[320px] whitespace-pre-line">
          {ringTitle}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="end" className="w-[23rem] p-0">
        {data === undefined ? (
          <div className="p-4 text-sm text-muted-foreground">{t('menu.measuring')}</div>
        ) : !data ? (
          <div className="p-4 text-sm text-muted-foreground">{t('menu.contextNeedsModel')}</div>
        ) : (
          <div className="text-sm">
            <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2">
              <span className="text-muted-foreground">{t('menu.contextWindow')}</span>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {fmtTok(data.used)} / {fmtTok(data.contextWindow)} ({Math.round((data.used / data.contextWindow) * 100)}
                %)
              </span>
            </div>
            {cache != null && (
              <div className="flex items-center justify-between px-4 pb-2 text-muted-foreground">
                <span className="flex items-center gap-1">
                  {t('menu.cacheRate')}
                  <Tip>
                    {t('menu.cacheRateTip', {
                      cached: fmtTok(data.cache.cacheRead),
                      total: fmtTok(data.cache.input + data.cache.cacheRead + data.cache.cacheWrite),
                    })}
                  </Tip>
                </span>
                <span className="font-mono text-xs tabular-nums">{(cache * 100).toFixed(1)}%</span>
              </div>
            )}
            <div className="flex items-center justify-between px-4 pb-2 text-muted-foreground">
              <span className="flex items-center gap-1">
                {t('menu.spend')}
                <Tip>{t('menu.spendTip')}</Tip>
              </span>
              <span className="font-mono text-xs tabular-nums">{fmtCost(data.cost)}</span>
            </div>
            <div className="mx-4 flex h-1.5 gap-px overflow-hidden rounded-full bg-muted">
              {shown
                .filter((c) => c.key !== 'free' && c.tokens > 0)
                .map((c) => (
                  <span
                    key={c.key}
                    className="h-full"
                    style={{
                      width: pctOf(c.tokens, data.contextWindow),
                      background: CATEGORY_COLOR[c.key],
                      minWidth: 2,
                    }}
                  />
                ))}
            </div>
            <div className="space-y-0.5 px-4 pt-2.5 pb-2">
              {shown.map((c) => (
                <div key={c.key} className="grid grid-cols-[1fr_auto_3.5rem] items-center gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-[3px]"
                      style={{
                        background: CATEGORY_COLOR[c.key],
                        outline: c.key === 'free' ? '1px solid var(--border)' : undefined,
                      }}
                    />
                    <span className="truncate">{c.label}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{fmtTok(c.tokens)}</span>
                  <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                    {pctOf(c.tokens, data.contextWindow)}
                  </span>
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
                    <button
                      className="grid w-full grid-cols-[1fr_auto_3.5rem] items-center gap-3 rounded-md px-2 py-1 text-left hover:bg-accent"
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : g)}
                    >
                      <span className="flex items-center gap-1.5">
                        {isOpen ? (
                          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                        )}
                        {label}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">{fmtTok(total)}</span>
                      <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                        {items.length}
                      </span>
                    </button>
                    {isOpen &&
                      items.map((i) => (
                        <div
                          key={i.name}
                          className="grid grid-cols-[1fr_auto_3.5rem] gap-3 py-0.5 pr-2 pl-7 text-xs text-muted-foreground"
                          title={i.name}
                        >
                          <span className="truncate">
                            {g === 'memory' ? fname(i.name) : i.name.replace('__', ' · ')}
                          </span>
                          <span className="font-mono tabular-nums">{fmtTok(i.tokens)}</span>
                          <span />
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2 border-t px-4 py-2.5">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                disabled={busy}
                onClick={() => {
                  menu.onOpenChange(false);
                  void compactSession(sid).catch(fail);
                }}
              >
                {t('menu.compactNow')}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t(data.estimated ? 'menu.allEstimated' : 'menu.partlyEstimated')}
              </span>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
