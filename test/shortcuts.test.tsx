// @vitest-environment jsdom
import './renderer-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionMeta } from '@shared/protocol';
import { normalizeShortcuts, resetShortcut, shortcutConflict, type ShortcutOverrides } from '@shared/shortcuts';
import { SessionSwitcher } from '@/components/dialogs/SessionSwitcher';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipProvider } from '@/components/ui/tooltip';
import { shortcutFromEvent } from '@/lib/shortcut-keys';
import { useShortcuts } from '@/lib/use-shortcuts';
import { ShortcutsSection } from '@/settings/ShortcutsSection';
import { getApp, setApp } from '@/store/app';
import { emptySession } from '@/store/transcript';
import { useState } from 'react';

const { openSession, setView } = vi.hoisted(() => ({
  openSession: vi.fn<(id: string) => void>(),
  setView: vi.fn<(kind: SessionMeta['kind']) => void>(),
}));
vi.mock('@/store/actions', () => ({ openSession, setView }));

function fixture(id: string, extra: Partial<SessionMeta> = {}) {
  return emptySession({
    id,
    title: id,
    kind: 'code',
    projectPath: '/project',
    cwd: '/project',
    autoName: false,
    titleLocked: false,
    autoNamed: false,
    nameAttempted: false,
    branch: null,
    baseBranch: null,
    baseCommit: null,
    worktree: false,
    mode: 'auto',
    outputStyle: 'default',
    sessionFile: null,
    createdAt: 1,
    updatedAt: 1,
    pr: null,
    ...extra,
  });
}

function Workspace() {
  useShortcuts();
  return (
    <>
      <input aria-label="Note text" />
      <DropdownMenu>
        <DropdownMenuTrigger data-shortcut="folder" data-shortcut-menu>
          Choose folder
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Local folder</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SessionSwitcher />
    </>
  );
}

beforeEach(() => {
  setApp((s) => {
    s.current = null;
    s.paletteOpen = false;
    s.sessionsOpen = false;
    s.settings = {};
    s.sessions = {};
  });
  vi.clearAllMocks();
});

const key = (target: HTMLElement | Window, event: KeyboardEventInit) => fireEvent.keyDown(target, event);

describe('shortcut bindings', () => {
  it('normalizes platform aliases and shifted digits, and rejects unsupported persisted bindings', () => {
    expect(
      shortcutFromEvent(
        new KeyboardEvent('keydown', { key: '!', code: 'Digit1', metaKey: true, shiftKey: true }),
        true,
      ),
    ).toBe('Mod+Shift+1');
    expect(shortcutConflict({}, 'work', 'Ctrl+K', false)).toBe('palette');
    expect(shortcutConflict({}, 'work', 'Ctrl+K', true)).toBeUndefined();
    expect(normalizeShortcuts({ work: 'T', folder: 'Mod+Alt+L', palette: null, bogus: 'F7' })).toEqual({
      folder: 'Mod+Alt+L',
      palette: null,
    });
    expect(resetShortcut({ palette: 'F6', work: 'Mod+K' }, 'palette', false)).toEqual({ work: null });
  });

  it('records, displays conflicts, and restores one or all defaults', async () => {
    const save = vi.fn<(value: ShortcutOverrides) => void>();
    function Settings() {
      const [overrides, setOverrides] = useState<ShortcutOverrides>({});
      return (
        <ShortcutsSection
          overrides={overrides}
          onSave={async (value) => {
            save(value);
            setOverrides(value);
          }}
        />
      );
    }
    render(<Settings />, { wrapper: TooltipProvider });
    const edit = screen.getByRole('button', { name: 'Switch to Work: Ctrl+Shift+1' });
    fireEvent.click(edit);
    key(edit, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('alert').textContent).toContain('Open command palette');
    key(edit, { key: 'F7' });
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ work: 'F7' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Restore default: Switch to Work' }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restore default: Switch to Work' }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({}));
    const clear = screen.getByRole('button', { name: 'Remove shortcut: Switch to Code' });
    await waitFor(() => expect(clear.hasAttribute('disabled')).toBe(false));
    fireEvent.click(clear);
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ code: null }));
    const resetAll = screen.getByRole('button', { name: 'Restore all defaults' });
    await waitFor(() => expect(resetAll.hasAttribute('disabled')).toBe(false));
    fireEvent.click(resetAll);
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({}));
  });

  it('switches views, opens a real composer menu, and reads remapped bindings immediately', async () => {
    render(<Workspace />);
    const text = screen.getByRole('textbox');
    key(text, { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true });
    expect(setView).toHaveBeenLastCalledWith('work');
    key(text, { key: '@', code: 'Digit2', ctrlKey: true, shiftKey: true });
    expect(setView).toHaveBeenLastCalledWith('code');
    key(text, { key: 'l', ctrlKey: true, altKey: true });
    expect(await screen.findByRole('menuitem', { name: 'Local folder' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Local folder' }));
    act(() => setApp((s) => void (s.settings.shortcuts = { work: 'F7' })));
    key(text, { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true });
    expect(setView).toHaveBeenCalledTimes(2);
    key(text, { key: 'F7' });
    expect(setView).toHaveBeenLastCalledWith('work');
  });

  it('groups sessions by attention and merge state, then sorts by replies rather than activity', async () => {
    const entries = [
      fixture('No reply', { updatedAt: 999 }),
      fixture('Unread work', { kind: 'work', lastResponseAt: 2 }),
      fixture('Older reply', { lastResponseAt: 10, updatedAt: 777 }),
      fixture('Newer reply', { lastResponseAt: 20 }),
      fixture('Merged', { lastResponseAt: 30, pr: { num: 1, url: '', state: 'merged', draft: false } }),
      fixture('Archived', { lastResponseAt: 50, archived: true }),
    ];
    entries[1].unread = true;
    setApp((s) => void (s.sessions = Object.fromEntries(entries.map((entry) => [entry.meta.id, entry]))));
    render(<Workspace />);
    key(window, { key: 'K', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('dialog', { name: 'Session list' })).toBeTruthy();
    expect(screen.getAllByRole('option').map((item) => item.getAttribute('data-value'))).toEqual([
      'Unread work',
      'Newer reply',
      'Older reply',
      'No reply',
      'Merged',
    ]);
    const search = screen.getByRole('combobox');
    fireEvent.change(search, { target: { value: 'older code' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    key(search, { key: 'Enter' });
    expect(openSession).toHaveBeenCalledWith('Older reply');
    expect(getApp().sessionsOpen).toBe(false);
  });
});
