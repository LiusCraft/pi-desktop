// @vitest-environment jsdom
import { invoke } from './renderer-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { SessionMeta } from '@shared/protocol';
import { normalizeShortcuts, resetShortcut, shortcutConflict, type ShortcutOverrides } from '@shared/shortcuts';
import { CommandPalette } from '@/components/dialogs/CommandPalette';
import { SessionSwitcher } from '@/components/dialogs/SessionSwitcher';
import { PermItem } from '@/components/thread/Items';
import { QuestionsItem } from '@/components/thread/Questions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipProvider } from '@/components/ui/tooltip';
import { shortcutFromEvent, shortcutLabel, useShortcutTarget } from '@/lib/shortcut-keys';
import { useShortcuts } from '@/lib/use-shortcuts';
import { ShortcutsSection } from '@/settings/ShortcutsSection';
import { getApp, setApp } from '@/store/app';
import { dialogs, useDialogs } from '@/store/dialogs';
import { drafts, sessionDraftKey } from '@/store/drafts';
import type { ItemOf, SessionView } from '@/store/types';
import { emptySession } from '@/store/transcript';
import { useState } from 'react';

const actions = vi.hoisted(() => ({
  openSession: vi.fn<(id: string) => void>(),
  setView: vi.fn<(kind: SessionMeta['kind']) => void>(),
  answerUi: vi.fn<(id: string, key: string, response: object, label: string) => void>(),
  stop: vi.fn<(id: string) => void>(),
  togglePanel: vi.fn<(id: string, panel: string) => void>(),
  requestFind: vi.fn<(scope: 'file' | 'all') => void>(),
  cycleMode: vi.fn<() => void>(),
  cycleViewMode: vi.fn<() => void>(),
  showWelcome: vi.fn<() => void>(),
  toggleSidebar: vi.fn<() => void>(),
  addProject: vi.fn<() => void>(),
}));
vi.mock('@/store/actions', () => actions);
const {
  openSession,
  setView,
  answerUi,
  stop,
  togglePanel,
  requestFind,
  cycleMode,
  cycleViewMode,
  showWelcome,
  toggleSidebar,
} = actions;

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
  const folder = useShortcutTarget('folder', 'Choose folder');
  return (
    <>
      <input aria-label="Note text" />
      <textarea aria-label="Composer" data-composer-input data-shortcut="composer" />
      <div className="xterm">
        <textarea aria-label="Terminal" />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger {...folder} data-shortcut-menu>
          Choose folder
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Local folder</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SessionSwitcher />
      <CommandPalette />
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
  useDialogs.setState({ current: null });
  vi.clearAllMocks();
});

const key = (target: HTMLElement | Window, event: KeyboardEventInit) => fireEvent.keyDown(target, event);
const ctrl = (key: string, more?: KeyboardEventInit) => ({ key, ctrlKey: true, ...more });

function showSession(s: SessionView, waiting?: ItemOf<'perm' | 'ask'>) {
  if (waiting) {
    s.waiting = waiting.key;
    s.items = [waiting];
  }
  setApp((state) => {
    state.current = s.meta.id;
    state.sessions[s.meta.id] = s;
  });
  const draft = sessionDraftKey(s.meta.id);
  drafts.clear(draft);
  drafts.activate(draft);
  return draft;
}

describe('shortcut bindings', () => {
  it('normalizes platform aliases and shifted digits, and rejects unsupported persisted bindings', () => {
    expect(
      shortcutFromEvent(
        new KeyboardEvent('keydown', { key: '!', code: 'Digit1', metaKey: true, shiftKey: true }),
        true,
      ),
    ).toBe('Mod+Shift+1');
    expect(shortcutFromEvent(new KeyboardEvent('keydown', { key: 'ø', code: 'KeyO', altKey: true }), true)).toBe(
      'Alt+O',
    );
    expect(shortcutFromEvent(new KeyboardEvent('keydown', { key: 'k', isComposing: true }), true)).toBe('');
    expect(shortcutFromEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }), false)).toBe('');
    expect(shortcutLabel('Mod+Ctrl+Alt+Shift+ArrowLeft', true)).toBe('⌘⌃⌥⇧←');
    expect(shortcutLabel('Mod+F7', true)).toBe('⌘F7');
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
    const text = screen.getByRole('textbox', { name: 'Note text' });
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

  it('routes navigation and finds without stealing terminal or modal keystrokes', () => {
    render(<Workspace />);
    const composer = screen.getByRole('textbox', { name: 'Composer' });
    const terminal = screen.getByRole('textbox', { name: 'Terminal' });
    key(terminal, ctrl('i', { altKey: true }));
    expect(document.activeElement).not.toBe(composer);
    key(window, ctrl('i', { altKey: true }));
    expect(document.activeElement).toBe(composer);
    key(composer, ctrl('c', { altKey: true }));
    expect(cycleMode).toHaveBeenCalledOnce();
    key(composer, ctrl('b', { repeat: true }));
    expect(toggleSidebar).not.toHaveBeenCalled();
    key(composer, ctrl('b'));
    expect(toggleSidebar).toHaveBeenCalledOnce();
    key(composer, ctrl('n'));
    expect(showWelcome).toHaveBeenCalledOnce();
    key(composer, ctrl(','));
    expect(invoke).toHaveBeenCalledWith('settings:open');

    act(() => showSession(fixture('Code')));
    key(composer, ctrl('d'));
    expect(togglePanel).toHaveBeenCalledWith('Code', 'diff');
    key(composer, ctrl('o'));
    expect(cycleViewMode).toHaveBeenCalledOnce();
    key(composer, ctrl('f'));
    key(composer, ctrl('F', { shiftKey: true }));
    expect(requestFind.mock.calls).toEqual([['file'], ['all']]);
    act(() => showSession(fixture('Work', { kind: 'work' })));
    key(composer, ctrl('d'));
    expect(togglePanel).toHaveBeenLastCalledWith('Work', 'progress');
    key(composer, ctrl('F', { shiftKey: true }));
    expect(requestFind).toHaveBeenCalledTimes(2);

    const decision = dialogs.confirm('Close?', 'This blocks global shortcuts.');
    key(window, ctrl('n'));
    expect(showWelcome).toHaveBeenCalledOnce();
    useDialogs.getState().current?.resolve(false);
    return expect(decision).resolves.toBe(false);
  });

  it('shows remapped palette hints and opens an empty session list from the palette', () => {
    showSession(fixture('Code', { archived: true }));
    setApp((s) => void (s.settings.shortcuts = { sessions: 'F7', panel: 'F8', settings: null }));
    render(<Workspace />);
    key(window, ctrl('k'));
    expect(screen.getByRole('option', { name: /^Toggle diff\s*F8$/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Settings…' })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /^Session list\s*F7$/ }));
    expect(screen.getByText('No matching sessions')).toBeTruthy();
    key(window, { key: 'F7' });
    expect(getApp().sessionsOpen).toBe(false);
  });

  it('only answers permissions from an empty composer or a non-editable target', () => {
    const item: ItemOf<'perm'> = {
      kind: 'perm',
      key: 'approve',
      requestId: 'ask',
      toolCallId: 'tool',
      title: 'Run a command?',
      resolved: null,
    };
    const draft = showSession(fixture('Code'), item);
    setApp((s) => void (s.settings.shortcuts = { choice2: 'F7', choice3: null }));
    render(
      <>
        <Workspace />
        <PermItem sid="Code" item={item} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Allow 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Always allow F7' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
    const composer = screen.getByRole('textbox', { name: 'Composer' });
    drafts.setText(draft, 'unfinished');
    expect(key(composer, { key: '1' })).toBe(true);
    expect(answerUi).not.toHaveBeenCalled();
    drafts.clear(draft);
    expect(key(screen.getByRole('textbox', { name: 'Note text' }), { key: '1' })).toBe(true);
    expect(key(composer, { key: '1' })).toBe(false);
    expect(answerUi).toHaveBeenCalledWith('Code', 'approve', { value: 'Allow' }, 'Allow');
    key(window, { key: '3' });
    key(window, { key: 'F7' });
    expect(answerUi).toHaveBeenCalledTimes(2);
    expect(answerUi).toHaveBeenLastCalledWith('Code', 'approve', { value: 'Always allow' }, 'Always allow');
  });

  it('does not stop on Escape until the focused control has declined it', () => {
    showSession({ ...fixture('Code'), running: true });
    render(
      <>
        <Workspace />
        <input aria-label="Suggestions" onKeyDown={(e) => e.preventDefault()} />
      </>,
    );
    key(screen.getByRole('textbox', { name: 'Suggestions' }), { key: 'Escape' });
    key(screen.getByRole('textbox', { name: 'Terminal' }), { key: 'Escape' });
    expect(stop).not.toHaveBeenCalled();
    key(screen.getByRole('textbox', { name: 'Composer' }), { key: 'Escape' });
    expect(stop).toHaveBeenCalledExactlyOnceWith('Code');
  });

  it('chooses and submits only visible, enabled question controls', () => {
    // jsdom does not implement CSS.escape; this fixture uses only selector-safe request keys.
    const originalCSS = globalThis.CSS;
    vi.stubGlobal('CSS', { escape: (value: string) => value });
    onTestFinished(() => vi.stubGlobal('CSS', originalCSS));
    const item: ItemOf<'ask'> = {
      kind: 'ask',
      key: 'questions',
      requestId: 'ask',
      resolved: null,
      request: {
        kind: 'questions',
        id: 'ask',
        title: 'Choose',
        toolCallId: 'tool',
        questions: [
          {
            question: 'Which format?',
            header: 'Format',
            multiSelect: false,
            options: [{ label: 'Markdown' }, { label: 'Plain text' }],
          },
          {
            question: 'Which sections?',
            header: 'Sections',
            multiSelect: true,
            options: [{ label: 'Summary' }, { label: 'Details' }],
          },
        ],
      },
    };
    showSession(fixture('Work', { kind: 'work' }), item);
    setApp((s) => void (s.settings.shortcuts = { choice1: 'F7', choice2: null }));
    render(
      <TooltipProvider>
        <Workspace />
        <div data-shortcut-request={item.key}>
          <QuestionsItem sid="Work" item={item} />
        </div>
      </TooltipProvider>,
    );
    const next = () => key(window, { key: 'Enter', altKey: true });
    expect(screen.getByRole('radio', { name: /^Markdown\s*F7$/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Plain text' })).toBeTruthy();
    expect(next()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse questions' }));
    expect(key(window, { key: 'F7' })).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Expand questions' }));
    expect(key(window, { key: 'F7' })).toBe(false);
    expect(screen.getByRole('radio', { name: /^Markdown\s*F7$/, checked: true })).toBeTruthy();
    expect(next()).toBe(false);
    expect(screen.getByRole('checkbox', { name: /^Summary\s*F7$/ })).toBeTruthy();
    expect(next()).toBe(true);
    key(window, { key: 'F7' });
    expect(next()).toBe(false);
    expect(answerUi).toHaveBeenCalledWith(
      'Work',
      'questions',
      {
        answers: [{ selected: ['Markdown'] }, { selected: ['Summary'] }],
      },
      'Answered',
    );
  });
});
