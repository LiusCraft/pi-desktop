import { platformBinding, shortcutFor, type ShortcutAction } from '@shared/shortcuts';
import { isMac } from '@/lib/api';
import { useApp } from '@/store/app';

/** Option and Shift can change the reported character (e.g. Shift+1 → !). */
export function shortcutFromEvent(e: KeyboardEvent, mac: boolean): string {
  if (e.isComposing || e.getModifierState('AltGraph') || (!mac && e.metaKey)) return '';
  let key = e.key;
  if (e.altKey || e.shiftKey) {
    if (!/^[a-z0-9]$/i.test(key) && /^(Key[A-Z]|Digit[0-9])$/.test(e.code)) key = e.code.slice(-1);
    if (e.code === 'Comma') key = ',';
    if (e.code === 'Period') key = '.';
    if (e.code === 'Slash') key = '/';
    if (e.code === 'Semicolon') key = ';';
  }
  if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  return [
    e.metaKey || (!mac && e.ctrlKey) ? 'Mod' : '',
    mac && e.ctrlKey ? 'Ctrl' : '',
    e.altKey ? 'Alt' : '',
    e.shiftKey ? 'Shift' : '',
    key,
  ]
    .filter(Boolean)
    .join('+');
}

export function shortcutLabel(binding: string, mac = isMac) {
  if (!mac) return platformBinding(binding, false).replace('Escape', 'Esc').replace('Arrow', '');
  const symbols: Record<string, string> = {
    Mod: '⌘',
    Ctrl: '⌃',
    Alt: '⌥',
    Shift: '⇧',
    Enter: '↵',
    Escape: 'Esc',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };
  return binding
    .split('+')
    .map((part) => symbols[part] ?? part)
    .join('');
}

export function useShortcutHint(action: ShortcutAction, title?: string) {
  const binding = useApp((s) => shortcutFor(s.settings.shortcuts, action));
  const hint = binding ? shortcutLabel(binding) : '';
  return title && hint ? `${title}  ${hint}` : (title ?? hint);
}

export function useShortcutTarget(action: ShortcutAction, label: string) {
  const binding = useApp((s) => shortcutFor(s.settings.shortcuts, action));
  return {
    'data-shortcut': action,
    'aria-keyshortcuts': binding?.replace(/^Mod\+/, isMac ? 'Meta+' : 'Control+').replace('Ctrl+', 'Control+'),
    title: binding ? `${label}  ${shortcutLabel(binding)}` : label,
  };
}
