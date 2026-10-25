// Line-numbered code and diffs (tool previews, the file viewer, the Diff panel).
import { memo, useMemo } from 'react';
import { ChevronsUpDownIcon, ChevronUpIcon } from 'lucide-react';
import { lineDiff, PREVIEW_LINES, type DiffRow, type PreviewRow, type ToolPreview } from '@shared/tool-previews';
import { highlight, langOfPath } from '@/lib/highlight';
import { fname } from '@/lib/format';
import { cn } from '@/lib/utils';

function lineHtml(r: DiffRow, lang: string) {
  if (!r.wd) return highlight(r.s, lang) || ' ';
  const [x, y] = r.wd;
  return `${highlight(r.s.slice(0, x), lang)}<span class="wd">${highlight(r.s.slice(x, y), lang)}</span>${highlight(r.s.slice(y), lang)}`;
}

export const DiffLine = memo(function DiffLine({ row, lang }: { row: DiffRow; lang: string }) {
  return (
    <div className={cn('code-row', row.t === '+' && 'add', row.t === '-' && 'del')}>
      <span className="ln">{row.t === '-' ? row.o : row.n}</span>
      <span className="sign">{row.t === ' ' ? '' : row.t}</span>
      <span dangerouslySetInnerHTML={{ __html: lineHtml(row, lang) }} />
    </div>
  );
});

export function CodeLines({ lines, path, startLine = 1, target, limit = PREVIEW_LINES, className }: {
  lines: string[];
  path: string;
  startLine?: number;
  target?: number | null;
  limit?: number;
  className?: string;
}) {
  const lang = langOfPath(path);
  return (
    <div className={cn('code-lines overflow-x-auto', className)}>
      {lines.slice(0, limit).map((l, i) => {
        const n = startLine + i;
        return (
          <div key={n} data-line={n} className={cn('code-row', target === n && 'target')} style={{ gridTemplateColumns: '3.4em minmax(0,1fr)' }}>
            <span className="ln">{n}</span>
            <span dangerouslySetInnerHTML={{ __html: highlight(l, lang) || ' ' }} />
          </div>
        );
      })}
    </div>
  );
}

/** Rows of a diff with unchanged stretches folded into expandable gaps. */
export function DiffRows({ before, after, path, openGaps, onOpenGap, context = 3 }: {
  before: string | null;
  after: string | null;
  path: string;
  openGaps?: Set<string> | string[];
  onOpenGap?: (id: string) => void;
  context?: number;
}) {
  const rows = useMemo(() => lineDiff(before, after), [before, after]);
  const lang = langOfPath(path);
  const open = new Set(openGaps ?? []);
  const keep = rows.map(() => false);
  rows.forEach((r, k) => {
    if (r.t !== ' ') for (let x = Math.max(0, k - context); x <= Math.min(rows.length - 1, k + context); x++) keep[x] = true;
  });
  const out: React.ReactNode[] = [];
  for (let k = 0; k < rows.length;) {
    if (keep[k]) {
      out.push(<DiffLine key={k} row={rows[k]} lang={lang} />);
      k++;
      continue;
    }
    let e = k;
    while (e < rows.length && !keep[e]) e++;
    const id = `${path}:${k}`;
    if (open.has(id)) for (let x = k; x < e; x++) out.push(<DiffLine key={x} row={rows[x]} lang={lang} />);
    else {
      const edge = k === 0 || e === rows.length;
      out.push(
        <button key={id} onClick={() => onOpenGap?.(id)} className="flex w-full items-center gap-1.5 bg-muted/60 px-3 py-0.5 text-left font-sans text-xs text-muted-foreground hover:bg-muted">
          {edge ? <ChevronUpIcon className="size-3" /> : <ChevronsUpDownIcon className="size-3" />}
          {e - k} unmodified lines
        </button>,
      );
    }
    k = e;
  }
  return <div className="code-lines overflow-x-auto">{out}</div>;
}

const Note = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('px-3 py-1.5 text-xs text-muted-foreground', className)}>{children}</div>
);

/** A read / edit / write result as recorded at the time (never the file's current contents). */
export function ToolPreviewView({ preview, path }: { preview: ToolPreview; path: string }) {
  if (preview.type === 'error' || preview.type === 'notice') {
    return <pre className={cn('max-h-80 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs', preview.type === 'error' && 'text-destructive')}>{preview.text || 'No preview available'}</pre>;
  }
  if (preview.type === 'image') {
    return (
      <div className="space-y-2 p-3">
        {preview.images.map((image, i) => <img key={i} src={image.src} alt={fname(path)} title={path} className="max-h-72 rounded border" loading="lazy" />)}
        <Note className="px-0">{preview.text || 'Image preview unavailable'}</Note>
      </div>
    );
  }
  if (preview.type === 'diff') {
    const rows = preview.rows.slice(0, PREVIEW_LINES);
    const lang = langOfPath(path);
    return (
      <>
        <div className="code-lines overflow-x-auto">
          {rows.map((r: PreviewRow, i) => ('gap' in r ? <Note key={i} className="bg-muted/50 py-0.5">… unchanged lines …</Note> : <DiffLine key={i} row={r} lang={lang} />))}
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
