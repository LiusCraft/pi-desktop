// Work projects: the folder list keeps what the user wrote about a project, and the agent turns it into prompt context and notes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectBook } from '../src/agent/remote/workspace';
import { Store } from '../src/agent/store';
import { projectContext, remember } from '../src/agent/work-project';
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
    book.updateWorkFolder(dir, { description: 'Weekly report', instructions: 'Answer in Chinese', memory: '- uses CSV' });
    const other = path.join(root, 'other');
    fs.mkdirSync(other);
    book.addWorkFolder(other);
    book.addWorkFolder(dir);
    const [first, second] = book.workFolders();
    expect(first).toMatchObject({ path: dir, description: 'Weekly report', instructions: 'Answer in Chinese', memory: '- uses CSV' });
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
    expect(() => book.updateWorkFolder(path.join(root, 'nope'), { description: 'x' })).toThrow();
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
    book.updateWorkFolder(dir, { instructions: 'Lead with the conclusion', memory: '- client is Acme', links: [{ title: 'Board', url: 'https://example.com/board' }] });
    const text = projectContext(book.workFolders()[0])!;
    expect(text).toContain('Lead with the conclusion');
    expect(text).toContain('- Board: https://example.com/board');
    expect(text).toContain('- client is Acme');
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
    expect(() => remember(book, dir, {})).toThrow();
  });
});
