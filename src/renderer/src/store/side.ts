// The host owns side chats. The renderer only decides where to display them.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import { sideWindowKey, type SideChat, type SideChatSummary, type SideWindow } from '@shared/protocol';
import { bridge, call, canTerminal, errText } from '@/lib/api';
import { getApp, updateSession } from './app';
import { closeWorkspaceTab, isSideChatTab, sideChatId, sideChatTab } from './layout';
import { subscribeResource } from './resources';

export const useSide = create<{ windows: Record<string, { pinned: boolean }> }>(() => ({ windows: {} }));

function openSideTab(sid: string, chatId: string) {
  const tab = sideChatTab(chatId);
  updateSession(sid, (s) => {
    if (!s.sideTabs.includes(tab)) s.sideTabs.push(tab);
    s.activeTab = tab;
  });
}

export function hideSide(sid: string, chatId: string) {
  const tab = sideChatTab(chatId);
  updateSession(sid, (s) =>
    closeWorkspaceTab(s, tab, canTerminal, () => {
      s.sideTabs = s.sideTabs.filter((t) => t !== tab);
    }),
  );
}

/** Follow the side chat windows main reports; returns the unsubscribe. */
export function watchSideWindows() {
  let live = true;
  const changed = new Set<string>();
  const apply = ({ sessionId, chatId, pinned, open, docked }: SideWindow & { open?: boolean; docked?: boolean }) => {
    const key = sideWindowKey(sessionId, chatId);
    useSide.setState((s) => {
      const windows = { ...s.windows };
      if (open === false) delete windows[key];
      else windows[key] = { pinned };
      return { windows };
    });
    if (docked) openSideTab(sessionId, chatId);
    else if (open) hideSide(sessionId, chatId);
  };
  const off = bridge.on('side:window', (event) => {
    changed.add(sideWindowKey(event.sessionId, event.chatId));
    apply(event);
  });
  void call('side:windows')
    .then((list) => {
      if (live) list.filter((w) => !changed.has(sideWindowKey(w.sessionId, w.chatId))).forEach(apply);
    })
    .catch(() => {});
  return () => {
    live = false;
    off();
  };
}

export async function openSide(sid: string, chatId: string) {
  if (useSide.getState().windows[sideWindowKey(sid, chatId)]) await call('side:pop', sid, chatId);
  else openSideTab(sid, chatId);
}

export async function createSide(sid: string) {
  const chat = await call('sessions:sideCreate', sid);
  await openSide(sid, chat.id);
  return chat.id;
}

// Concurrent /btw and selection requests should not both create the first thread.
const opening = new Map<string, Promise<string>>();
export async function showSide(sid: string) {
  const tab = getApp().sessions[sid]?.activeTab ?? null;
  if (isSideChatTab(tab)) return sideChatId(tab);
  const pending = opening.get(sid);
  if (pending) return pending;
  const resolving = (async () => {
    const chat = (await call('sessions:sideList', sid)).at(-1);
    if (!chat) return createSide(sid);
    await openSide(sid, chat.id);
    return chat.id;
  })();
  opening.set(sid, resolving);
  try {
    return await resolving;
  } finally {
    opening.delete(sid);
  }
}

/** /btw and selected passages use the open thread, or create the first thread. */
export async function askSide(sid: string, text: string, quote?: string) {
  const chatId = await showSide(sid);
  await call('sessions:side', sid, chatId, { text, quote });
}

const EMPTY_LIST: SideChatSummary[] = [];
export function useSideList(sid: string, enabled = true) {
  const [result, setResult] = useState<{ sid: string; chats: SideChatSummary[]; error: string | null }>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let revision = 0;
    function load() {
      const request = ++revision;
      const apply = (chats: SideChatSummary[], error: string | null) => {
        if (live && request === revision) setResult({ sid, chats, error });
      };
      void call('sessions:sideList', sid).then(
        (chats) => apply(chats, null),
        (err) => apply(EMPTY_LIST, errText(err)),
      );
    }
    const off = subscribeResource('sideChats', load);
    const offHost = bridge.on('host:event', (event) => {
      if (event.type === 'host_exit') {
        revision++;
        setResult({ sid, chats: EMPTY_LIST, error: null });
      }
    });
    load();
    return () => {
      live = false;
      off();
      offHost();
    };
  }, [sid, enabled]);
  return result?.sid === sid ? result : { chats: EMPTY_LIST, error: null };
}

export function reportSideError(err: unknown) {
  toast.error(errText(err));
}

const empty = (sid: string, id: string): SideChat => ({
  sessionId: sid,
  id,
  title: '',
  turns: [],
  busy: false,
  quote: null,
});

export function useSideChat(sid: string, chatId: string): SideChat {
  const [chat, setChat] = useState<SideChat>(() => empty(sid, chatId));
  useEffect(() => {
    let live = true;
    let received = false;
    const off = bridge.on('host:event', (ev) => {
      if (ev.type === 'side' && ev.sessionId === sid && ev.chat.id === chatId) {
        received = true;
        setChat(ev.chat);
      }
      if (ev.type === 'host_exit') {
        received = true;
        setChat((now) => ({ ...now, busy: false }));
      }
    });
    void call('sessions:sideGet', sid, chatId).then(
      (c) => {
        if (live && !received) setChat(c);
      },
      (err) => {
        if (live && !received) setChat({ ...empty(sid, chatId), error: errText(err) });
      },
    );
    return () => {
      live = false;
      off();
    };
  }, [sid, chatId]);
  return chat;
}
