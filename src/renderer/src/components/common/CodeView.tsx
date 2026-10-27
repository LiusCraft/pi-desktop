// Line-numbered code and diffs (tool previews, the file viewer, the Diff panel).
import { Fragment, memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { ChevronDownIcon, ChevronsUpDownIcon, ChevronUpIcon, ImageOffIcon } from 'lucide-react';
import { lineDiff, PREVIEW_LINES, type DiffRow, type PreviewRow, type ToolPreview } from '@shared/tool-previews';
import { call } from '@/lib/api';
import { highlight, langOfPath } from '@/lib/highlight';
import { fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PrThread } from '@shared/protocol';
import { CodeSelection } from './CodeSelection';
import { PrThreadCard } from './PrThreadCard';

function lineHtml(r: DiffRow, lang: string) {
  if (!r.wd) return highlight(r.s, lang) || ' ';
  const [x, y] = r.wd;
  return `${highlight(r.s.slice(0, x), lang)}<span class="wd">${highlight(r.s.slice(x, y), lang)}</span>${highlight(r.s.slice(y), lang)}`;
}

/** Only text and span nodes from the highlighter become React children. */
function highlightedNodes(html: string): ReactNode[] {
  const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] });
  const render = (node: ChildNode, index: number): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof HTMLElement)) return null;
    return <span key={index} className={node.getAttribute('class') ?? undefined}>{[...node.childNodes].map(render)}</span>;
  };
  return [...fragment.childNodes].map(render);
}

/** The gutter's plus button selects a line for a comment. */
function LineNumber({ number, selectable }: { number?: number; selectable?: boolean }) {
  return selectable ? <button type="button" data-select-line title="点击添加行评论，Shift 点击选择多行" aria-label={`评论第 ${number} 行`} className="group/line relative w-full cursor-pointer hover:text-info">
    <span className="group-hover/line:opacity-0">{number}</span>
    <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/line:opacity-100">+</span>
  </button> : <>{number}</>;
}

export const DiffLine = memo(function DiffLine({ row, lang, selectable }: { row: DiffRow; lang: string; selectable?: boolean }) {
  return (
    <div data-source-line={row.t === '-' ? row.o : row.n} data-side={row.t === '-' ? 'old' : 'new'} className={cn('code-row diff', row.t === '+' && 'add', row.t === '-' && 'del')}>
      <span className="ln"><LineNumber number={row.t === '-' ? row.o : row.n} selectable={selectable} /></span>
      <span className="sign">{row.t === ' ' ? '' : row.t === '-' ? '−' : '+'}</span>
      <span data-code-text>{highlightedNodes(lineHtml(row, lang))}</span>
    </div>
  );
});

/** A folded stretch of unchanged lines between hunks. */
export function HunkGap({ count, edge, onClick }: { count?: number; edge?: 'top' | 'bottom'; onClick?: () => void }) {
  const Icon = edge === 'top' ? ChevronUpIcon : edge === 'bottom' ? ChevronDownIcon : ChevronsUpDownIcon;
  const label = count ? `${count} unmodified line${count > 1 ? 's' : ''}` : 'Unchanged lines';
  return onClick ? (
    <button onClick={onClick} className="hunk-gap w-full hover:text-foreground" title="Show unmodified lines">
      <span className="flex justify-center"><Icon className="size-3.5" /></span>
      <span>{label}</span>
    </button>
  ) : (
    <div className="hunk-gap"><span className="flex justify-center"><ChevronsUpDownIcon className="size-3.5 opacity-50" /></span><span>{label}</span></div>
  );
}

export function CodeLines({ lines, path, sid, startLine = 1, target, limit = PREVIEW_LINES, className }: {
  lines: string[];
  path: string;
  sid?: string;
  startLine?: number;
  target?: number | null;
  limit?: number;
  className?: string;
}) {
  const lang = langOfPath(path);
  return (
    <CodeSelection key={`${sid}:${path}:${startLine}`} sid={sid} path={path} className={cn('code-lines overflow-x-auto', className)}>
      {lines.slice(0, limit).map((l, i) => {
        const n = startLine + i;
        return (
          <div key={n} data-line={n} data-source-line={n} data-side="new" className={cn('code-row', target === n && 'target')} style={{ gridTemplateColumns: '3.4em minmax(0,1fr)' }}>
            <span className="ln"><LineNumber number={n} selectable={!!sid} /></span>
            <span data-code-text>{highlightedNodes(highlight(l, lang) || ' ')}</span>
          </div>
        );
      })}
    </CodeSelection>
  );
}

/** Rows of a diff with unchanged stretches folded into expandable gaps. */
export function DiffRows({ before, after, path, sid, openGaps, onOpenGap, context = 3, wrap, threads }: {
  before: string | null;
  after: string | null;
  path: string;
  sid?: string;
  openGaps?: Set<string> | string[];
  onOpenGap?: (id: string) => void;
  context?: number;
  /** Wrap long lines instead of scrolling sideways (the Diff panel). */
  wrap?: boolean;
  /** PR review threads of this file: drawn under their line, which stays unfolded. */
  threads?: PrThread[];
}) {
  const rows = useMemo(() => lineDiff(before, after), [before, after]);
  const lang = langOfPath(path);
  const open = new Set(openGaps ?? []);
  const keep = rows.map(() => false);
  // A thread belongs to the row on its side with its line number; one whose line moved on is listed after the code.
  const placed = new Map<number, PrThread[]>();
  const lost: PrThread[] = [];
  for (const t of threads ?? []) {
    const k = rows.findIndex((r) => (t.side === 'old' ? r.t === '-' && r.o === t.line : r.t !== '-' && r.n === t.line));
    if (k < 0) lost.push(t);
    else placed.set(k, [...(placed.get(k) ?? []), t]);
  }
  const line = (k: number) => {
    const here = placed.get(k);
    const row = <DiffLine key={k} row={rows[k]} lang={lang} selectable={!!sid} />;
    // Same entry as its row, so a line selection never counts the card as a code line.
    return here ? <Fragment key={k}>{row}{here.map((t) => <PrThreadCard key={t.id} thread={t} />)}</Fragment> : row;
  };
  rows.forEach((r, k) => {
    if (r.t !== ' ' || placed.has(k)) for (let x = Math.max(0, k - context); x <= Math.min(rows.length - 1, k + context); x++) keep[x] = true;
  });
  const out: React.ReactNode[] = [];
  for (let k = 0; k < rows.length;) {
    if (keep[k]) {
      out.push(line(k));
      k++;
      continue;
    }
    let e = k;
    while (e < rows.length && !keep[e]) e++;
    const id = `${path}:${k}`;
    if (open.has(id)) for (let x = k; x < e; x++) out.push(line(x));
    else out.push(<HunkGap key={id} count={e - k} edge={k === 0 ? 'top' : e === rows.length ? 'bottom' : undefined} onClick={() => onOpenGap?.(id)} />);
    k = e;
  }
  const code = <CodeSelection key={`${sid}:${path}`} sid={sid} path={path} className={cn('code-lines', wrap ? 'wrap' : 'overflow-x-auto')}>{out}</CodeSelection>;
  return lost.length ? <>{code}{lost.map((t) => <PrThreadCard key={t.id} thread={t} />)}</> : code;
}

const Note = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('px-3 py-1.5 text-xs text-muted-foreground', className)}>{children}</div>
);

/** A read / edit / write result as recorded at the time (never the file's current contents). */
export function ToolPreviewView({ preview, path, sid, onOpenImage }: { preview: ToolPreview; path: string; sid?: string; onOpenImage?: (src: string) => void }) {
  if (preview.type === 'error' || preview.type === 'notice') {
    return <pre className={cn('max-h-80 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs', preview.type === 'error' && 'text-destructive')}>{preview.text || 'No preview available'}</pre>;
  }
  if (preview.type === 'image') {
    return (
      <div className="space-y-2 p-3">
        {preview.images.length ? preview.images.map((image, i) => (
          <ImageThumb key={i} src={image.src} path={path} onOpen={onOpenImage} />
        )) : <DiskImage sid={sid} path={path} onOpen={onOpenImage} />}
        <Note className="px-0">{preview.text.split('\n')[0] || 'Image'}</Note>
      </div>
    );
  }
  if (preview.type === 'diff') {
    const rows = preview.rows.slice(0, PREVIEW_LINES);
    const lang = langOfPath(path);
    return (
      <>
        <div className="code-lines overflow-x-auto">
          {rows.map((r: PreviewRow, i) => ('gap' in r ? <HunkGap key={i} /> : <DiffLine key={i} row={r} lang={lang} />))}
        </div>
        {preview.rows.length > rows.length && <Note>Preview limited to {PREVIEW_LINES} rows. Open the file to see current content.</Note>}
      </>
    );
  }
  const p = preview as Extract<ToolPreview, { type: 'code' | 'snapshot' }>;
  const count = p.type === 'snapshot' && p.empty ? 0 : p.lines.length;
  const shown = Math.min(count, PREVIEW_LINES);
  const range = count ? `Lines ${p.startLine}–${p.startLine + shown - 1}${p.type === 'code' && p.totalLines ? ` of ${p.totalLines}` : ''}` : 'Empty file';
  return (
    <>
      <Note>{p.type === 'snapshot' ? `${p.note} · ${range}` : range}</Note>
      {count > 0 && <CodeLines lines={p.lines} path={path} startLine={p.startLine} />}
      {count > shown && <Note>{count - shown} more lines in this result. Open the file to see current content.</Note>}
      {p.type === 'code' && p.footer && <Note className="italic">{p.footer}</Note>}
    </>
  );
}

function ImageThumb({ src, path, onOpen }: { src: string; path: string; onOpen?: (src: string) => void }) {
  const img = <img src={src} alt={fname(path)} title={path} className="max-h-72 max-w-full rounded-md border bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px]" loading="lazy" />;
  return onOpen ? <button className="block cursor-zoom-in" title={`Open ${fname(path)}`} onClick={() => onOpen(src)}>{img}</button> : img;
}

/** The tool result had no image data (e.g. the model can't take images): show the file from disk instead. */
function DiskImage({ sid, path, onOpen }: { sid?: string; path: string; onOpen?: (src: string) => void }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!sid || !path) return void setSrc(null);
    call('sessions:readImage', sid, path).then((r) => live && setSrc(r?.src ?? null), () => live && setSrc(null));
    return () => void (live = false);
  }, [sid, path]);
  if (src === undefined) return <div className="h-24 w-36 animate-pulse rounded-md bg-muted" />;
  if (!src) return <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><ImageOffIcon className="size-3.5" />Image not available (outside the session folder, moved, or not a supported image)</div>;
  return <ImageThumb src={src} path={path} onOpen={onOpen} />;
}

/** Terminal output with success/failure lines tinted. */
export function TermOutput({ cmd, out }: { cmd?: string; out: string }) {
  const tone = (l: string) =>
    /✓|✔|passed|built in|\[new branch\]/.test(l) && !/failed|✖/.test(l) ? 'ok'
      : /✗|✖|FAIL|failed|Error|exited with code [1-9]/.test(l) ? 'err'
        : /^>|RUN|Duration|^ℹ/.test(l) ? 'dim' : '';
  return (
    <pre className="term-out max-h-80 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs leading-relaxed">
      {cmd && <span className="cmd">{cmd}{'\n'}</span>}
      {out.split('\n').map((l, i) => (
        <span key={i} className={tone(l)}>{l}{'\n'}</span>
      ))}
    </pre>
  );
}
