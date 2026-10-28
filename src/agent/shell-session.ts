// A shell that stays alive between the model's commands.
//
// pi's shell tool spawns one process per call, so a `cd` (or an `export`) in one command is gone
// by the next: every command starts again in the session folder. This keeps one shell per session
// and drives it over stdin, the way Claude Code does, so the folder the model `cd`-ed into is
// where the next command runs.
//
// The protocol is one line per command. The command itself goes into a temp script (a stray quote
// or an unterminated heredoc in it then fails as a syntax error instead of swallowing the next
// protocol line), the shell sources that script with stdin closed, and then prints a single marker
// line carrying the exit code and the folder it ended up in:
//
//     . '/tmp/…/cmd-3.sh' </dev/null; __pi_ec=$?; printf '\n__PI_DONE__<id> %s %s\n' "$__pi_ec" "$PWD"
//
// Both stdout and stderr end up on one pipe (`exec 2>&1` before the shell starts), so what the
// model sees is in the order the command wrote it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createLocalBashOperations, type BashOperations } from '@earendil-works/pi-coding-agent';
import type { ShellSessionMode } from '@shared/protocol';
import { realBashDir } from './env';

/** Prefix of the line that ends one command's output; `<id>` makes it unique per command. */
const MARKER = '__PI_DONE__';
/** Bytes held back from the output while the marker may be arriving in pieces. */
const HOLD_BACK = 64;
/** How long a fresh shell gets to answer its first marker before we give up on it. */
const START_TIMEOUT_MS = 8_000;
const NEWLINE = 0x0a;

export interface ShellRun {
  onData: (chunk: Buffer) => void;
  /** Milliseconds; pi's shell tools hand us seconds, converted by the caller. */
  timeoutMs?: number;
  /** The timeout in seconds, as pi spells it in its own timeout errors. */
  timeoutText?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

/** The shared shell could not start; the caller falls back to one process per command. */
export class ShellStartError extends Error {}

interface Exchange {
  marker: Buffer;
  onData: (chunk: Buffer) => void;
  pending: Buffer;
  timer?: ReturnType<typeof setTimeout>;
  unwatch?: () => void;
  resolve: (done: { exitCode: number; cwd?: string }) => void;
  reject: (err: Error) => void;
}

const exists = (file: string) => {
  try { return fs.statSync(file).isFile(); } catch { return false; }
};

/** A path a POSIX shell can open, also from Git Bash on Windows (`C:\x` reads as an escape). */
const shellPath = (file: string) => (process.platform === 'win32' ? file.replace(/\\/g, '/') : file);

/**
 * Git Bash reports `$PWD` as an MSYS path (`/c/Users/…`) and takes `-c` commands in that spelling,
 * but a Windows spawn wants `C:/Users/…`.
 */
export const msysToWindows = (folder: string) =>
  /^\/[a-zA-Z](\/|$)/.test(folder) ? `${folder[1].toUpperCase()}:${folder.slice(2)}` : folder;

/** `shells.cwd` in the spelling of this machine. */
const inWindowsSpelling = (folder: string) => (process.platform === 'win32' ? msysToWindows(folder) : folder);

/**
 * The same command, run in `folder` without the shell moving there: a subshell takes the `cd`, so
 * `workdir` stays a one-command thing even when the session shares one shell.
 */
export function commandInFolder(command: string, folder: string) {
  return `( cd -- '${shellPath(folder).replace(/'/g, `'\\''`)}' || exit;\n${command}\n)`;
}

/**
 * The bash pi's shell tool would use, or null when this machine has none (Windows without Git
 * Bash) — then there is nothing to keep alive and commands run one process each.
 */
export function resolveBash(shellPathSetting?: string): string | null {
  if (shellPathSetting) return exists(shellPathSetting) ? shellPathSetting : null;
  if (process.platform === 'win32') {
    const dir = realBashDir();
    return dir ? path.join(dir, 'bash.exe') : null;
  }
  for (const file of ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash', '/opt/homebrew/bin/bash']) if (exists(file)) return file;
  return exists('/bin/sh') ? '/bin/sh' : null;
}

/** One long-lived shell. Everything it runs is serialized: a shell has a single input. */
export class SharedShell {
  private child: ChildProcess | undefined;
  private current: Exchange | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private starting: Promise<void> | undefined;
  private scripts: string | undefined;
  private seq = 0;
  private dead = true;
  private closed = false;
  private folder: string | undefined;

  constructor(private readonly file: string) {}

  /** The folder the shell is in now, once it has run something. */
  get cwd() {
    return this.folder;
  }

  /** Run one command in the shell; `cwd` only matters when the shell has to be started. */
  run(command: string, cwd: string, options: ShellRun): Promise<{ exitCode: number }> {
    const task = this.queue.then(async () => {
      await this.ensure(cwd, options.env);
      const id = randomUUID().slice(0, 8);
      const script = this.writeScript(command);
      try {
        const done = await this.send(this.invoke(script, id), id, options);
        return { exitCode: done.exitCode };
      } finally {
        try { fs.unlinkSync(script); } catch { /* already gone: nothing to clean up */ }
      }
    });
    // A failed command must not take the queue down with it.
    this.queue = task.then(() => {}, () => {});
    return task;
  }

  dispose() {
    this.closed = true;
    this.stop(new Error('The shell was closed'));
    if (this.scripts) {
      try { fs.rmSync(this.scripts, { recursive: true, force: true }); } catch { /* temp files: nothing to report if they are already gone */ }
      this.scripts = undefined;
    }
  }

  // ---------------------------------------------------------------- process

  private async ensure(cwd: string, env: NodeJS.ProcessEnv | undefined) {
    if (this.closed) throw new Error('The shell was closed');
    if (this.child && !this.dead) return;
    // A shell that died (a timeout, `exit`) is replaced where the last marker left off, not back
    // in the session folder: the model's `cd` should outlive a command that hung.
    this.starting ??= this.start(this.folder ?? cwd, env ?? process.env).finally(() => { this.starting = undefined; });
    await this.starting;
  }

  private async start(cwd: string, env: NodeJS.ProcessEnv) {
    this.dead = false;
    // `exec 2>&1` before the shell replaces this process puts stderr on the stdout pipe, so the
    // two streams interleave exactly as the command wrote them.
    const child = spawn(this.file, ['-c', 'exec 2>&1; exec "$0" -s', this.file], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    this.child = child;
    this.folder = cwd;
    child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
    // stderr is folded into stdout above; keep a listener so a stray write cannot crash the process.
    child.stderr?.on('data', (chunk: Buffer) => this.onData(chunk));
    child.stdin?.on('error', () => {});
    child.on('error', (err: Error) => {
      if (child === this.child) this.stop(new ShellStartError(`The shell could not start (${err.message}).`));
    });
    child.on('exit', (code, signal) => {
      // Only a shell we still own matters: a previous one being killed must not take this one with it.
      if (child !== this.child) return;
      this.child = undefined;
      this.dead = true;
      const run = this.current;
      // A command that ran `exit` ends its shell on purpose: that is its exit code, not a crash.
      if (run && code !== null) {
        run.onData(Buffer.from(`\n[The shell ended here (exit ${code}); the next command starts a new one in ${this.folder}.]\n`));
        this.finish(run, code, undefined);
        return;
      }
      this.stop(new Error(`The shell exited (${signal ?? `code ${code ?? '?'}`}) before the command finished.`));
    });

    try {
      const ready = await this.send(`printf '\\n${MARKER}ready 0 %s\\n' "$PWD"`, 'ready', { onData: () => {}, timeoutMs: START_TIMEOUT_MS });
      // A shell that leaves while it is being started (a wrapper that is not a shell at all) answered
      // nothing: that is a start failure, not a command that ended.
      if (this.dead) throw new ShellStartError(`The shell exited while starting (${ready.exitCode}).`);
      if (ready.cwd) this.folder = inWindowsSpelling(ready.cwd);
    } catch (err) {
      this.stop(err instanceof Error ? err : new Error(String(err)));
      throw err instanceof ShellStartError ? err : new ShellStartError(`The shell did not answer (${(err as Error).message}).`);
    }
  }

  /** Kill the whole tree: a command may have started its own children. */
  private stop(err: Error) {
    const child = this.child;
    const run = this.current;
    this.child = undefined;
    this.dead = true;
    this.current = undefined;
    if (run) this.settle(run, () => run.reject(err));
    if (!child?.pid) return;
    if (process.platform === 'win32') {
      try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* already gone */ }
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
    }
  }

  // ---------------------------------------------------------------- one exchange

  private send(line: string, id: string, options: ShellRun): Promise<{ exitCode: number; cwd?: string }> {
    // Not a start failure: the shell was fine and died between two commands, so the next one gets a new one.
    if (this.dead || !this.child) return Promise.reject(new Error('The shell exited before this command ran. Run it again.'));
    return new Promise((resolve, reject) => {
      const run: Exchange = { marker: Buffer.from(`\n${MARKER}${id} `), onData: options.onData, pending: Buffer.alloc(0), resolve, reject };
      this.current = run;

      if (options.timeoutMs !== undefined) {
        const seconds = options.timeoutText ?? options.timeoutMs / 1000;
        run.timer = setTimeout(() => this.cancel(run, new Error(`timeout:${seconds}`)), options.timeoutMs);
      }
      if (options.signal) {
        const onAbort = () => this.cancel(run, new Error('aborted'));
        if (options.signal.aborted) return onAbort();
        options.signal.addEventListener('abort', onAbort, { once: true });
        run.unwatch = () => options.signal?.removeEventListener('abort', onAbort);
      }

      try {
        this.child?.stdin?.write(`${line}\n`);
      } catch (err) {
        this.cancel(run, err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Output arrives in pieces: deliver it as it comes, but hold back enough of the tail that a
   * marker split across two chunks is never shown to the model as garbage.
   */
  private onData(chunk: Buffer) {
    const run = this.current;
    if (!run) return; // nothing is running: a background job from an earlier command said something
    run.pending = Buffer.concat([run.pending, chunk]);

    const at = run.pending.indexOf(run.marker);
    if (at < 0) {
      const cut = run.pending.length - Math.min(run.pending.length, HOLD_BACK);
      if (cut > 0) {
        run.onData(run.pending.subarray(0, cut));
        run.pending = run.pending.subarray(cut);
      }
      return;
    }

    const end = run.pending.indexOf(NEWLINE, at + run.marker.length);
    if (end < 0) return; // the marker line is still arriving

    if (at > 0) run.onData(run.pending.subarray(0, at));
    const tail = run.pending.subarray(at + run.marker.length, end).toString('utf8');
    const space = tail.indexOf(' ');
    const exitCode = Number(space < 0 ? tail : tail.slice(0, space));
    const cwd = space < 0 ? undefined : tail.slice(space + 1);
    this.finish(run, Number.isFinite(exitCode) ? exitCode : 1, cwd);
  }

  private finish(run: Exchange, exitCode: number, cwd: string | undefined) {
    if (cwd) this.folder = inWindowsSpelling(cwd);
    this.settle(run, () => run.resolve({ exitCode, cwd }));
  }

  private cancel(run: Exchange, err: Error) {
    if (this.current !== run) return;
    // A command that hit its timeout may be stuck forever: the shell goes with it, and the next
    // command starts a fresh one wherever the last marker said we were.
    this.stop(err);
  }

  private settle(run: Exchange, done: () => void) {
    this.current = undefined;
    if (run.timer) clearTimeout(run.timer);
    run.unwatch?.();
    done();
  }

  // ---------------------------------------------------------------- scripts

  private writeScript(command: string): string {
    this.scripts ??= fs.mkdtempSync(path.join(os.tmpdir(), 'pi-shell-'));
    const file = path.join(this.scripts, `cmd-${++this.seq}.sh`);
    fs.writeFileSync(file, `${command}\n`);
    return file;
  }

  /** The one protocol line that runs a script; `set +e` keeps an earlier command's `set -e` out. */
  private invoke(script: string, id: string) {
    const file = shellPath(script).replace(/'/g, `'\\''`);
    return `set +e; . '${file}' </dev/null; __pi_ec=$?; printf '\\n${MARKER}${id} %s %s\\n' "$__pi_ec" "$PWD"`;
  }
}

// ---------------------------------------------------------------- the shell tool's backend

export interface ShellCommandsOptions {
  /** pi's own `shellPath` setting, so a user-configured bash is the one we keep alive. Read when a shell starts. */
  shellPath?: () => string | undefined;
  /** Read for every command: switching the setting applies without restarting the session. */
  mode: () => ShellSessionMode;
}

/**
 * What pi's shell tool executes through. In `session` mode it drives one live shell (so `cd`
 * carries over); in `command` mode every command gets its own process, exactly like pi's default.
 */
export class ShellCommands {
  private shared: SharedShell | null | undefined;
  private local: BashOperations | undefined;
  /** Why the shared shell is off for the rest of the session, if it refused to start. */
  private disabled: string | null = null;
  /** The failure still to be shown to the model, once. */
  private notice: string | null = null;
  readonly operations: BashOperations;

  constructor(private readonly options: ShellCommandsOptions) {
    this.operations = { exec: (command, cwd, opts) => this.exec(command, cwd, opts) };
  }

  /** Folder the shared shell is in, when one is alive. */
  get cwd() {
    return this.shared?.cwd;
  }

  dispose() {
    this.shared?.dispose();
    this.shared = undefined;
  }

  /** Why the shared shell gave up, once: the next command's result tells the model. */
  takeStartFailure(): string | null {
    const reason = this.notice;
    this.notice = null;
    return reason;
  }

  private async exec(
    command: string,
    cwd: string,
    opts: { onData: (data: Buffer) => void; signal?: AbortSignal; timeout?: number; env?: NodeJS.ProcessEnv },
  ): Promise<{ exitCode: number | null }> {
    const keeps = this.options.mode() === 'session';
    if (!keeps) this.dispose();
    const shell = keeps ? this.alive() : null;
    if (!shell) return this.fallback().exec(command, cwd, opts);
    try {
      return await shell.run(command, cwd, {
        onData: opts.onData,
        signal: opts.signal,
        env: opts.env,
        timeoutMs: opts.timeout === undefined ? undefined : opts.timeout * 1000,
        timeoutText: opts.timeout,
      });
    } catch (err) {
      // A shell that will not start is not a failed command: run this one on its own and keep
      // going that way for the rest of the session.
      if (!(err instanceof ShellStartError)) throw err;
      this.noteStartFailure(err.message);
      return this.fallback().exec(command, cwd, opts);
    }
  }

  /** The shared shell, unless this machine has none or it refused to start. */
  private alive(): SharedShell | null {
    if (this.disabled) return null;
    if (this.shared !== undefined) return this.shared;
    const file = resolveBash(this.options.shellPath?.());
    this.shared = file ? new SharedShell(file) : null;
    return this.shared;
  }

  private fallback(): BashOperations {
    this.local ??= createLocalBashOperations({ shellPath: this.options.shellPath?.() });
    return this.local;
  }

  /** Report a shared shell that will not start; the session keeps working, one process per command. */
  private noteStartFailure(reason: string) {
    if (this.disabled) return;
    this.disabled = reason;
    this.notice = reason;
    this.shared?.dispose();
    this.shared = null;
  }
}
