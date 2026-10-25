import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { XIcon } from 'lucide-react';
import { LIMITS } from '@shared/attachments';
import type { AttachmentSource } from '@shared/protocol';
import { AttachmentTiles } from '@/components/common/Attachments';
import { bridge, call } from '@/lib/api';
import { DESKTOP_COMMANDS } from '@/lib/constants';
import { fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { cycleMode, loadFiles, send } from '@/store/actions';
import { currentSession, getApp } from '@/store/app';
import { drafts, getDraft, useDrafts } from '@/store/drafts';

/** Plain text of pasted HTML. A template stays inert: it cannot load images or run scripts. */
export function plainHTML(html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((e) => e.remove());
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
  return text(template.content);
}

async function sourcesOf(files: File[]): Promise<AttachmentSource[]> {
  if (files.length > LIMITS.count) throw new Error(`Choose at most ${LIMITS.count} attachments`);
  if (files.reduce((n, f) => n + f.size, 0) > LIMITS.sourceBytes) throw new Error('Attachments exceed the total size limit');
  return Promise.all(files.map(async (file): Promise<AttachmentSource> => {
    const path = bridge.getPathForFile?.(file);
    if (path) return { path };
    if (!file.type.startsWith('image/')) throw new Error(`${file.name}: this clipboard file has no local path; save it and select it instead`);
    if (file.size > LIMITS.fileBytes) throw new Error(`${file.name}: image exceeds 20 MB`);
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error(`Cannot read ${file.name}`));
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.readAsDataURL(file);
    });
    return { name: file.name || 'Screenshot.png', mimeType: file.type, data };
  }));
}

/** Pasted text lands at the caret unless the user typed meanwhile; then it is kept as a recovery. */
function acceptPaste(key: string, text: string, selection: [number, number], revision: number) {
  if (!text) return;
  if (getDraft(key).revision === revision) drafts.insert(key, text, selection);
  else drafts.recover(key, { text, attachments: [], label: 'Pasted text' });
}

function importFiles(key: string, files: File[], pasted?: { text: string; selection: [number, number]; revision: number }) {
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

interface Suggestion {
  label: string;
  hint: string;
  insert: string;
  from: number;
}

export interface ComposerHandle {
  focus(): void;
}

export const ComposerInput = forwardRef<ComposerHandle, { placeholder: string; className?: string; minRows?: number; maxHeight?: number; onDragState?: (over: boolean) => void }>(
  function ComposerInput({ placeholder, className, minRows = 1, maxHeight = 260, onDragState }, ref) {
    const key = useDrafts((s) => s.active);
    const draft = useDrafts((s) => (s.active ? s.drafts[s.active] : undefined));
    const input = useRef<HTMLTextAreaElement>(null);
    const [items, setItems] = useState<Suggestion[]>([]);
    const [sel, setSel] = useState(0);
    useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }));

    // Grow with the text, up to a limit.
    useEffect(() => {
      const el = input.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    }, [draft?.text, maxHeight]);
    useEffect(() => {
      input.current?.focus();
    }, [key]);

    const suggest = async () => {
      const el = input.current;
      if (!el) return;
      const pos = el.selectionStart, before = el.value.slice(0, pos);
      const s = currentSession();
      let m: RegExpMatchArray | null;
      let next: Suggestion[] = [];
      if ((m = before.match(/^\/(\S*)$/))) {
        const all = [...DESKTOP_COMMANDS, ...(s?.commands ?? []).map((c) => [`/${c.name}`, c.description || c.source] as [string, string])];
        next = all.filter(([k]) => k.slice(1).startsWith(m![1])).slice(0, 12).map(([k, d]) => ({ label: k, hint: d, insert: `${k} `, from: 0 }));
      } else if ((m = before.match(/(?:^|\s)@([^\s@]*)$/)) && s) {
        if (!s.files) await loadFiles(s.meta.id);
        const files = getApp().sessions[s.meta.id]?.files ?? [];
        const q = m[1].toLowerCase();
        next = files.filter((p) => p.toLowerCase().includes(q)).slice(0, 10).map((p) => ({ label: `@${fname(p)}`, hint: p, insert: `@${p} `, from: pos - m![1].length - 1 }));
      }
      setItems(next);
      setSel((i) => Math.min(i, Math.max(0, next.length - 1)));
    };

    const pick = (i: number) => {
      const it = items[i], el = input.current;
      if (!it || !el || !key) return;
      const pos = el.selectionStart, v = el.value;
      drafts.setText(key, v.slice(0, it.from) + it.insert + v.slice(pos));
      const caret = it.from + it.insert.length;
      requestAnimationFrame(() => el.setSelectionRange(caret, caret));
      setItems([]);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
      const files = [...data.files], types = [...data.types];
      const text = data.getData('text/plain'), html = data.getData('text/html');
      const el = e.currentTarget;
      const selection: [number, number] = [el.selectionStart, el.selectionEnd];
      if (files.length) {
        e.preventDefault();
        const localFiles = files.some((f) => bridge.getPathForFile?.(f)) || types.some((t) => /uri-list|gnome-copied-files|file-url|FileName|CF_HDROP/i.test(t));
        void importFiles(key, files, { text: localFiles ? '' : text || (html ? plainHTML(html) : ''), selection, revision: d.revision });
        return;
      }
      const native = types.some((t) => /uri-list|gnome-copied-files|file-url|osclipboard|FileName|CF_HDROP|Files/i.test(t));
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
        if (!fallback && !result.attachments.length && !result.errors.length) drafts.error(key, 'No supported image, file or text found in the clipboard');
      });
    };

    if (!key || !draft) return null;
    const rack = draft.attachments.length || draft.preparing || draft.errors.length || draft.recoveries.length;
    return (
      <div className={cn('relative', className)}>
        {items.length > 0 && (
          <div className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-md overflow-hidden rounded-lg border bg-popover p-1 shadow-lg">
            {items.map((it, i) => (
              <button
                key={it.insert}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
                className={cn('flex w-full items-baseline gap-3 rounded-md px-2.5 py-1.5 text-left text-sm', i === sel && 'bg-accent')}
              >
                <span className="shrink-0 font-mono">{it.label}</span>
                <span className="truncate text-xs text-muted-foreground">{it.hint}</span>
              </button>
            ))}
          </div>
        )}
        {!!rack && (
          <div className="mb-2 space-y-2">
            <AttachmentTiles attachments={draft.attachments} disabled={draft.sending} onRemove={(i) => drafts.removeAttachment(key, i)} />
            {draft.preparing > 0 && <div className="text-xs text-muted-foreground" role="status">Preparing attachments…</div>}
            {draft.errors.length > 0 && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive" role="alert">
                <div className="flex-1 whitespace-pre-wrap">{draft.errors.join('\n')}</div>
                <button onClick={() => drafts.dismissErrors(key)} aria-label="Dismiss attachment errors"><XIcon className="size-3.5" /></button>
              </div>
            )}
            {draft.recoveries.map((r, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                <span className="flex-1 truncate">{r.label || r.text.trim().slice(0, 65) || r.attachments[0]?.name || 'Unsent message'}</span>
                <button className="text-primary hover:underline" disabled={draft.sending} onClick={() => drafts.restore(key, i)}>Restore</button>
                <button className="text-muted-foreground hover:underline" onClick={() => drafts.discard(key, i)}>Discard</button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={input}
          rows={minRows}
          value={draft.text}
          readOnly={draft.sending}
          placeholder={placeholder}
          onChange={(e) => {
            drafts.setText(key, e.target.value);
            void suggest();
          }}
          onClick={() => void suggest()}
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
          className="block w-full resize-none bg-transparent leading-relaxed outline-none placeholder:text-muted-foreground"
        />
      </div>
    );
  },
);
