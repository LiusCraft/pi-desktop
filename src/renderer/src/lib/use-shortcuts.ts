import { useEffect } from 'react';
import { PERMISSION_CHOICES } from '@shared/protocol';
import {
  CHOICE_SHORTCUTS,
  SHORTCUT_ACTIONS,
  platformBinding,
  shortcutFor,
  type ShortcutAction,
} from '@shared/shortcuts';
import { call, isMac } from '@/lib/api';
import {
  answerUi,
  cycleMode,
  cycleViewMode,
  requestFind,
  setView,
  showWelcome,
  stop,
  togglePanel,
  toggleSidebar,
} from '@/store/actions';
import { currentSession, getApp, setApp } from '@/store/app';
import { useDialogs } from '@/store/dialogs';
import { activeDraft } from '@/store/drafts';
import { bashRunning } from '@/store/transcript';
import { shortcutFromEvent } from './shortcut-keys';

function activate(element: HTMLElement | null) {
  if (!element || element.closest(':disabled,[aria-disabled=true],[inert],[hidden]')) return false;
  element.focus();
  if (element.hasAttribute('data-shortcut-menu')) {
    // Radix dropdown triggers open on ArrowDown, not a programmatic click.
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  } else if (!element.matches('[data-composer-input]')) element.click();
  return true;
}

export function handleShortcut(e: KeyboardEvent) {
  if (e.defaultPrevented) return;
  const pressed = platformBinding(shortcutFromEvent(e, isMac), isMac);
  if (!pressed) return;
  const state = getApp();
  const action = SHORTCUT_ACTIONS.find((id) => {
    const key = shortcutFor(state.settings.shortcuts, id);
    return key && platformBinding(key, isMac) === pressed;
  });
  if (!action) return;
  const target = e.target instanceof HTMLElement ? e.target : null;
  const inTerminal = target?.closest('.xterm');
  const toggle = (key: 'paletteOpen' | 'sessionsOpen') => setApp((s) => void (s[key] = !s[key]));
  let perform: (() => unknown) | undefined;
  if (state.paletteOpen || state.sessionsOpen) {
    if (action === 'palette' && state.paletteOpen) perform = () => toggle('paletteOpen');
    if (action === 'sessions' && state.sessionsOpen) perform = () => toggle('sessionsOpen');
  } else if (
    !useDialogs.getState().current &&
    !document.querySelector('[role=menu],[role=dialog],[role=alertdialog]')
  ) {
    const session = currentSession();
    const waiting = session?.waiting && session.items.find((item) => item.key === session.waiting);
    if (action === 'palette') perform = () => toggle('paletteOpen');
    else if (action === 'sessions') perform = () => toggle('sessionsOpen');
    else if (action === 'work' || action === 'code') perform = () => setView(action);
    else if (!inTerminal) {
      const choice = CHOICE_SHORTCUTS.findIndex((id) => id === action);
      const bareDigit = /^\d$/.test(pressed);
      const insideComposer = target?.matches('[data-composer-input]');
      const canChoose =
        !bareDigit ||
        (insideComposer
          ? !activeDraft()?.text
          : !target?.closest('input,textarea,select,[contenteditable]:not([contenteditable=false])'));
      if (action === 'sidebar') perform = toggleSidebar;
      else if (action === 'settings') perform = () => call('settings:open');
      else if (action === 'newSession') perform = showWelcome;
      else if (action === 'cycleMode' && document.querySelector('[data-composer-input]')) perform = cycleMode;
      else if (action === 'stop' && session && (session.running || session.compacting || bashRunning(session))) {
        perform = () => stop(session.meta.id);
      } else if (action === 'view' && session) perform = cycleViewMode;
      else if ((action === 'findAll' || action === 'findFile') && session?.meta.kind === 'code') {
        if (!target?.closest('[data-panel-find]')) perform = () => requestFind(action === 'findAll' ? 'all' : 'file');
      } else if (action === 'panel' && session) {
        perform = () => togglePanel(session.meta.id, session.meta.kind === 'work' ? 'progress' : 'diff');
      } else if (choice >= 0 || action === 'questionNext') {
        if (canChoose && waiting && session) {
          const value = PERMISSION_CHOICES[choice];
          if (waiting.kind === 'perm' && waiting.requestId && value) {
            perform = () => answerUi(session.meta.id, waiting.key, { value }, value);
          } else if (waiting.kind === 'ask') {
            const root = document.querySelector(`[data-shortcut-request="${CSS.escape(waiting.key)}"]`);
            const button = shortcutElement(action, root);
            if (button) perform = () => activate(button);
          }
        }
      } else {
        const button = shortcutElement(action, document);
        if (button) perform = () => activate(button);
      }
    }
  }
  if (!perform) return;
  e.preventDefault();
  e.stopPropagation();
  if (!e.repeat) void perform();
}

function shortcutElement(action: ShortcutAction, root: ParentNode | null) {
  return root?.querySelector<HTMLElement>(`[data-shortcut="${action}"]:not(:disabled):not([inert] *)`) ?? null;
}

export function useShortcuts() {
  useEffect(() => {
    // Let the composer dismiss suggestions and menus handle Escape before stopping a turn.
    const capture = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') handleShortcut(e);
    };
    const bubble = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleShortcut(e);
    };
    window.addEventListener('keydown', capture, true);
    window.addEventListener('keydown', bubble);
    return () => {
      window.removeEventListener('keydown', capture, true);
      window.removeEventListener('keydown', bubble);
    };
  }, []);
}
