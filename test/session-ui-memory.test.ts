// What the app remembers about a session's view: which tabs were open, and where the
// conversation was scrolled to when the user switched away.
import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '../src/shared/protocol';
import {
  DEFAULT_PANELS,
  forgetPanels,
  openWorkspaceTabs,
  readPanels,
  readWorkspaceTab,
  selectedWorkspaceTab,
  writePanels,
  writeWorkspaceTab,
} from '../src/renderer/src/store/layout';
import { forgetScroll, rememberScroll, savedScroll } from '../src/renderer/src/store/scroll';
import { emptySession } from '../src/renderer/src/store/transcript';

const meta = { id: 's1', title: 'Main', kind: 'code', projectPath: '/p', cwd: '/p' } as SessionMeta;

describe('panel memory', () => {
  it('opens a session with the default layout when nothing was saved', () => {
    expect(readPanels('never-opened')).toEqual(DEFAULT_PANELS);
  });

  it('returns the layout a session was left with', () => {
    writePanels('kept', { ...DEFAULT_PANELS, diff: true, terminal: true, progress: false });
    expect(readPanels('kept')).toEqual({ ...DEFAULT_PANELS, diff: true, terminal: true, progress: false });
  });

  it('keeps layouts apart per session', () => {
    writePanels('a', { ...DEFAULT_PANELS, diff: true });
    writePanels('b', { ...DEFAULT_PANELS, files: true });
    expect(readPanels('a').diff).toBe(true);
    expect(readPanels('a').files).toBe(false);
    expect(readPanels('b').files).toBe(true);
    expect(readPanels('b').diff).toBe(false);
  });

  it('hands out copies, so a draft cannot rewrite storage', () => {
    const panels = readPanels('copy');
    panels.diff = true;
    expect(readPanels('copy').diff).toBe(false);
  });

  it('forgets a deleted session', () => {
    writePanels('gone', { ...DEFAULT_PANELS, diff: true });
    writeWorkspaceTab('gone', 'diff');
    forgetPanels('gone');
    expect(readPanels('gone')).toEqual(DEFAULT_PANELS);
    expect(readWorkspaceTab('gone')).toBeNull();
  });

  it('falls back to the first available tab when the saved terminal is unavailable', () => {
    const remote = emptySession({ ...meta, id: 'remote' });
    remote.panels = { ...DEFAULT_PANELS, diff: true, terminal: true };
    remote.activeTab = 'terminal';
    expect(selectedWorkspaceTab(remote, openWorkspaceTabs(remote, true))).toBe('terminal');
    expect(selectedWorkspaceTab(remote, openWorkspaceTabs(remote, false))).toBe('diff');
  });

  it('hydrates a new session view from the stored layout', () => {
    writePanels(meta.id, { ...DEFAULT_PANELS, diff: true, preview: true });
    writeWorkspaceTab(meta.id, 'preview');
    writeWorkspaceTab(meta.id, 'detail');
    const session = emptySession(meta);
    const tabs = openWorkspaceTabs(session, true);
    expect(tabs).toEqual(['diff', 'preview']);
    expect(selectedWorkspaceTab(session, tabs)).toBe('preview');
    expect(session.workspaceExpanded).toBe(false);
  });
});

describe('scroll memory', () => {
  it('has nothing to restore the first time', () => {
    expect(savedScroll('fresh')).toBeNull();
  });

  it('remembers where the user stopped reading', () => {
    rememberScroll('read', { top: 400, stick: false });
    expect(savedScroll('read')).toEqual({ top: 400, stick: false });
  });

  it('follows the newest message again once the session moved on', () => {
    rememberScroll('moved', { top: 40, stick: false });
    forgetScroll('moved');
    expect(savedScroll('moved')).toBeNull();
  });

  it('keeps sessions apart', () => {
    rememberScroll('x', { top: 1, stick: false });
    rememberScroll('y', { top: 2, stick: true });
    expect(savedScroll('x')?.top).toBe(1);
    expect(savedScroll('y')?.stick).toBe(true);
  });
});
