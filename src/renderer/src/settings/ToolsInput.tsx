// Tag input for a subagent's tool allowlist: type a name or a pattern (`mcp__*`), or pick
// from the tools that are known. shadcn has no multi-select, so this is its combobox
// recipe (Popover anchored to the field) with chips inside the field.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, XIcon } from 'lucide-react';
import type { ToolOption } from '@shared/protocol';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';

const globToRegex = (glob: string) => new RegExp(`^${glob.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');

interface Row {
  name: string;
  description: string;
  /** Typed text that is not a known tool: added as typed (a pattern or a tool not loaded yet). */
  custom?: boolean;
}

export function ToolsInput({ value, onChange, placeholder }: { value: string[]; onChange: (tools: string[]) => void; placeholder?: string }) {
  const [options, setOptions] = useState<ToolOption[]>([]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Driven by real mouse events rather than CSS :hover, which can stay stuck on the first tag.
  const [hot, setHot] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void call('agents:tools').then(setOptions).catch(() => {});
  }, []);

  const rows = useMemo<Row[]>(() => {
    const q = text.trim();
    const match = q.includes('*')
      ? (o: ToolOption) => globToRegex(q).test(o.name)
      : (o: ToolOption) => !q || o.name.toLowerCase().includes(q.toLowerCase()) || o.description.toLowerCase().includes(q.toLowerCase());
    const list: Row[] = options.filter((o) => !value.includes(o.name) && match(o));
    if (q && !value.includes(q) && !options.some((o) => o.name === q)) list.push({ name: q, description: q.includes('*') ? '按模式匹配' : '手动添加', custom: true });
    return list;
  }, [options, text, value]);

  useEffect(() => setActive(0), [text]);

  const add = (name: string) => {
    const n = name.trim();
    if (n && !value.includes(n)) onChange([...value, n]);
    setText('');
    input.current?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (rows.length) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length);
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const pick = open && rows[active] ? rows[active].name : text;
      if (pick.trim()) add(pick);
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <Popover open={open && rows.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          onClick={() => input.current?.focus()}
          className="flex min-h-9 w-full cursor-text flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30"
        >
          {value.map((name) => (
            <span key={name} className="flex h-6 items-center gap-1 rounded-md border border-foreground/15 bg-secondary pr-1 pl-2 font-mono text-xs text-secondary-foreground shadow-xs">
              {name}
              <button type="button" aria-label={`移除 ${name}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((v) => v !== name)); }} onMouseEnter={() => setHot(name)}
                onMouseLeave={() => setHot(null)}
                onBlur={() => setHot(null)}
                className={cn('rounded-sm p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/60', hot === name ? 'bg-destructive/15 text-destructive' : 'text-muted-foreground')}>
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
          <input
            ref={input}
            value={text}
            onChange={(e) => { setText(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={value.length ? '' : placeholder}
            aria-label="工具白名单"
            spellCheck={false}
            className="min-w-24 flex-1 bg-transparent font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="max-h-60 w-(--radix-popover-trigger-width) overflow-y-auto p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // The field itself is inside the popover's anchor: clicking it must not count as "outside".
        onInteractOutside={(e) => { if ((e.target as HTMLElement).closest('[data-slot="popover-anchor"], input')) e.preventDefault(); }}
      >
        {rows.map((row, i) => (
          <button
            key={row.name}
            type="button"
            // Keep focus in the field so typing carries on after a pick.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => add(row.name)}
            onMouseEnter={() => setActive(i)}
            className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm', i === active && 'bg-accent text-accent-foreground')}
          >
            <span className="min-w-0 flex-1">
              <span className="font-mono">{row.custom ? `添加 “${row.name}”` : row.name}</span>
              {row.description && <span className="ml-2 text-xs text-muted-foreground">{row.description}</span>}
            </span>
            {value.includes(row.name) && <CheckIcon className="size-4" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
