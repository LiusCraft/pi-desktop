// Work projects: the folder list keeps what the user wrote about a project, and the agent turns it into prompt context and notes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectBook } from '../src/agent/remote/workspace';
import { Store } from '../src/agent/store';
import { editProject, projectContext, remember } from '../src/agent/work-project';
import { PROJECT_LIMITS } from '../src/shared/protocol';

let root: string;
let book: ProjectBook;
let dir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-project-'));
  dir = path.join(root, 'reports');
  fs.mkdirSync(dir);
  book = new ProjectBook(new Store(path.join(root, 'data')));
  book.addWorkFolder(dir);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('work project book', () => {
  it('keeps description, instructions and notes when the folder is used again', () => {
    book.updateWorkFolder(dir, {
      description: 'Weekly report',
      instructions: 'Answer in Chinese',
      memory: '- uses CSV',
    });
    const other = path.join(root, 'other');
    fs.mkdirSync(other);
    book.addWorkFolder(other);
    book.addWorkFolder(dir);
    const [first, second] = book.workFolders();
    expect(first).toMatchObject({
      path: dir,
      description: 'Weekly report',
      instructions: 'Answer in Chinese',
      memory: '- uses CSV',
    });
    expect(second.path).toBe(other);
  });

  it('cleans a patch: trims, caps lengths and keeps only http(s) links', () => {
    const [saved] = book.updateWorkFolder(dir, {
      name: '   ',
      description: `${'x'.repeat(PROJECT_LIMITS.description + 50)}  `,
      links: [
        { title: 'Doc', url: 'https://example.com/a' },
        { title: 'Local', url: 'file:///etc/passwd' },
        { title: 'Script', url: 'javascript:alert(1)' },
      ],
    });
    expect(saved.name).toBe('reports');
    expect(saved.description).toHaveLength(PROJECT_LIMITS.description);
    expect(saved.links).toEqual([{ title: 'Doc', url: 'https://example.com/a' }]);
  });

  it('refuses to edit a folder that is not a project', () => {
    expect(() => book.updateWorkFolder(path.join(root, 'nope'), { description: 'x' })).toThrow(Error);
  });
});

describe('Code folder ownership', () => {
  const make = (relative: string) => {
    const abs = path.join(root, relative);
    fs.mkdirSync(abs, { recursive: true });
    return abs;
  };

  it('hides stale and duplicate Code project entries and keeps unrelated projects on removal', () => {
    const repo = make('repo');
    // On Windows this exercises the two spellings from the folder picker and Git.
    const alias = repo.replaceAll('\\', '/');
    const registered = book.addProject(repo);
    const other = book.addProject(make('other'));
    const store = new Store(path.join(root, 'data'));
    const stale = { ...registered, path: path.join(root, 'missing') };
    const duplicates = [registered, { ...registered, path: alias }];
    const legacy = [stale, ...duplicates, other];
    store.set('projects', legacy);

    expect(book.projects()).toEqual([registered, other]);
    expect(store.get('projects', [])).toEqual(legacy);
    expect(book.addProject(alias).path).toBe(repo);
    expect(book.projects().map((p) => p.path)).toEqual([repo, other.path]);
    expect(store.get('projects', [])).toHaveLength(3);

    store.set('projects', legacy);
    expect(book.removeProject(alias)).toEqual([other]);
    expect(store.get('projects', [])).toEqual([stale, other]);
    expect(fs.existsSync(repo)).toBe(true);
    expect(book.owner(repo)).toBeDefined();
  });

  it('creates a persistent Work directory exactly once and isolates repositories with the same name', () => {
    const a = make('org-a/api');
    const b = make('org-b/api');
    const occupied = make('data/workspace/api');
    book.addProject(a);
    book.addProject(b);
    book.addProject(a);
    const first = book.owner(a)!;
    expect(first.path).not.toBe(occupied);
    expect(path.dirname(first.path)).toBe(path.dirname(occupied));
    expect(fs.statSync(first.path).isDirectory()).toBe(true);
    expect(first.path).not.toBe(book.owner(b)?.path);
    expect(book.workFolders()).toHaveLength(3);
    expect(book.workFolders().filter((p) => p.codeFolders?.includes(a))).toHaveLength(1);
  });

  it('asks without writing, adopts the exact directory, and reuses it without altering its memory', () => {
    const a = make('api');
    const b = make('web');
    const docs = make('shop-notes');
    book.codePolicy('ask');
    book.addProject(a);
    expect(book.resolveCode(a)).toBe('ask');
    expect(book.workFolders()).toHaveLength(1);
    book.resolveCode(a, docs);
    remember(book, docs, { note: 'Use UTC' });
    book.resolveCode(b, docs);
    expect(book.owner(b)).toMatchObject({ path: docs, codeFolders: [a, b], memory: '- Use UTC' });
    expect(fs.existsSync(path.join(root, 'data', 'workspace'))).toBe(false);
    book.codePolicy('never');
    expect(book.resolveCode(a)).toBe('linked');
    expect(book.resolveCode(make('other'))).toBe('skipped');
    expect(book.workFolders()).toHaveLength(2);
    expect(new ProjectBook(new Store(path.join(root, 'data'))).codePolicy()).toBe('never');
  });

  it('moves only the link on a rebind and never steals it after a stale picker returns', () => {
    const repo = make('repo');
    book.codePolicy('ask');
    book.updateWorkFolder(dir, { codeFolders: [repo], memory: 'Original' });
    const next = book.addWorkFolder(make('new'));
    book.updateWorkFolder(next.path, { codeFolders: [repo] });
    book.resolveCode(repo, dir);
    expect(book.owner(repo)?.path).toBe(next.path);
    expect(book.workFolders().find((p) => p.path === dir)).toMatchObject({ memory: 'Original', codeFolders: [] });
    const prompt = projectContext(book.owner(repo), 'code');
    expect(prompt).toContain('pidesk_remember');
    expect(prompt).not.toContain('do not do it here');
  });
});

describe('project context', () => {
  it('is empty for no project, and always offers memory for a project', () => {
    expect(projectContext(undefined)).toBeNull();
    const text = projectContext(book.workFolders()[0])!;
    expect(text).toContain('# Project: reports');
    expect(text).toContain('pidesk_remember');
    expect(text).not.toContain('Instructions from the user');
  });

  it('carries instructions, links and memory', () => {
    book.updateWorkFolder(dir, {
      instructions: 'Lead with the conclusion',
      memory: '- client is Acme',
      links: [{ title: 'Board', url: 'https://example.com/board' }],
    });
    const text = projectContext(book.workFolders()[0])!;
    expect(text).toContain('Lead with the conclusion');
    expect(text).toContain('- Board: https://example.com/board');
    expect(text).toContain('- client is Acme');
  });
});

describe('editProject', () => {
  it('saves the fields given and leaves the others as they were', () => {
    book.updateWorkFolder(dir, { description: 'Quarterly reports' });
    const saved = editProject(book, dir, {
      instructions: 'Answer in Chinese',
      links: [{ title: 'Board', url: 'https://example.com/board' }],
    });
    expect(saved).toMatchObject({
      name: 'reports',
      description: 'Quarterly reports',
      instructions: 'Answer in Chinese',
      links: [{ title: 'Board', url: 'https://example.com/board' }],
    });
  });

  it('clears a field with an empty string and the links with an empty list', () => {
    book.updateWorkFolder(dir, { description: 'Old', links: [{ title: 'Board', url: 'https://example.com/board' }] });
    const saved = editProject(book, dir, { description: '', links: [] });
    expect(saved.description).toBe('');
    expect(saved.links).toEqual([]);
  });

  it('names the limit instead of clipping what the model wrote', () => {
    expect(() => editProject(book, dir, { instructions: 'x'.repeat(PROJECT_LIMITS.instructions + 1) })).toThrow(
      /limit/,
    );
    expect(() => editProject(book, dir, { name: '   ' })).toThrow(/empty/);
    expect(() => editProject(book, dir, { links: [{ title: '', url: 'javascript:alert(1)' }] })).toThrow(/http/);
    const tooMany = Array.from({ length: PROJECT_LIMITS.links + 1 }, (_, i) => ({
      title: '',
      url: `https://example.com/${i}`,
    }));
    expect(() => editProject(book, dir, { links: tooMany })).toThrow(/at most/);
  });

  it('needs at least one field', () => {
    expect(() => editProject(book, dir, {})).toThrow(/at least one field/);
  });

  it('notifies the host only for an edit it accepted', () => {
    let calls = 0;
    const saved = () => void (calls += 1);
    editProject(book, dir, { description: 'Quarterly reports' }, saved);
    expect(calls).toBe(1);
    expect(() => editProject(book, dir, { name: '  ' }, saved)).toThrow(/empty/);
    expect(calls).toBe(1);
  });
});

describe('remember', () => {
  it('appends notes one per line', () => {
    remember(book, dir, { note: 'prefers tables' });
    remember(book, dir, { note: 'deadline\nis Friday' });
    expect(book.workFolders()[0].memory).toBe('- prefers tables\n- deadline is Friday');
  });

  it('rewrites the whole text', () => {
    remember(book, dir, { note: 'old' });
    remember(book, dir, { rewrite: '- tidy' });
    expect(book.workFolders()[0].memory).toBe('- tidy');
  });

  it('refuses a note that does not fit, and asks for a rewrite', () => {
    book.updateWorkFolder(dir, { memory: 'x'.repeat(PROJECT_LIMITS.memory) });
    expect(() => remember(book, dir, { note: 'one more' })).toThrow(/rewrite/);
    expect(book.workFolders()[0].memory).toHaveLength(PROJECT_LIMITS.memory);
  });

  it('needs something to save', () => {
    expect(() => remember(book, dir, {})).toThrow(Error);
  });

  it('notifies the host after the note is on disk, so the list it sends is current', () => {
    let seen = '(not called)';
    remember(book, dir, { note: 'prefers tables' }, () => {
      seen = book.workFolders()[0].memory ?? '';
    });
    expect(seen).toBe('- prefers tables');
  });

  it('stays quiet when the note does not fit or nothing was given', () => {
    book.updateWorkFolder(dir, { memory: 'x'.repeat(PROJECT_LIMITS.memory) });
    let calls = 0;
    const saved = () => void (calls += 1);
    expect(() => remember(book, dir, { note: 'one more' }, saved)).toThrow(/rewrite/);
    expect(() => remember(book, dir, {}, saved)).toThrow(Error);
    expect(calls).toBe(0);
  });
});
