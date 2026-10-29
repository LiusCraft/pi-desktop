import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { FileIcon, GitCompareIcon, MessageSquareIcon, SquareTerminalIcon, TerminalIcon, XIcon } from 'lucide-react';
import DOMPurify from 'dompurify';
import { ContextCards } from './ContextCards';
import {
  cachedSources,
  diffMention,
  fileMention,
  loadSources,
  mentionReference,
  sessionMentions,
  terminalMentions,
  type Mention,
} from './mentions';
import { LIMITS } from '@shared/attachments';
import { badgeDeletion, messageSpans, referenceToken, type ContextReference } from '@shared/context-reference';
import type { AttachmentSource } from '@shared/protocol';
import { AttachmentTiles } from '@/components/common/Attachments';
import { ReferencePreview } from '@/components/common/InlineRefs';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { bridge, call } from '@/lib/api';
import { bashCommand } from '@/lib/bash';
import { desktopCommands } from '@/lib/constants';
import { fuzzyEntry, fuzzyRank, type FuzzyEntry } from '@/lib/fuzzy';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { cycleMode, loadFiles, openContextReference, send } from '@/store/actions';
import { currentSession, getApp, useApp } from '@/store/app';
import { drafts, getDraft, useDrafts } from '@/store/drafts';
import type { SessionView } from '@/store/types';

/** Extract clipboard text from a sanitized, detached fragment. */
export function plainHTML(html: string) {
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'img', 'audio', 'video', 'source'],
  });
  const block = new Set(['P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'PRE', 'BLOCKQUOTE']);
  const text = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node as Text).data;
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
    if (node.nodeName === 'BR') return '\n';
    let s = [...node.childNodes].map(text).join('');
    if (node.nodeName === 'TD' || node.nodeName === 'TH') s += '\t';
    if (block.has(node.nodeName) && !s.endsWith('\n')) s += '\n';
    return s;
  };
  return text(fragment);
}

async function sourcesOf(files: File[]): Promise<AttachmentSource[]> {
  if (files.length > LIMITS.count) throw new Error(`Choose at most ${LIMITS.count} attachments`);
  if (files.reduce((n, f) => n + f.size, 0) > LIMITS.sourceBytes)
    throw new Error('Attachments exceed the total size limit');
  return Promise.all(
    files.map(async (file): Promise<AttachmentSource> => {
      const path = bridge.getPathForFile?.(file);
      if (path) return { path };
      if (!file.type.startsWith('image/'))
        throw new Error(`${file.name}: this clipboard file has no local path; save it and select it instead`);
      if (file.size > LIMITS.fileBytes) throw new Error(`${file.name}: image exceeds 20 MB`);
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(new Error(`Cannot read ${file.name}`));
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.readAsDataURL(file);
      });
      return { name: file.name || 'Screenshot.png', mimeType: file.type, data };
    }),
  );
}

/** Pasted text lands at the caret unless the user typed meanwhile; then it is kept as a recovery. */
function acceptPaste(key: string, text: string, selection: [number, number], revision: number) {
  if (!text) return;
  if (getDraft(key).revision === revision) drafts.insert(key, text, selection);
  else drafts.recover(key, { text, attachments: [], label: 'Pasted text' });
}

function importFiles(
  key: string,
  files: File[],
  pasted?: { text: string; selection: [number, number]; revision: number },
) {
  return drafts.prepare(key, async () => {
    let result;
    try {
      result = await call('attachments:import', await sourcesOf(files));
    } finally {
      // Even a failed image import must not discard the accompanying caption.
      if (pasted) acceptPaste(key, pasted.text, pasted.selection, pasted.revision);
    }
    drafts.accept(key, result);
  });
}

export const pickAttachments = () => {
  const key = useDrafts.getState().active;
  if (key) void drafts.prepare(key, async () => drafts.accept(key, await call('attachments:pick')));
};

/** One row of the / or @ menu. */
interface Suggestion {
  key: string;
  kind: Mention['kind'] | 'command';
  label: string;
  hint: string;
  insert: string;
  /** The @ sources carry what is needed to capture the content when picked. */
  mention?: Mention;
}

const KIND_ICON: Record<Suggestion['kind'], ReactNode> = {
  command: <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />,
  file: <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />,
  session: <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />,
  terminal: <SquareTerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />,
  diff: <GitCompareIcon className="size-3.5 shrink-0 text-muted-foreground" />,
};

/** The file list is lowercased once per list, not once per keystroke. */
let fileIndex: { files: string[]; entries: FuzzyEntry<Mention>[] } | null = null;
const fileEntries = (files: string[]) => {
  if (fileIndex?.files === files) return fileIndex.entries;
  const entries = files.map((path) => fuzzyEntry(fileMention(path), path));
  fileIndex = { files, entries };
  return entries;
};

function commandSuggestions(query: string, s: SessionView | null): Suggestion[] {
  const commands = [
    ...desktopCommands(),
    ...(s?.commands ?? []).map((c) => [`/${c.name}`, c.description || c.source] as [string, string]),
  ];
  const entries = commands.map(([name, description]) => fuzzyEntry({ name, description }, name.slice(1)));
  return fuzzyRank(entries, query, 12).map(({ item }) => ({
    key: `command:${item.name}`,
    kind: 'command',
    label: item.name,
    hint: item.description,
    insert: `${item.name} `,
  }));
}

/** Files, terminal tabs, the working tree and the project's other sessions, ranked together. A new session has only sessions to offer. */
function mentionSuggestions(
  query: string,
  s: SessionView | null,
  projectPath: string | null,
  kind: SessionView['meta']['kind'],
): Suggestion[] {
  const sources = s ? cachedSources(s.meta.id) : { terminals: [], changes: [], repo: false };
  const files = s ? (getApp().sessions[s.meta.id]?.files ?? []) : [];
  const diff = diffMention(sources.changes);
  const sessions = sessionMentions(projectPath, kind, s?.meta.id ?? '');
  const ranked = [
    ...(s && sources.repo ? fuzzyRank([fuzzyEntry(diff, diff.search)], query, 1) : []),
    ...fuzzyRank(
      terminalMentions(sources.terminals).map((m) => fuzzyEntry(m, m.search)),
      query,
      10,
    ),
    ...fuzzyRank(
      sessions.map((m) => fuzzyEntry(m, m.search)),
      query,
      10,
    ),
    ...fuzzyRank(fileEntries(files), query, 20),
  ].sort((a, b) => b.score - a.score);
  return ranked.slice(0, 40).map(({ item }) => ({
    key: `${item.kind}:${item.sessionId ?? item.terminalId ?? item.insert.trim()}`,
    kind: item.kind,
    label: item.label,
    hint: item.hint,
    insert: item.insert,
    mention: item,
  }));
}

export interface ComposerHandle {
  focus(): void;
}

/** The gray next-message guess drawn under the empty textarea. */
function SuggestionGhost({ text, ghostRef }: { text: string; ghostRef: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ghostRef}
      aria-hidden
      data-testid="composer-ghost"
      // Same metrics as the textarea, but it only ever holds a guess.
      className="pointer-events-none absolute inset-0 overflow-hidden leading-relaxed break-words whitespace-pre-wrap"
    >
      <span className="text-muted-foreground/70">{text}</span>
      <span className="ml-2 text-[11px] whitespace-nowrap text-muted-foreground/40">→ Tab</span>
    </div>
  );
}

/** → at the end of an empty box and Tab accept the guess; modified arrows keep their own job. */
const acceptsGhost = (e: KeyboardEvent<HTMLTextAreaElement>) =>
  (e.key === 'ArrowRight' || e.key === 'Tab') && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey;

/** A menu item's span in the message: the /command being typed, or the @ prefix being searched. */
const MENTION_PREFIX = /(?:^|\s)@([^\s@]*)$/;
const COMMAND_PREFIX = /^\/[^\s]*$/;

export const ComposerInput = forwardRef<
  ComposerHandle,
  {
    placeholder: string;
    className?: string;
    minRows?: number;
    maxHeight?: number;
    onDragState?: (over: boolean) => void;
  }
>(function ComposerInput({ placeholder, className, minRows = 1, maxHeight = 260, onDragState }, ref) {
  const t = useT();
  const key = useDrafts((s) => s.active);
  const draft = useDrafts((s) => (s.active ? s.drafts[s.active] : undefined));
  const running = useApp((s) => (s.current ? s.sessions[s.current]?.running : false));
  const files = useApp((s) => (s.current ? s.sessions[s.current]?.files : null));
  /** A typed @path is only a badge when it names a file the project actually has. */
  const knownPath = useMemo(() => {
    if (!files) return () => false;
    const paths = new Set(files);
    return (path: string) => paths.has(path);
  }, [files]);
  const input = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [sel, setSel] = useState(0);
  const [preview, setPreview] = useState<{ reference: ContextReference; x: number; y: number } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }));

  // The guess only makes sense while the session is idle and the draft is empty:
  // typing or a new turn replaces it.
  const suggestion = draft && !draft.text && !draft.sending && !running ? draft.suggestion : null;
  /** The message runs in the session's shell: no @ or / menu applies then. */
  const shell = bashCommand(draft?.text ?? '');

  /** The badges and where they sit, so a click inside one can open its preview. */
  const spans = useMemo(
    () => messageSpans(draft?.text ?? '', draft?.references ?? [], { isKnownPath: knownPath }),
    [draft?.text, draft?.references, knownPath],
  );

  // Grow with the text, up to a limit. A wrapped guess grows the box too, so the
  // whole prediction is visible before it is accepted.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    const height = Math.max(el.scrollHeight, ghost.current?.scrollHeight ?? 0);
    el.style.height = `${Math.min(height, maxHeight)}px`;
    // Resizing can reset the textarea's scroll; the badges follow it exactly.
    if (mirror.current) mirror.current.scrollTop = el.scrollTop;
  }, [draft?.text, suggestion, maxHeight]);
  // Opening a draft (a fork or rewind fills it in) puts the caret after the text.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [key]);

  // Keep the highlighted suggestion visible while moving through a long list.
  useEffect(() => {
    menu.current?.querySelector<HTMLElement>(`[data-index="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel, items]);

  const suggest = async () => {
    const el = input.current;
    if (!el) return;
    const current = ++request.current;
    // A shell command is not a message: no @ or / menu belongs in it (and a pending lookup is dropped).
    if (bashCommand(el.value)) return setItems([]);
    const pos = el.selectionStart,
      before = el.value.slice(0, pos);
    const s = currentSession();
    const command = COMMAND_PREFIX.exec(before);
    const at = command ? null : MENTION_PREFIX.exec(before);
    let next: Suggestion[] = [];
    if (command) next = commandSuggestions(command[0].slice(1), s ?? null);
    else if (at) {
      const st = getApp();
      const projectPath = s?.meta.projectPath ?? (st.view === 'work' ? st.prefs.workFolder : st.prefs.project);
      const kind = s?.meta.kind ?? (st.view === 'work' ? 'work' : 'code');
      if (s) {
        if (!s.files) void loadFiles(s.meta.id).then(() => suggestRef.current());
        loadSources(s.meta.id, () => suggestRef.current());
      }
      next = mentionSuggestions(at[1], s ?? null, projectPath ?? null, kind);
    }
    // A slower, older lookup (e.g. loading the file list) must not replace a newer one.
    if (current !== request.current) return;
    setItems(next);
    setSel((i) => Math.min(i, Math.max(0, next.length - 1)));
  };
  /** The latest `suggest`, for the background loads that finish later. */
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;

  /** Put the picked token where the @ (or /) prefix is; the caret ends after it. */
  const insertToken = (snippet: string) => {
    const el = input.current;
    const k = key;
    if (!el || !k) return;
    const value = el.value;
    const pos = el.selectionStart;
    const before = value.slice(0, pos);
    const match = MENTION_PREFIX.exec(before) ?? COMMAND_PREFIX.exec(before);
    const start = match ? match.index + (match[0].startsWith('@') || match[0].startsWith('/') ? 0 : 1) : pos;
    drafts.setText(k, value.slice(0, start) + snippet + value.slice(pos));
    const caret = start + snippet.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const pick = (i: number) => {
    const suggestionItem = items[i];
    setItems([]);
    const k = key;
    if (!suggestionItem || !k) return;
    if (suggestionItem.kind === 'command' || suggestionItem.kind === 'file') return insertToken(suggestionItem.insert);
    const view = currentSession();
    const mention = suggestionItem.mention;
    if (!mention) return;
    // A new session has no sources of its own, but a session pointer needs none.
    if (mention.kind !== 'session' && !view) return;
    // The terminal snapshot and the diff summary are captured now, so the badge and
    // the prompt carry the same bytes even if the terminal keeps printing.
    void drafts.prepare(k, async () => {
      if (useDrafts.getState().active !== k) return;
      const reference = await mentionReference(mention, view ? cachedSources(view.meta.id) : undefined);
      if (!reference) return void drafts.error(k, t('mention.empty'));
      if (drafts.addReference(k, reference)) insertToken(suggestionItem.insert);
    });
  };

  /** Clicking inside a badge shows what was attached; a plain click still places the caret. */
  const previewOnClick = (e: MouseEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return false;
    const caret = el.selectionStart;
    const hit = spans.find(
      (span) => span.segment.kind === 'reference' && span.segment.reference && caret > span.start && caret < span.end,
    );
    if (!hit || hit.segment.kind !== 'reference' || !hit.segment.reference) return false;
    setItems([]);
    setPreview({ reference: hit.segment.reference, x: e.clientX, y: e.clientY });
    return true;
  };

  /** Promote the ghost text into a real draft, ready to edit or send. */
  const acceptSuggestion = () => {
    if (!key || !suggestion) return;
    drafts.setText(key, suggestion);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(suggestion.length, suggestion.length);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // A badge is one unit while editing: Backspace/Delete take the whole token, never a letter of it.
    if (draft && !draft.sending && !e.nativeEvent.isComposing && (e.key === 'Backspace' || e.key === 'Delete')) {
      const el = e.currentTarget;
      const hit = badgeDeletion(el.value, draft.references, [el.selectionStart, el.selectionEnd], e.key === 'Delete', {
        isKnownPath: knownPath,
      });
      // Widen the selection and let the browser delete it: the edit stays undoable.
      if (hit) el.setSelectionRange(hit.start, hit.end);
    }
    if (items.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((i) => (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
        e.preventDefault();
        return pick(sel);
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        return setItems([]);
      }
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      return cycleMode();
    }
    // Ghost text: → at the end of an empty box and Tab have no other job here.
    if (suggestion && !e.nativeEvent.isComposing) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (key) drafts.setSuggestion(key, null);
        return;
      }
      const el = e.currentTarget;
      const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
      if (atEnd && acceptsGhost(e)) {
        e.preventDefault();
        return acceptSuggestion();
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(e.metaKey || e.ctrlKey);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!key) return;
    const d = getDraft(key);
    if (d.sending) return e.preventDefault();
    const data = e.clipboardData;
    const files = [...data.files],
      types = [...data.types];
    const text = data.getData('text/plain'),
      html = data.getData('text/html');
    const el = e.currentTarget;
    const selection: [number, number] = [el.selectionStart, el.selectionEnd];
    if (files.length) {
      e.preventDefault();
      const localFiles =
        files.some((f) => bridge.getPathForFile?.(f)) ||
        types.some((t) => /uri-list|gnome-copied-files|file-url|FileName|CF_HDROP/i.test(t));
      void importFiles(key, files, {
        text: localFiles ? '' : text || (html ? plainHTML(html) : ''),
        selection,
        revision: d.revision,
      });
      return;
    }
    const native = types.some((t) =>
      /uri-list|gnome-copied-files|file-url|osclipboard|FileName|CF_HDROP|Files/i.test(t),
    );
    // Keep the browser's own paste, selection and undo for ordinary text.
    if (text && !native) return;
    if (html && !native) {
      e.preventDefault();
      drafts.insert(key, plainHTML(html), selection);
      return;
    }
    e.preventDefault();
    void drafts.prepare(key, async () => {
      const result = await call('attachments:clipboard');
      const fallback = result.hasFiles ? '' : result.text || text || (html ? plainHTML(html) : '');
      drafts.accept(key, result);
      acceptPaste(key, fallback, selection, d.revision);
      if (!fallback && !result.attachments.length && !result.errors.length)
        drafts.error(key, 'No supported image, file or text found in the clipboard');
    });
  };

  if (!key || !draft) return null;
  // @ references live inline as badges; everything else (excerpts, comments, replies) stays a card.
  const cards = draft.references.filter((reference) => !referenceToken(reference));
  const rack =
    cards.length || draft.attachments.length || draft.preparing || draft.errors.length || draft.recoveries.length;
  return (
    <div className={cn('relative', className)}>
      {items.length > 0 && (
        <div
          ref={menu}
          role="listbox"
          tabIndex={-1}
          aria-label={t('composer.suggestions')}
          // Clicking the list must not take focus from the textarea (that would close it).
          onMouseDown={(e) => e.preventDefault()}
          className="absolute bottom-full left-0 z-50 mb-2 max-h-72 w-full max-w-md overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 shadow-lg"
        >
          {items.map((it, i) => (
            <button
              key={it.key}
              type="button"
              role="option"
              aria-selected={i === sel}
              data-index={i}
              tabIndex={-1}
              onMouseMove={() => i !== sel && setSel(i)}
              onClick={() => pick(i)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm',
                i === sel ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
              )}
            >
              {KIND_ICON[it.kind]}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              <span className="max-w-[50%] shrink-0 truncate text-xs text-muted-foreground">{it.hint}</span>
            </button>
          ))}
        </div>
      )}
      {!!rack && (
        <div className="space-y-2 mb-2">
          <ContextCards
            references={cards}
            disabled={draft.sending}
            onRemove={(id) => drafts.removeReference(key, id)}
            onOpen={(reference) => reference.kind !== 'quote' && openContextReference(reference, null)}
          />
          <AttachmentTiles
            attachments={draft.attachments}
            disabled={draft.sending}
            onRemove={(i) => drafts.removeAttachment(key, i)}
          />
          {draft.preparing > 0 && (
            <div className="text-xs text-muted-foreground" role="status">
              {t('composer.preparing')}
            </div>
          )}
          {draft.errors.length > 0 && (
            <div
              className="flex items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
              role="alert"
            >
              <div className="flex-1 whitespace-pre-wrap">{draft.errors.join('\n')}</div>
              <button onClick={() => drafts.dismissErrors(key)} aria-label={t('composer.dismissErrors')}>
                <XIcon className="size-3.5" />
              </button>
            </div>
          )}
          {draft.recoveries.map((r, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
              <span className="flex-1 truncate">
                {r.label ||
                  r.text.trim().slice(0, 65) ||
                  r.attachments[0]?.name ||
                  r.references?.[0]?.path ||
                  t('composer.unsent')}
              </span>
              <button
                className="text-primary hover:underline"
                disabled={draft.sending}
                onClick={() => drafts.restore(key, i)}
              >
                {t('composer.restore')}
              </button>
              <button className="text-muted-foreground hover:underline" onClick={() => drafts.discard(key, i)}>
                {t('composer.discard')}
              </button>
            </div>
          ))}
        </div>
      )}
      {shell && (
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="composer-shell">
          <TerminalIcon className="size-3.5 shrink-0" />
          {t(shell.excludeFromContext ? 'composer.shellHintExcluded' : 'composer.shellHint')}
        </div>
      )}
      <div className="relative">
        {suggestion && <SuggestionGhost text={suggestion} ghostRef={ghost} />}
        {/* The badges of @ tokens and paths, drawn behind the textarea's own text: no
              padding, so the caret and the selection stay exactly where the text is. */}
        <div
          ref={mirror}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden leading-relaxed break-words whitespace-pre-wrap text-transparent"
        >
          {spans.map(({ segment }, i) =>
            segment.kind === 'text' ? (
              <span key={i}>{segment.text}</span>
            ) : (
              <span key={i} className="chip-inline">
                {segment.token}
              </span>
            ),
          )}
        </div>
        <textarea
          ref={input}
          data-composer-input
          rows={minRows}
          value={draft.text}
          readOnly={draft.sending}
          aria-label={placeholder}
          placeholder={suggestion ? '' : placeholder}
          onChange={(e) => {
            drafts.setText(key, e.target.value);
            void suggest();
          }}
          onClick={(e) => {
            if (previewOnClick(e)) return;
            void suggest();
          }}
          onScroll={(e) => {
            const m = mirror.current;
            if (m) m.scrollTop = e.currentTarget.scrollTop;
          }}
          onBlur={() => setTimeout(() => setItems([]), 120)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDragOver={(e: DragEvent) => {
            if ([...e.dataTransfer.types].includes('Files')) {
              e.preventDefault();
              onDragState?.(true);
            }
          }}
          onDragLeave={() => onDragState?.(false)}
          onDrop={(e: DragEvent) => {
            onDragState?.(false);
            const files = [...e.dataTransfer.files];
            if (!files.length || draft.sending) return;
            e.preventDefault();
            void importFiles(key, files);
          }}
          className="relative block w-full resize-none bg-transparent leading-relaxed outline-none placeholder:text-muted-foreground"
        />
      </div>
      {preview && (
        <Popover open onOpenChange={(open) => !open && setPreview(null)}>
          <PopoverAnchor asChild>
            {/* A zero-size anchor at the click, so the card opens where the badge is. */}
            <span style={{ position: 'fixed', left: preview.x, top: preview.y, width: 1, height: 1 }} />
          </PopoverAnchor>
          <PopoverContent
            side="top"
            align="start"
            className="w-auto p-0"
            // Keep the caret in the composer: the card is something to read, not to type into.
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              input.current?.focus();
            }}
          >
            <ReferencePreview reference={preview.reference} />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
});
