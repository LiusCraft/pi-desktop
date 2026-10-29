// Where a Work session may touch files. It writes only inside its own folder and reads that folder plus
// the Code folders linked to its project; anything else (a /tmp scratch file, another folder of the
// machine) needs the user's approval, which the desktop kit asks for.
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface WorkScope {
  /** The session folder: the only place it may write. */
  cwd: string;
  /** Folders it may also read: the project's linked Code folders and the agent's own resources. */
  readable(): string[];
}

/** What a tool call does to the scope: stays inside, was approved before, or needs a question. */
export type ScopeCheck = { kind: 'inside' } | { kind: 'granted' } | { kind: 'ask'; title: string; key: string };

const FILE_READ_TOOLS = new Set(['read', 'grep', 'find', 'ls']);
const FILE_WRITE_TOOLS = new Set(['edit', 'write']);
const SHELL_TOOLS = new Set(['bash', 'powershell', 'pidesk_bg_shell']);

/** The key a granted folder is remembered under in the session's "always allow" set. */
export const SCOPE_KEY = 'scope:';

/** Variables a command may use to reach folders outside the session folder. */
const ENV_DIRS: Record<string, string> = {
  HOME: os.homedir(),
  USERPROFILE: os.homedir(),
  TMPDIR: os.tmpdir(),
  TMP: os.tmpdir(),
  TEMP: os.tmpdir(),
};
/** First folders of POSIX paths that are real places even when this machine has no such folder (Git Bash on Windows maps /tmp). */
const SYSTEM_ROOTS = new Set(['tmp', 'var', 'usr', 'etc', 'home', 'opt', 'root', 'mnt', 'private', 'Users', 'Volumes']);
/** A command that makes its own temporary file or folder, wherever the script then puts it. */
const TEMP_MAKERS = /\b(mktemp|tempfile|TemporaryDirectory|NamedTemporaryFile|mkdtemp)\b/;
const PATH_TOKEN =
  /(?:^|[\s"'=(<>|;&,])((?:~|\$\{?[A-Z]+\}?|[A-Za-z]:[\\/]|\.\.(?=[\\/]|$)|\/(?!\/))[^\s"'<>|;&)(,]*)/g;

/** The path as the disk spells it: symlinks resolved as far as the path exists. */
function real(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    /* not there yet: resolve what is */
  }
  const parent = path.dirname(p);
  return parent === p ? p : path.join(real(parent), path.basename(p));
}

export function contains(root: string, target: string): boolean {
  const rel = path.relative(real(root), real(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** One path-looking token of a command as an absolute path, or null when it names nothing real. */
function resolveToken(token: string, cwd: string): string | null {
  let rest = token;
  if (rest.startsWith('~')) {
    if (!/^~(?:[\\/]|$)/.test(rest)) return null;
    return path.resolve(os.homedir(), rest.slice(2));
  }
  const variable = /^\$\{?([A-Z]+)\}?/.exec(rest);
  if (variable) {
    const dir = ENV_DIRS[variable[1]];
    return dir ? path.resolve(dir, rest.slice(variable[0].length).replace(/^[\\/]/, '')) : null;
  }
  // Git Bash's /c/Users/… is C:/Users/…
  const drive = /^\/([a-zA-Z])(?:\/|$)/.exec(rest);
  if (process.platform === 'win32' && drive) rest = `${drive[1].toUpperCase()}:${rest.slice(2) || '/'}`;
  if (/^\/(?:dev)(?:\/|$)/.test(rest)) return null;
  const abs = path.resolve(cwd, rest);
  if (rest.startsWith('/') && SYSTEM_ROOTS.has(rest.split('/')[1])) return abs;
  // `sed '/x/d'` and `grep "/api/"` look like paths: keep a token only when the place exists.
  const parent = path.dirname(abs);
  if (existsSync(abs) || (parent !== path.dirname(parent) && existsSync(parent))) return abs;
  return null;
}

/** Every place a shell command names, as absolute paths. A script that picks its own paths cannot be seen. */
export function commandPaths(command: string, cwd: string, readOnly: boolean): string[] {
  const found: string[] = [];
  for (const match of command.matchAll(PATH_TOKEN)) {
    const abs = resolveToken(match[1].replace(/[.:]+$/, ''), cwd);
    if (abs) found.push(abs);
  }
  if (!readOnly && TEMP_MAKERS.test(command)) found.push(os.tmpdir());
  return found;
}

const folderOf = (p: string) => {
  try {
    return existsSync(p) && path.extname(p) === '' && !path.basename(p).startsWith('.') ? p : path.dirname(p);
  } catch {
    return path.dirname(p);
  }
};

/** Whether the user already allowed a folder (or one above it) for this session. */
const granted = (allowed: ReadonlySet<string>, p: string) =>
  [...allowed].some((key) => key.startsWith(SCOPE_KEY) && contains(key.slice(SCOPE_KEY.length), p));

/**
 * What a tool call does to the Work scope. `base` is what relative paths mean (the tool's folder),
 * `readOnlyCommand` tells a read-only shell command, which may also look into the readable folders.
 */
export function checkScope(
  scope: WorkScope,
  allowed: ReadonlySet<string>,
  tool: string,
  input: Record<string, unknown>,
  base: string,
  readOnlyCommand: boolean,
  texts: { read(p: string): string; write(p: string): string; run(command: string, p: string): string },
): ScopeCheck {
  let targets: string[];
  let readOnly: boolean;
  let title: (p: string) => string;
  if (FILE_READ_TOOLS.has(tool)) {
    targets = typeof input.path === 'string' && input.path ? [path.resolve(base, input.path)] : [];
    readOnly = true;
    title = texts.read;
  } else if (FILE_WRITE_TOOLS.has(tool)) {
    targets = [path.resolve(base, String(input.path ?? ''))];
    readOnly = false;
    title = texts.write;
  } else if (SHELL_TOOLS.has(tool)) {
    const command = String(input.command ?? '');
    targets = commandPaths(command, base, readOnlyCommand);
    const workdir = typeof input.workdir === 'string' ? input.workdir.trim() : '';
    if (workdir && workdir !== 'null' && workdir !== 'undefined') targets.push(path.resolve(base, workdir));
    readOnly = readOnlyCommand;
    title = (p) => texts.run(command, p);
  } else {
    return { kind: 'inside' };
  }
  const roots = readOnly ? [scope.cwd, ...scope.readable()] : [scope.cwd];
  const outside = targets.filter((p) => !roots.some((root) => contains(root, p)));
  if (!outside.length) return { kind: 'inside' };
  const pending = outside.filter((p) => !granted(allowed, p));
  if (!pending.length) return { kind: 'granted' };
  return { kind: 'ask', title: title(pending[0]), key: `${SCOPE_KEY}${folderOf(pending[0])}` };
}
