// Side chat (/btw) on the renderer side. The conversation itself lives in the agent
// host and arrives as `side` events, so the panel inside a session and a window it was
// popped out to always show the same thread. What is kept here is only where it shows.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { SideChat, SideWindow } from '@shared/protocol';
import { bridge, call, errText } from '@/lib/api';

interface SideState {
  /** Sessions whose side chat panel is open inside the session. */
  open: Record<string, boolean>;
  /** Side chats living in a window of their own. */
  windows: Record<string, { pinned: boolean }>;
}

export const useSide = create<SideState>(() => ({ open: {}, windows: {} }));

const setSide = (fn: (s: SideState) => Partial<SideState>) => useSide.setState((s) => fn(s));

/** Follow the side chat windows main reports; returns the unsubscribe. */
export function watchSideWindows() {
  const apply = (w: SideWindow & { open?: boolean; docked?: boolean }) =>
    setSide((s) => {
      const windows = { ...s.windows };
      if (w.open === false) delete windows[w.sessionId];
      else windows[w.sessionId] = { pinned: w.pinned };
      // Docking puts the chat back into its session; closing the window just closes it.
      return w.docked ? { windows, open: { ...s.open, [w.sessionId]: true } } : { windows };
    });
  void call('side:windows').then((list) => list.forEach(apply)).catch(() => {});
  return bridge.on('side:window', apply);
}

/** Show the side chat inside the session, or bring its window forward when it was popped out. */
export function showSide(sid: string) {
  if (useSide.getState().windows[sid]) return void call('side:pop', sid).catch(() => {});
  setSide((s) => ({ open: { ...s.open, [sid]: true } }));
}

export function hideSide(sid: string) {
  setSide((s) => ({ open: { ...s.open, [sid]: false } }));
}

export function popOutSide(sid: string) {
  hideSide(sid);
  void call('side:pop', sid).catch(() => {});
}

/** Back into the session it belongs to (main reports the dock to the session's window). */
export function dockSide(sid: string) {
  void call('side:dock', sid).catch(() => {});
}

/** Ask a question (from /btw); a passage selected in the conversation can go with it. */
export async function askSide(sid: string, text: string, quote?: string) {
  showSide(sid);
  await call('sessions:side', sid, { text, quote });
}

/** Open the side chat with a passage staged, ready for the question. */
export async function quoteSide(sid: string, quote: string) {
  showSide(sid);
  await call('sessions:sideStage', sid, quote);
}

const empty = (sid: string): SideChat => ({ sessionId: sid, title: '', turns: [], busy: false, quote: null });

/** The host's side conversation of a session, kept current by its events. */
export function useSideChat(sid: string): SideChat {
  const [chat, setChat] = useState<SideChat>(() => empty(sid));
  useEffect(() => {
    let live = true;
    setChat(empty(sid));
    const off = bridge.on('host:event', (ev) => {
      if (ev.type === 'side' && ev.sessionId === sid) setChat(ev.chat);
    });
    call('sessions:sideGet', sid).then((c) => live && setChat((now) => (now.turns.length || now.busy ? now : c))).catch((err) => live && setChat({ ...empty(sid), error: errText(err) }));
    return () => {
      live = false;
      off();
    };
  }, [sid]);
  return chat;
}
