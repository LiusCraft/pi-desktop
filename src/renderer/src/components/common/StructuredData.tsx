// JSON a tool returned, laid out as data instead of raw text: key/value rows for objects, a table
// when every item of an array has the same shallow shape, chips for a list of scalars.
import type { ReactNode } from 'react';
import { ExternalLinkIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';

/** How deep values are laid out; anything deeper (rare in tool results) stays one line of JSON. */
const MAX_DEPTH = 2;
/** Widest row still worth table columns; wider objects fall back to key/value rows. */
const MAX_COLUMNS = 6;
/** Longest list of scalars drawn as chips; the rest is counted. */
const MAX_CHIPS = 48;
/** Longest compact fallback line, with the full JSON in its title. */
const MAX_COMPACT = 160;
/** Fields of a nested object drawn as compact lines before it falls back to one line of JSON. */
const MAX_INLINE_FIELDS = 4;
/** How many levels of such lines are drawn, so a pathologically deep object cannot nest forever. */
const MAX_INLINE_DEPTH = 3;

const isRow = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Table columns for an array whose items are all objects, or null when it is not tabular. */
function columnsOf(items: unknown[]): string[] | null {
  if (!items.length || !items.every(isRow)) return null;
  const columns: string[] = [];
  for (const item of items) for (const key of Object.keys(item)) if (!columns.includes(key)) columns.push(key);
  return columns.length > 0 && columns.length <= MAX_COLUMNS ? columns : null;
}

/** The URL check keeps a link clickable; everything else is text. */
const isUrl = (text: string) => /^https?:\/\//i.test(text);

function Scalar({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground/60">—</span>;
  if (typeof value === 'boolean') {
    return <Badge variant="outline" className={cn('h-5 rounded-md px-1.5 font-mono text-[11px]', value ? 'text-success' : 'text-muted-foreground')}>{String(value)}</Badge>;
  }
  if (typeof value === 'number') return <span className="font-mono text-xs tabular-nums">{value}</span>;
  const text = String(value);
  if (!text) return <span className="text-muted-foreground/60">—</span>;
  if (!isUrl(text)) return <span className="break-words">{text}</span>;
  return (
    <button type="button" className="flex max-w-full items-center gap-1 text-left text-primary hover:underline" title={text} onClick={() => void call('app:openExternal', text).catch(() => {})}>
      <span className="truncate">{text}</span>
      <ExternalLinkIcon className="size-3 shrink-0" />
    </button>
  );
}

/** Values too deep or too wide to lay out: one truncated line, the full JSON in its title. */
function Compact({ value }: { value: unknown }) {
  const json = JSON.stringify(value) ?? String(value);
  return (
    <span className="block max-w-full truncate font-mono text-xs text-muted-foreground" title={json}>
      {json.length > MAX_COMPACT ? `${json.slice(0, MAX_COMPACT)}…` : json}
    </span>
  );
}

/** `cell`: inside a table cell, where a nested table would not fit. */
function view(value: unknown, depth: number, cell: boolean): ReactNode {
  if (value === null || typeof value !== 'object') return <Scalar value={value} />;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="font-mono text-xs text-muted-foreground/60">[]</span>;
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return (
        <div className="flex flex-wrap gap-1">
          {value.slice(0, MAX_CHIPS).map((item, i) => (
            <Badge key={i} variant="secondary" className="max-w-full truncate px-1.5 py-0 font-mono text-[11px] font-normal">
              {String(item)}
            </Badge>
          ))}
          {value.length > MAX_CHIPS && <span className="text-xs text-muted-foreground">+{value.length - MAX_CHIPS}</span>}
        </div>
      );
    }
    const columns = cell ? null : columnsOf(value);
    if (columns) return <Rows items={value} columns={columns} depth={depth} />;
    if (cell) return <Compact value={value} />;
    return (
      <ol className="space-y-1">
        {value.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-[11px] text-muted-foreground/70">{i + 1}</span>
            <div className="min-w-0 flex-1">{view(item, depth + 1, cell)}</div>
          </li>
        ))}
      </ol>
    );
  }
  const entries = Object.entries(value);
  if (!entries.length) return <span className="font-mono text-xs text-muted-foreground/60">{'{}'}</span>;
  if (!cell && depth < MAX_DEPTH) return <Fields entries={entries} depth={depth} />;
  // Where a table would not fit, a shallow object still reads as small key/value lines.
  const shallow = entries.length <= MAX_INLINE_FIELDS && depth < MAX_DEPTH + MAX_INLINE_DEPTH;
  return shallow ? <InlineFields entries={entries} depth={depth} /> : <Compact value={value} />;
}

/** A nested object where a table would not fit: one small key/value line per field. */
function InlineFields({ entries, depth }: { entries: [string, unknown][]; depth: number }) {
  return (
    <div className="space-y-0.5">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-1.5 text-[11px] leading-tight">
          <span className="shrink-0 font-mono text-muted-foreground/80">{key}</span>
          <span className="min-w-0 break-words">{view(value, depth + 1, true)}</span>
        </div>
      ))}
    </div>
  );
}

/** An object's keys down the left, its values down the right. */
function Fields({ entries, depth }: { entries: [string, unknown][]; depth: number }) {
  return (
    <Table className="text-xs">
      <TableBody>
        {entries.map(([key, value]) => (
          <TableRow key={key} className="hover:bg-transparent">
            <TableCell className="max-w-56 truncate py-1 align-top font-mono text-[11px] text-muted-foreground" title={key}>{key}</TableCell>
            <TableCell className="py-1 align-top break-words whitespace-normal">{view(value, depth + 1, false)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** An array of objects as a table: one column per key, one row per item. */
function Rows({ items, columns, depth }: { items: Record<string, unknown>[]; columns: string[]; depth: number }) {
  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead key={column} className="h-7 px-2 font-mono text-[11px] font-medium text-muted-foreground">{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item, i) => (
          <TableRow key={i} className="hover:bg-transparent">
            {columns.map((column) => (
              <TableCell key={column} className="px-2 py-1 align-top break-words whitespace-normal">{view(item[column], depth + 1, true)}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** One JSON object or array from a tool result, laid out as data. */
export function StructuredValue({ value }: { value: object }) {
  return <>{view(value, 0, false)}</>;
}
