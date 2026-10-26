// Composer drafts, one per welcome screen and per session. Drafts survive switching
// sessions (for this app run), and a message that could not be delivered comes back
// here as a recovery instead of being lost.
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { validateAttachments, type Attachment, type PromptSubmission } from '@shared/attachments';
import { MAX_CONTEXT_CHARS, MAX_CONTEXT_ITEMS, type ContextReference } from '@shared/context-reference';
import type { AttachmentImportResult } from '@shared/protocol';
import { errText } from '@/lib/api';

export interface DraftSubmission extends PromptSubmission {
  references?: ContextReference[];
}

export interface Draft {
  key: string;
  text: string;
  attachments: Attachment[];
  references: ContextReference[];
  /** Bumped by every edit; a paste that lands after the user typed must not clobber the text. */
  revision: number;
  preparing: number;
  sending: boolean;
  errors: string[];
  recoveries: { text: string; attachments: Attachment[]; references?: ContextReference[]; label?: string }[];
}

interface DraftState {
  drafts: Record<string, Draft>;
  active: string | null;
}

export const useDrafts = create<DraftState>()(immer(() => ({ drafts: {}, active: null })));

const blank = (key: string): Draft => ({ key, text: '', attachments: [], references: [], revision: 0, preparing: 0, sending: false, errors: [], recoveries: [] });

function edit(key: string, fn: (d: Draft) => void) {
  useDrafts.setState((st) => {
    st.drafts[key] ??= blank(key);
    fn(st.drafts[key]);
  });
}

export const getDraft = (key: string) => useDrafts.getState().drafts[key] ?? blank(key);
export const activeDraft = () => {
  const key = useDrafts.getState().active;
  return key ? getDraft(key) : null;
};

export const drafts = {
  activate(key: string) {
    useDrafts.setState((st) => {
      st.drafts[key] ??= blank(key);
      st.active = key;
    });
  },
  setText(key: string, text: string) {
    edit(key, (d) => {
      if (d.text === text) return;
      d.text = text;
      d.revision++;
    });
  },
  insert(key: string, text: string, selection?: [number, number]) {
    if (!text) return;
    edit(key, (d) => {
      const [start, end] = selection ?? [d.text.length, d.text.length];
      d.text = d.text.slice(0, start) + text + d.text.slice(end);
      d.revision++;
    });
  },
  error(key: string, err: unknown) {
    edit(key, (d) => void d.errors.push(errText(err)));
  },
  dismissErrors(key: string) {
    edit(key, (d) => void (d.errors = []));
  },
  removeAttachment(key: string, index: number) {
    edit(key, (d) => {
      d.attachments.splice(index, 1);
      d.revision++;
    });
  },
  addReference(key: string, reference: ContextReference): boolean {
    let added = false;
    edit(key, (d) => {
      if (d.sending) return;
      const size = [...d.references, reference].reduce((total, item) => total + (item.text?.length ?? 0) + (item.comment?.length ?? 0) + item.path.length, 0);
      if (d.references.length >= MAX_CONTEXT_ITEMS || size > MAX_CONTEXT_CHARS) {
        d.errors.push(`最多附加 ${MAX_CONTEXT_ITEMS} 项上下文，总内容不能超过 ${MAX_CONTEXT_CHARS.toLocaleString()} 个字符`);
        return;
      }
      d.references.push(reference);
      d.revision++;
      added = true;
    });
    return added;
  },
  removeReference(key: string, id: string) {
    edit(key, (d) => {
      if (d.sending) return;
      d.references = d.references.filter((reference) => reference.id !== id);
      d.revision++;
    });
  },
  /** Add imported attachments, skipping duplicates and anything over the limits. */
  accept(key: string, result: AttachmentImportResult | undefined) {
    edit(key, (d) => {
      const existing = new Set(d.attachments.map((a) => (a.kind === 'file' ? a.path : `${a.mimeType}:${a.data}`)));
      const incoming = (result?.attachments ?? []).filter((a) => {
        const k = a.kind === 'file' ? a.path : `${a.mimeType}:${a.data}`;
        if (existing.has(k)) return false;
        existing.add(k);
        return true;
      });
      try {
        validateAttachments([...d.attachments, ...incoming]);
        if (incoming.length) {
          d.attachments.push(...incoming);
          d.revision++;
        }
      } catch (err) {
        d.errors.push(errText(err));
      }
      for (const e of result?.errors ?? []) d.errors.push(e.name ? `${e.name}: ${e.message}` : e.message);
    });
  },
  /** Run attachment work with the composer's "Preparing…" state. */
  async prepare<T>(key: string, work: () => Promise<T>): Promise<T | undefined> {
    if (getDraft(key).sending) return undefined;
    edit(key, (d) => void d.preparing++);
    try {
      return await work();
    } catch (err) {
      drafts.error(key, err);
      return undefined;
    } finally {
      edit(key, (d) => void d.preparing--);
    }
  },
  lock(key: string, sending: boolean) {
    edit(key, (d) => void (d.sending = sending));
  },
  clear(key: string) {
    edit(key, (d) => {
      d.text = '';
      d.attachments = [];
      d.references = [];
      d.errors = [];
      d.revision++;
    });
  },
  /** A welcome draft becomes the new session's draft. */
  rekey(from: string, to: string) {
    useDrafts.setState((st) => {
      const d = st.drafts[from];
      if (!d) return;
      delete st.drafts[from];
      st.drafts[to] = { ...d, key: to };
      if (st.active === from) st.active = to;
    });
  },
  /** Bring back an unsent message: straight into an empty draft, otherwise as Restore / Discard. */
  recover(key: string, s: Pick<DraftSubmission, 'text' | 'attachments' | 'references'> & { label?: string }) {
    edit(key, (d) => {
      if (!d.text.trim() && !d.attachments.length && !d.references.length && !d.sending && !d.preparing) {
        d.text = s.text;
        d.attachments = s.attachments.slice();
        d.references = s.references?.slice() ?? [];
        d.revision++;
      } else d.recoveries.push({ text: s.text, attachments: s.attachments.slice(), references: s.references?.slice(), label: s.label });
    });
  },
  restore(key: string, index: number) {
    edit(key, (d) => {
      if (d.text.trim() || d.attachments.length || d.references.length) return;
      const [s] = d.recoveries.splice(index, 1);
      if (!s) return;
      d.text = s.text;
      d.attachments = s.attachments.slice();
      d.references = s.references?.slice() ?? [];
      d.revision++;
    });
  },
  discard(key: string, index: number) {
    edit(key, (d) => void d.recoveries.splice(index, 1));
  },
};
