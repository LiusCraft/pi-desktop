// What the app remembers about a session's view: which cards were open, and where the
// conversation was scrolled to when the user switched away.
import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '../src/shared/protocol';
import { DEFAULT_PANELS, forgetPanels, readPanels, writePanels } from '../src/renderer/src/store/layout';
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
    forgetPanels('gone');
    expect(readPanels('gone')).toEqual(DEFAULT_PANELS);
  });

  it('hydrates a new session view from the stored layout', () => {
    writePanels(meta.id, { ...DEFAULT_PANELS, preview: true });
    expect(emptySession(meta).panels.preview).toBe(true);
    expect(emptySession(meta).expanded).toBeNull();
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
