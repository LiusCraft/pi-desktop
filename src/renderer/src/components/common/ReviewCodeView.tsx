// Changed files (diffs) and single files in one virtualized @pierre/diffs CodeView, with PR review
// threads and the "attach / comment on these lines" composer drawn as line annotations.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  CodeView, WorkerPoolContextProvider,
  type CodeViewHandle, type CodeViewItem, type FileContents, type CodeViewReactOptions, type SelectedLineRange,
} from '@pierre/diffs/react';
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker';
import type { PrThread } from '@shared/protocol';
import { fingerprint } from '@/lib/diff';
import { fileDiffOf } from '@/lib/file-diff';
import { cn } from '@/lib/utils';
import { sessionDraftKey } from '@/store/actions';
import { useApp } from '@/store/app';
import { useDrafts } from '@/store/drafts';
import type { ContextReference } from '@shared/context-reference';
import { PendingCommentCard } from './PendingCommentCard';
import { PrThreadCard } from './PrThreadCard';
import { SelectionComposer, type CodeReference } from './SelectionComposer';

const THEMES = {
  default: { dark: 'pierre-dark', light: 'pierre-light' },
  vscode: { dark: 'dark-plus', light: 'light-plus' },
} as const;
const WORKER_POOL_SIZE = 3;
/** Rows kept above the line a jump lands on, so it is not hard against the sticky header. */
const JUMP_OFFSET = 40;
const THREAD_LOOKUP_TRIES = 30;
/** Parsing every file's diff in one go freezes the window on a big change: only the first few go in, and more follow as the reader nears the end of what is there. */
const REVEAL_FIRST = 3;
const REVEAL_BATCH = 3;
/** How many screens of files are kept ready below the one being read. */
const REVEAL_AHEAD = 2;
/** How long a jump waits for the file it lands on to be read (about 10 s). */
const CONTENT_WAIT_FRAMES = 600;
/** The theme paints its own background; inside the shadow root the app's card colour has to be set on the host. */
const HOST_CSS = ':host { --diffs-light-bg: var(--card) !important; --diffs-dark-bg: var(--card) !important; --diffs-font-family: var(--font-mono); --diffs-font-size: 12.5px; } [data-diffs-header] { cursor: pointer; }';

export type ReviewItem =
  | { id: string; kind: 'diff'; path: string; before: string | null; after: string | null; /** False until the contents have arrived. */ ready: boolean; collapsed?: boolean }
  | { id: string; kind: 'file'; path: string; text: string };

type Note = { kind: 'thread'; thread: PrThread } | { kind: 'composer' } | { kind: 'saved'; reference: ContextReference };
type Selection = { id: string; range: SelectedLineRange };

export interface ReviewHandle {
  scrollToItem(id: string): void;
  /** Land on a line of a file (and highlight it, without opening the composer). */
  scrollToLine(id: string, line: number, side?: 'additions' | 'deletions'): void;
  /** Bring a review thread's card to the middle and let it flash. */
  focusThread(thread: PrThread): void;
}

export interface ReviewProps {
  sid?: string;
  items: ReviewItem[];
  threads?: PrThread[];
  className?: string;
  /** A line to land on and mark when the view opens or the target changes. */
  target?: { id: string; line: number } | null;
  /** Leave out the file header (the surrounding window already names the file). */
  hideHeader?: boolean;
  renderPrefix?(item: ReviewItem): ReactNode;
  renderMetadata?(item: ReviewItem): ReactNode;
  /** Items that are about to be shown but whose contents are not in yet. */
  onNeed?(ids: string[]): void;
  /** The item whose header has scrolled to the top. */
  onActiveChange?(id: string | null): void;
}

const ordered = (range: SelectedLineRange) => [Math.min(range.start, range.end), Math.max(range.start, range.end)] as const;

function trimEol(line: string) {
  return line.replace(/\r?\n$/, '');
}

export const ReviewCodeView = forwardRef<ReviewHandle, ReviewProps>(function ReviewCodeView(
  { sid, items, threads = [], className, target, hideHeader, renderPrefix, renderMetadata, onNeed, onActiveChange },
  ref,
) {
  const view = useRef<CodeViewHandle<Note, undefined>>(null);
  const root = useRef<HTMLDivElement>(null);
  const theme = useApp((s) => s.settings.resolvedTheme) === 'dark' ? 'dark' : 'light';
  const themes = THEMES[useApp((s) => s.settings.palette) ?? 'default'];
  const [selection, setSelection] = useState<Selection | null>(null);
  // Only a selection the user made opens the composer; a jump's highlight does not.
  const [composing, setComposing] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [shown, setShown] = useState(REVEAL_FIRST);
  // Comments already written for the next message sit under their lines.
  const references = useDrafts((st) => (sid ? st.drafts[sessionDraftKey(sid)]?.references : undefined));
  const saved = useMemo(() => (references ?? []).filter((r) => r.kind === 'comment' && r.startLine && r.comment), [references]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const versions = useRef(new Map<string, { signature: string; version: number }>());
  // CodeView compares files by identity while laying them out, so one text keeps one object.
  const files = useRef(new Map<string, { text: string; file: FileContents }>());

  const shownRef = useRef(shown);
  shownRef.current = shown;
  const readyRef = useRef(new Set<string>());
  readyRef.current = new Set(items.filter((item) => item.kind === 'file' || item.ready).map((item) => item.id));
  useEffect(() => {
    const missing = items.slice(0, shown).filter((item) => !readyRef.current.has(item.id)).map((item) => item.id);
    if (missing.length) onNeed?.(missing);
  }, [items, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const scrolled = useRef(0);
  /** Bring in the next few files while the last one in the view is within `REVEAL_AHEAD` screens of the bottom edge. */
  const topUp = useCallback(() => {
    const last = items[Math.min(shown, items.length) - 1];
    if (!last || shown >= items.length || !readyRef.current.has(last.id)) return;
    const top = view.current?.getInstance()?.getTopForItem(last.id);
    const height = root.current?.clientHeight ?? 0;
    if (top == null || top - scrolled.current < height * REVEAL_AHEAD) setShown((n) => n + REVEAL_BATCH);
  }, [items, shown]);
  // A short or folded file may leave the view unfilled, with no scroll event to ask for more.
  useEffect(() => {
    const frame = requestAnimationFrame(topUp);
    return () => cancelAnimationFrame(frame);
  }, [topUp]);

  /** Run `go` once the item is part of the view and its contents are in (an item further down is brought in first, with all before it). */
  const whenShown = useCallback((id: string, go: () => void) => {
    const at = items.findIndex((item) => item.id === id);
    if (at < 0) return;
    if (at < shown && readyRef.current.has(id)) return go();
    setShown((n) => Math.max(n, at + 1));
    onNeed?.([id]);
    const wait = (tries: number) => {
      if (readyRef.current.has(id) && shownRef.current > at) requestAnimationFrame(go);
      else if (tries > 0) requestAnimationFrame(() => wait(tries - 1));
    };
    requestAnimationFrame(() => wait(CONTENT_WAIT_FRAMES));
  }, [items, shown, onNeed]);

  const dismiss = useCallback(() => {
    setSelection(null);
    setComposing(false);
    setCommenting(false);
  }, []);

  const codeItems = useMemo(() => items.slice(0, shown).filter((item) => item.kind === 'file' || item.ready).map((item): CodeViewItem<Note> => {
    const own = threads.filter((t) => t.path === item.path);
    const mine = saved.filter((r) => r.path === item.path);
    const annotations: { side?: 'additions' | 'deletions'; lineNumber: number; metadata: Note }[] = [];
    if (item.kind === 'diff') {
      const diff = fileDiffOf(item.path, item.before, item.after);
      for (const thread of own) {
        const side = thread.side === 'old' ? 'deletions' : 'additions';
        const lines = side === 'deletions' ? diff.deletionLines.length : diff.additionLines.length;
        // A line that is gone (or never known) hangs above the first line.
        annotations.push({ side, lineNumber: thread.line && thread.line <= lines ? thread.line : 0, metadata: { kind: 'thread', thread } });
      }
      for (const reference of mine) {
        annotations.push({ side: reference.side === 'old' ? 'deletions' : 'additions', lineNumber: reference.endLine ?? reference.startLine!, metadata: { kind: 'saved', reference } });
      }
      if (sid && composing && selection?.id === item.id) {
        annotations.push({ side: selection.range.endSide ?? selection.range.side ?? 'additions', lineNumber: ordered(selection.range)[1], metadata: { kind: 'composer' } });
      }
      const signature = `${diff.cacheKey ?? ''}|${item.collapsed}|${annotations.map((a) => `${a.side}${a.lineNumber}${a.metadata.kind === 'thread' ? `${a.metadata.thread.id}:${a.metadata.thread.comments.length}:${a.metadata.thread.resolved}` : a.metadata.kind === 'saved' ? a.metadata.reference.id : 'c'}`).join(',')}`;
      return { id: item.id, type: 'diff', fileDiff: diff, collapsed: item.collapsed, annotations: annotations as never, version: versionOf(versions.current, item.id, signature) };
    }
    for (const reference of mine) annotations.push({ lineNumber: reference.endLine ?? reference.startLine!, metadata: { kind: 'saved', reference } });
    if (sid && composing && selection?.id === item.id) annotations.push({ lineNumber: ordered(selection.range)[1], metadata: { kind: 'composer' } });
    const signature = `${item.text.length}:${item.path}|${annotations.map((a) => `${a.lineNumber}${a.metadata.kind === 'saved' ? a.metadata.reference.id : ''}`).join(',')}`;
    let held = files.current.get(item.id);
    if (held?.text !== item.text || held.file.name !== item.path) {
      held = { text: item.text, file: { name: item.path, contents: item.text, cacheKey: `${item.path}:${fingerprint(item.text)}` } };
      files.current.set(item.id, held);
    }
    return { id: item.id, type: 'file', file: held.file, annotations: annotations as never, version: versionOf(versions.current, item.id, signature) };
  }), [items, shown, threads, saved, sid, composing, selection]);

  const referenceOf = useCallback((id: string, range: SelectedLineRange): CodeReference | null => {
    const item = byId.get(id);
    if (!item) return null;
    const [first, last] = ordered(range);
    if (item.kind === 'file') {
      return { path: item.path, startLine: first, endLine: last, text: item.text.split('\n').slice(first - 1, last).join('\n') };
    }
    // A selection across both sides is read from the side it started on.
    const diff = fileDiffOf(item.path, item.before, item.after);
    const old = range.side === 'deletions';
    const lines = old ? diff.deletionLines : diff.additionLines;
    return { path: item.path, startLine: first, endLine: last, side: old ? 'old' : 'new', text: lines.slice(first - 1, last).map(trimEol).join('\n') };
  }, [byId]);

  const jump = useCallback((id: string, line: number, align: 'start' | 'center', highlight: boolean, side?: 'additions' | 'deletions') => {
    if (highlight) {
      setSelection({ id, range: { start: line, end: line, side } });
      setComposing(false);
    }
    whenShown(id, () => view.current?.scrollTo({ type: 'line', id, lineNumber: line, side, align, offset: JUMP_OFFSET, behavior: 'instant' }));
  }, [whenShown]);

  useImperativeHandle(ref, () => ({
    scrollToItem: (id) => whenShown(id, () => view.current?.scrollTo({ type: 'item', id, align: 'start', behavior: 'instant' })),
    scrollToLine: (id, line, side) => jump(id, line, 'center', true, side),
    focusThread: (thread) => {
      const side = thread.side === 'old' ? 'deletions' : 'additions';
      whenShown(thread.path, () => view.current?.scrollTo({ type: 'line', id: thread.path, lineNumber: thread.line ?? 0, side, align: 'center', behavior: 'instant' }));
      const find = (tries: number) => {
        const card = [...(root.current?.querySelectorAll<HTMLElement>('[data-thread-id]') ?? [])].find((el) => el.dataset.threadId === thread.id);
        if (!card) return void (tries > 0 && requestAnimationFrame(() => find(tries - 1)));
        card.scrollIntoView({ block: 'center' });
        card.focus({ preventScroll: true });
        card.removeAttribute('data-flash');
        void card.offsetWidth;
        card.setAttribute('data-flash', '1');
      };
      requestAnimationFrame(() => find(THREAD_LOOKUP_TRIES));
    },
  }), [jump, whenShown]);

  // A new target line (the file preview opened on a reference) scrolls there once the item is laid out.
  const targetKey = target ? `${target.id}:${target.line}` : null;
  const hasTarget = !!target && byId.has(target.id);
  useEffect(() => {
    if (!target || !hasTarget) return;
    const frame = requestAnimationFrame(() => jump(target.id, target.line, 'center', true));
    return () => cancelAnimationFrame(frame);
  }, [targetKey, hasTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo<CodeViewReactOptions<Note, undefined>>(() => ({
    theme: themes,
    themeType: theme,
    diffStyle: 'unified',
    overflow: 'wrap',
    hunkSeparators: 'line-info',
    lineDiffType: 'word-alt',
    stickyHeaders: true,
    unsafeCSS: HOST_CSS,
    disableFileHeader: hideHeader,
    enableLineSelection: !!sid,
    enableGutterUtility: !!sid,
    lineHoverHighlight: 'both',
    onGutterUtilityClick: (range, context) => {
      setSelection({ id: context.item.id, range });
      setComposing(true);
      setCommenting(true);
    },
    onLineSelectionEnd: (range, context) => {
      if (!range) return;
      setSelection({ id: context.item.id, range });
      setComposing(true);
      setCommenting(false);
    },
  }), [theme, themes, sid, hideHeader]);

  const activeRef = useRef<string | null>(null);
  const onScroll = useCallback((_top: number, viewer: { getTopForItem(id: string): number | undefined }, scrollTop = _top) => {
    scrolled.current = scrollTop;
    topUp();
    if (!onActiveChange) return;
    let current: string | null = null;
    for (const item of items) {
      const top = viewer.getTopForItem(item.id);
      if (top == null || top - scrollTop > JUMP_OFFSET) break;
      current = item.id;
    }
    if (current !== activeRef.current) onActiveChange((activeRef.current = current));
  }, [items, onActiveChange, topUp]);

  return (
    <div ref={root} className={cn('review-code relative min-h-0', className)} onClick={clickHeader}>
      {/* The scroller needs a definite box, which a flex item's percentage height is not. */}
      <div className="absolute inset-0">
      <WorkerPoolContextProvider key={themes.dark} poolOptions={{ workerFactory: () => new DiffsWorker(), poolSize: WORKER_POOL_SIZE }} highlighterOptions={{ theme: themes }}>
        <CodeView<Note, undefined>
          ref={view}
          items={codeItems}
          options={options}
          className="h-full overflow-auto"
          selectedLines={selection}
          onSelectedLinesChange={(next) => {
            setSelection(next);
            if (!next) dismiss();
          }}
          onScroll={onScroll}
          renderHeaderPrefix={renderPrefix && ((item) => { const own = byId.get(item.id); return own ? renderPrefix(own) : null; })}
          renderHeaderMetadata={renderMetadata && ((item) => { const own = byId.get(item.id); return own ? renderMetadata(own) : null; })}
          renderAnnotation={(annotation, _source, item) => {
            const note = annotation.metadata;
            if (!note) return null;
            if (note.kind === 'thread') return <PrThreadCard thread={note.thread} />;
            if (note.kind === 'saved') return sid ? <PendingCommentCard sid={sid} reference={note.reference} /> : null;
            const reference = sid && selection ? referenceOf(item.id, selection.range) : null;
            if (!sid || !reference) return null;
            return <SelectionComposer sid={sid} reference={reference} commenting={commenting} onCommenting={setCommenting} onDone={dismiss} />;
          }}
        />
      </WorkerPoolContextProvider>
      </div>
    </div>
  );
});

/** Marks the header prefix control that a click anywhere else on the file header should trigger. */
export const HEADER_TOGGLE_ATTR = 'data-header-toggle';

/** The header lives in a shadow root: find it on the composed path, and forward the click to its toggle. */
function clickHeader(e: MouseEvent<HTMLElement>) {
  const path = e.nativeEvent.composedPath();
  const header = path.find((n): n is HTMLElement => n instanceof HTMLElement && n.hasAttribute('data-diffs-header'));
  if (!header) return;
  const inner = path.slice(0, path.indexOf(header));
  if (inner.some((n) => n instanceof HTMLElement && n.matches('button, a, input, [role="button"]'))) return;
  const host = (header.getRootNode() as ShadowRoot).host;
  host?.querySelector<HTMLElement>(`[${HEADER_TOGGLE_ATTR}]`)?.click();
}

/** CodeView re-reads an item only when its version moves, so each distinct content gets the next number. */
function versionOf(known: Map<string, { signature: string; version: number }>, id: string, signature: string) {
  const prev = known.get(id);
  if (prev?.signature === signature) return prev.version;
  const next = { signature, version: (prev?.version ?? 0) + 1 };
  known.set(id, next);
  return next.version;
}
