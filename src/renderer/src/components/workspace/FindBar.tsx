// The find row under a card's header (in the open file, in the diff, or across the project) and the
// list of project-wide hits.
import type { RefObject } from 'react';
import { ArrowDownIcon, ArrowUpIcon, XIcon } from 'lucide-react';
import type { SearchResult } from '@shared/text-search';
import { Input } from '@/components/ui/input';
import { fdir, fname } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type FindScope = 'file' | 'all';

const SCOPE_LABEL = { file: 'find.scope.file', all: 'find.scope.all' } as const satisfies Record<FindScope, string>;

export function FindBar({
  value,
  onValue,
  caseSensitive,
  onCaseSensitive,
  status,
  onStep,
  onClose,
  scope,
  onScope,
  placeholder,
  inputRef,
}: {
  value: string;
  onValue: (value: string) => void;
  caseSensitive: boolean;
  onCaseSensitive: (on: boolean) => void;
  /** "3/12", "42 hits"… */
  status: string;
  /** Jump to the next (1) or previous (-1) hit. */
  onStep?: (direction: 1 | -1) => void;
  onClose: () => void;
  /** Where to look, when the card offers a choice. */
  scope?: FindScope;
  onScope?: (scope: FindScope) => void;
  placeholder: string;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const t = useT();
  const small =
    'flex h-7 shrink-0 items-center justify-center rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40';
  return (
    <div role="search" className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => onValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            onStep?.(event.shiftKey ? -1 : 1);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck={false}
        className="h-7 min-w-0 flex-1 text-xs"
      />
      <button
        className={cn(small, 'font-mono', caseSensitive && 'bg-info/15 text-info hover:bg-info/20 hover:text-info')}
        aria-pressed={caseSensitive}
        title={t('find.caseSensitive')}
        onClick={() => onCaseSensitive(!caseSensitive)}
      >
        Aa
      </button>
      {scope &&
        onScope &&
        (['file', 'all'] as const).map((s) => (
          <button
            key={s}
            className={cn(small, scope === s && 'bg-info/15 text-info hover:bg-info/20 hover:text-info')}
            aria-pressed={scope === s}
            onClick={() => onScope(s)}
          >
            {t(SCOPE_LABEL[s])}
          </button>
        ))}
      <span className="min-w-12 shrink-0 text-center text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {status}
      </span>
      {onStep && (
        <>
          <button className={small} title={t('find.prev')} aria-label={t('find.prevLabel')} onClick={() => onStep(-1)}>
            <ArrowUpIcon className="size-3.5" />
          </button>
          <button className={small} title={t('find.next')} aria-label={t('find.nextLabel')} onClick={() => onStep(1)}>
            <ArrowDownIcon className="size-3.5" />
          </button>
        </>
      )}
      <button className={small} title={t('find.close')} aria-label={t('find.closeLabel')} onClick={onClose}>
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

/** Project-wide hits grouped by file; a click opens the file at that line. */
export function SearchResults({
  result,
  busy,
  onOpen,
}: {
  result: SearchResult | null;
  busy: boolean;
  onOpen: (path: string, line: number) => void;
}) {
  const t = useT();
  if (!result)
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        {t(busy ? 'find.searching' : 'find.typeToSearch')}
      </div>
    );
  if (!result.matches.length)
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        {t(busy ? 'find.searching' : 'find.noMatches')}
      </div>
    );
  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto py-1', busy && 'opacity-60')} aria-label={t('find.results')}>
      {result.matches.map((m, i) => (
        <div key={`${m.path}:${m.line}`}>
          {m.path !== result.matches[i - 1]?.path && (
            <div className="truncate px-2 pt-2 pb-0.5 text-xs font-medium" title={m.path}>
              {fname(m.path)} <span className="font-normal text-muted-foreground">{fdir(m.path)}</span>
            </div>
          )}
          <button
            className="flex w-full items-baseline gap-2 px-2 py-0.5 text-left text-xs hover:bg-accent"
            title={`${m.path}:${m.line}`}
            onClick={() => onOpen(m.path, m.line)}
          >
            <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">{m.line}</span>
            <span className="min-w-0 truncate font-mono">
              {m.text.slice(0, m.start)}
              <mark className="rounded-sm bg-warning/30 text-foreground">{m.text.slice(m.start, m.end)}</mark>
              {m.text.slice(m.end)}
            </span>
          </button>
        </div>
      ))}
      {result.truncated && (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          {t('find.truncated', { n: result.matches.length })}
        </div>
      )}
    </div>
  );
}
