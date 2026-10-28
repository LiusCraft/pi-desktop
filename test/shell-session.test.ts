// The shell that stays alive between the model's commands: a `cd` (or an `export`) has to be
// there for the next command, the output of both streams has to reach the model in order, and a
// command that hangs must not take the session with it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SharedShell, ShellCommands, commandInFolder, msysToWindows, resolveBash } from '../src/agent/shell-session';

const bash = resolveBash();
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-shell-test-'));
const shells: SharedShell[] = [];

function open() {
  const shell = new SharedShell(bash!);
  shells.push(shell);
  return shell;
}

/** Run one command and collect everything the model would have seen. */
async function run(shell: SharedShell, command: string, cwd = folder, extra: { timeoutMs?: number; timeoutText?: number } = {}) {
  let out = '';
  const { exitCode } = await shell.run(command, cwd, { onData: (chunk) => (out += chunk.toString('utf8')), ...extra });
  return { exitCode, out };
}

/** Git Bash spells a folder `C:/…` where node says `C:\…`, and may keep its 8.3 name: compare folders, not text. */
const canonical = (folder: string) => {
  const full = fs.realpathSync.native(folder.trim());
  return process.platform === 'win32' ? full.toLowerCase() : full;
};

afterEach(() => {
  for (const shell of shells.splice(0)) shell.dispose();
});

describe.skipIf(!bash)('SharedShell', () => {
  it('starts in the folder it was given and reports where it is', async () => {
    const shell = open();
    const { exitCode, out } = await run(shell, 'pwd');
    expect(exitCode).toBe(0);
    // The shell prints its own spelling of the folder; the marker carries it back in the same one.
    expect(canonical(out)).toBe(canonical(folder));
    expect(canonical(shell.cwd!)).toBe(canonical(folder));
  });

  it('keeps the folder a cd moved to', async () => {
    const shell = open();
    fs.mkdirSync(path.join(folder, 'sub'), { recursive: true });
    expect((await run(shell, 'cd sub')).exitCode).toBe(0);
    const next = await run(shell, 'basename "$PWD"');
    expect(next.out.trim()).toBe('sub');
  });

  it('keeps exported variables', async () => {
    const shell = open();
    await run(shell, 'export PI_TEST_VALUE=carried');
    expect((await run(shell, 'printf %s "$PI_TEST_VALUE"')).out).toBe('carried');
  });

  it('reports the exit code of the last command', async () => {
    const shell = open();
    expect((await run(shell, 'false')).exitCode).toBe(1);
    expect((await run(shell, 'sh -c "exit 7"')).exitCode).toBe(7);
    expect((await run(shell, 'echo still-here')).out).toBe('still-here\n');
  });

  it('runs multi-line commands, heredocs included', async () => {
    const shell = open();
    const { out } = await run(shell, 'for i in 1 2; do\n  echo "n$i"\ndone\ncat <<EOF\nheredoc\nEOF');
    expect(out).toBe('n1\nn2\nheredoc\n');
  });

  it('leaves no newline of its own between the output and the marker', async () => {
    const shell = open();
    expect((await run(shell, 'printf none')).out).toBe('none');
  });

  it('interleaves both streams as the command wrote them', async () => {
    const shell = open();
    const { out } = await run(shell, 'echo one; echo two >&2; echo three');
    expect(out).toBe('one\ntwo\nthree\n');
  });

  it('runs a command in a folder without moving the shell', async () => {
    const shell = open();
    fs.mkdirSync(path.join(folder, 'elsewhere'), { recursive: true });
    const moved = await run(shell, commandInFolder('basename "$PWD"', path.join(folder, 'elsewhere')));
    expect(moved.out).toBe('elsewhere\n');
    expect((await run(shell, 'basename "$PWD"')).out).toBe(`${path.basename(folder)}\n`);
  });

  it('kills a command that runs past its timeout and comes back with a fresh shell', async () => {
    const shell = open();
    await expect(run(shell, 'sleep 30', folder, { timeoutMs: 200, timeoutText: 0.2 })).rejects.toThrow('timeout:0.2');
    // The next command still works: the killed shell was replaced.
    expect((await run(shell, 'echo back')).out).toBe('back\n');
  });

  it('stops a command on abort', async () => {
    const shell = open();
    const controller = new AbortController();
    const pending = shell.run('sleep 30', folder, { onData: () => {}, signal: controller.signal });
    setTimeout(() => controller.abort(), 150);
    await expect(pending).rejects.toThrow('aborted');
    expect((await run(shell, 'echo back')).out).toBe('back\n');
  });

  it('reports a shell that exits under it, and starts another for the next command', async () => {
    const shell = open();
    // `exit` ends the shell itself, so the marker never comes back: the exit code is the command's.
    const ended = await run(shell, 'exit 0');
    expect(ended.exitCode).toBe(0);
    expect(ended.out).toMatch(/The shell ended here/);
    expect((await run(shell, 'echo again')).out).toBe('again\n');
  });
});

describe('paths', () => {
  it('turns the folder Git Bash reports into a Windows path', () => {
    // `pwd` under Git Bash says /c/Users/me/project; spawning there needs C:/Users/me/project.
    expect(msysToWindows('/c/Users/me/project')).toBe('C:/Users/me/project');
    expect(msysToWindows('/d/program Files/Git')).toBe('D:/program Files/Git');
    expect(msysToWindows('/home/me')).toBe('/home/me');
  });

  it('wraps a workdir command in a subshell, quoting the folder', () => {
    expect(commandInFolder('ls', "/tmp/it's")).toBe("( cd -- '/tmp/it'\\''s' || exit;\nls\n)");
  });
});

describe('ShellCommands', () => {
  it('runs commands on their own in `command` mode, so a cd does not carry over', async () => {
    const commands = new ShellCommands({ mode: () => 'command' });
    const collect = () => {
      let out = '';
      return { onData: (chunk: Buffer) => (out += chunk.toString('utf8')), read: () => out };
    };
    fs.mkdirSync(path.join(folder, 'sub'), { recursive: true });

    const first = collect();
    await commands.operations.exec('cd sub', folder, first);
    // A different process, so it starts back in the session folder.
    const second = collect();
    await commands.operations.exec('basename "$PWD"', folder, second);
    expect(second.read().trim()).toBe(path.basename(folder));
    commands.dispose();
  });

  it.skipIf(process.platform === 'win32')('falls back to one process per command when the shared shell will not answer', async () => {
    // A "bash" that exits instead of reading commands: the marker never comes back.
    const fake = path.join(folder, 'fake-bash.sh');
    fs.writeFileSync(fake, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const commands = new ShellCommands({ shellPath: () => fake, mode: () => 'session' });
    const result = await commands.operations.exec('echo hi', folder, { onData: () => {} });
    // The command still ran: through pi's own one-process-per-command backend.
    expect(result.exitCode).toBe(0);
    expect(commands.takeStartFailure()).toMatch(/did not answer|could not start|exited/);
    commands.dispose();
  });

  it('keeps the folder in `session` mode', async () => {
    const commands = new ShellCommands({ mode: () => 'session' });
    const collect = () => {
      let out = '';
      return { onData: (chunk: Buffer) => (out += chunk.toString('utf8')), read: () => out };
    };
    fs.mkdirSync(path.join(folder, 'sub'), { recursive: true });
    await commands.operations.exec('cd sub', folder, collect());
    const next = collect();
    await commands.operations.exec('basename "$PWD"', folder, next);
    expect(next.read().trim()).toBe('sub');
    commands.dispose();
  });
});
