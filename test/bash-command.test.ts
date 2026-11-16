// `!command` in the composer: what the message asks to run, and how the transcript shows the result.
import { beforeAll, describe, expect, it } from 'vitest';
import { setActiveLocale } from '../src/shared/i18n/runtime';
import type { SessionMeta } from '../src/shared/protocol';
import { bashCommand } from '../src/renderer/src/lib/bash';
import { applyPiEvent, bashRunning, emptySession, replay } from '../src/renderer/src/store/transcript';
import type { Item, ItemOf } from '../src/renderer/src/store/types';

const meta = { id: 's1', title: 'Main', kind: 'code', projectPath: '/p', cwd: '/p' } as SessionMeta;
const shells = (items: Item[]) => items.flatMap((i) => (i.kind === 'bash' ? [i] : []));

describe('bashCommand', () => {
  it('runs everything after the prefix, keeping the command as typed', () => {
    expect(bashCommand('!ls -la')).toEqual({ command: 'ls -la', excludeFromContext: false });
    expect(bashCommand('  !  git status ')).toEqual({ command: 'git status', excludeFromContext: false });
    // Multi-line commands keep their lines: only the space right after `!` goes.
    expect(bashCommand('!git commit -m "a\nb"\n')).toEqual({
      command: 'git commit -m "a\nb"',
      excludeFromContext: false,
    });
  });

  it('reads !! as the same command with its output kept out of the model’s context', () => {
    expect(bashCommand('!!npm test')).toEqual({ command: 'npm test', excludeFromContext: true });
  });

  it('leaves ordinary messages, and a bare prefix, to the rest of the flow', () => {
    expect(bashCommand('hello')).toBeNull();
    expect(bashCommand('hello !ls')).toBeNull();
    // The composer warns about these instead of sending them.
    expect(bashCommand('!')?.command).toBe('');
    expect(bashCommand('!!')?.command).toBe('');
  });
});

describe('a ! command in the transcript', () => {
  beforeAll(() => setActiveLocale('en'));

  it('streams the host’s updates into the item it keys them by', () => {
    const s = emptySession(meta);
    const item: ItemOf<'bash'> = { kind: 'bash', key: 'item-1', command: 'npm test', output: '', running: true, at: 1 };
    s.items.push(item);
    applyPiEvent(s, { type: 'bash_execution_update', id: 'item-1', delta: 'ok 1\n' }, 'normal');
    applyPiEvent(s, { type: 'bash_execution_update', id: 'item-1', delta: 'ok 2\n' }, 'normal');
    // An update for another item (a window that is gone) changes nothing.
    applyPiEvent(s, { type: 'bash_execution_update', id: 'gone', delta: 'x' }, 'normal');
    expect(item.output).toBe('ok 1\nok 2\n');
  });

  it('does not repeat a reply whose text landed before the command did', () => {
    const s = emptySession(meta);
    applyPiEvent(s, { type: 'message_start', message: { role: 'assistant' } }, 'normal');
    applyPiEvent(s, { type: 'message_update', assistantMessageEvent: { type: 'text_start' } }, 'normal');
    applyPiEvent(
      s,
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'All done.' } },
      'normal',
    );
    applyPiEvent(
      s,
      { type: 'message_update', assistantMessageEvent: { type: 'text_end', content: 'All done.' } },
      'normal',
    );
    // The user runs a `!` command while the turn is still finishing: its item lands between the text and
    // the message that ends the turn.
    s.items.push({ kind: 'bash', key: 'cmd-1', command: 'ls', output: '', running: true, at: 1 });
    applyPiEvent(
      s,
      {
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: 'All done.' }], timestamp: 42 },
      },
      'normal',
    );
    expect(s.items.flatMap((i) => (i.kind === 'text' ? [i.text] : []))).toEqual(['All done.']);
  });

  it('replays a recorded command with its exit code, and keeps !! marked', () => {
    const s = emptySession(meta);
    replay(
      s,
      [
        { role: 'bashExecution', command: 'ls', output: 'a\nb\n', exitCode: 0, cancelled: false, timestamp: 5 },
        { role: 'bashExecution', command: 'exit 3', output: '', exitCode: 3, cancelled: false, timestamp: 6 },
        {
          role: 'bashExecution',
          command: 'echo secret',
          output: 'secret\n',
          exitCode: 0,
          cancelled: false,
          excludeFromContext: true,
          timestamp: 7,
        },
        // Stopped from the composer, with the full output parked in a temp file.
        {
          role: 'bashExecution',
          command: 'npm test',
          output: 'partial',
          cancelled: true,
          truncated: true,
          fullOutputPath: '/tmp/pi-bash.log',
          timestamp: 8,
        },
      ],
      'normal',
    );
    const [ok, failed, hidden, stopped] = shells(s.items);
    expect(ok).toMatchObject({ command: 'ls', output: 'a\nb\n', exitCode: 0, running: false, excluded: false });
    expect(failed).toMatchObject({ exitCode: 3, cancelled: false });
    expect(hidden).toMatchObject({ excluded: true });
    expect(stopped).toMatchObject({ cancelled: true, truncated: true, fullOutputPath: '/tmp/pi-bash.log' });
    expect(stopped.exitCode).toBeUndefined();
  });

  it('knows while a command is still running, so Stop stays available', () => {
    const s = emptySession(meta);
    expect(bashRunning(s)).toBe(false);
    s.items.push({ kind: 'bash', key: 'cmd-1', command: 'npm run dev', output: '', running: true, at: 1 });
    expect(bashRunning(s)).toBe(true);
    (s.items[0] as ItemOf<'bash'>).running = false;
    expect(bashRunning(s)).toBe(false);
  });
});
