// Where a Work session may write and read: its folder, the project's Code folders, and nothing else unasked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkScope, SCOPE_KEY, type ScopeCheck } from '../src/agent/work-scope';

let root: string;
let work: string;
let code: string;
let other: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'work-scope-')));
  work = path.join(root, 'work');
  code = path.join(root, 'code');
  other = path.join(root, 'other');
  for (const dir of [work, code, other]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(code, 'main.ts'), '');
  fs.writeFileSync(path.join(other, 'notes.md'), '');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const texts = { read: (p: string) => `read ${p}`, write: (p: string) => `write ${p}`, run: (c: string, p: string) => `run ${c} ${p}` };
const check = (tool: string, input: Record<string, unknown>, opts: { allowed?: string[]; readOnlyCommand?: boolean } = {}): ScopeCheck =>
  checkScope({ cwd: work, readable: () => [code] }, new Set(opts.allowed ?? []), tool, input, work, opts.readOnlyCommand ?? false, texts);

describe('Work scope', () => {
  it('lets files in the working folder be read and written', () => {
    expect(check('write', { path: 'report.md' }).kind).toBe('inside');
    expect(check('edit', { path: path.join(work, 'sub', 'a.md') }).kind).toBe('inside');
    expect(check('read', { path: 'report.md' }).kind).toBe('inside');
    expect(check('grep', {}).kind).toBe('inside');
  });

  it('lets the linked Code folders be read but not written', () => {
    expect(check('read', { path: path.join(code, 'main.ts') }).kind).toBe('inside');
    expect(check('grep', { path: code }).kind).toBe('inside');
    expect(check('write', { path: path.join(code, 'main.ts') }).kind).toBe('ask');
  });

  it('asks before touching anything else', () => {
    expect(check('read', { path: path.join(other, 'notes.md') }).kind).toBe('ask');
    expect(check('ls', { path: other }).kind).toBe('ask');
    expect(check('write', { path: path.join(other, 'out.md') }).kind).toBe('ask');
    expect(check('read', { path: '../other/notes.md' }).kind).toBe('ask');
  });

  it('asks about the temp folder, however a shell command reaches it', () => {
    expect(check('bash', { command: 'echo hi > /tmp/out.txt' }).kind).toBe('ask');
    expect(check('bash', { command: 'cp report.md /tmp/report.md' }).kind).toBe('ask');
    expect(check('bash', { command: 'cat $TMPDIR/x' }).kind).toBe('ask');
    expect(check('bash', { command: 'f=$(mktemp) && echo hi > $f' }).kind).toBe('ask');
    expect(check('bash', { command: 'ls ~' }, { readOnlyCommand: true }).kind).toBe('ask');
    expect(check('bash', { command: 'ls', workdir: other }).kind).toBe('ask');
  });

  it('leaves ordinary shell commands alone', () => {
    expect(check('bash', { command: 'ls -la' }, { readOnlyCommand: true }).kind).toBe('inside');
    expect(check('bash', { command: 'python make_report.py > report.md 2>/dev/null' }).kind).toBe('inside');
    expect(check('bash', { command: `sed -n '/start/,/end/p' notes.md` }, { readOnlyCommand: true }).kind).toBe('inside');
    expect(check('bash', { command: 'curl https://example.com/a/b -o page.html' }).kind).toBe('inside');
    expect(check('bash', { command: `cat ${path.join(work, 'a.md')}` }, { readOnlyCommand: true }).kind).toBe('inside');
  });

  it('lets a read-only command read the Code folders, but any other command writes only the working folder', () => {
    const command = `grep -r TODO ${code}`;
    expect(check('bash', { command }, { readOnlyCommand: true }).kind).toBe('inside');
    expect(check('bash', { command: `cp ${path.join(code, 'main.ts')} x.ts` }).kind).toBe('ask');
  });

  it('does not ask again for a folder the user allowed', () => {
    const allowed = [`${SCOPE_KEY}${other}`];
    expect(check('read', { path: path.join(other, 'notes.md') }, { allowed }).kind).toBe('granted');
    expect(check('write', { path: path.join(other, 'sub', 'out.md') }, { allowed }).kind).toBe('granted');
    expect(check('read', { path: path.join(root, 'elsewhere.md') }, { allowed }).kind).toBe('ask');
  });

  it('names the folder to remember in the question', () => {
    const asked = check('write', { path: path.join(other, 'out.md') });
    expect(asked).toEqual({ kind: 'ask', title: `write ${path.join(other, 'out.md')}`, key: `${SCOPE_KEY}${other}` });
  });

  it('ignores tools that touch no files', () => {
    expect(check('pidesk_todo_write', { todos: [] }).kind).toBe('inside');
  });
});
