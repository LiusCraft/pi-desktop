import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DIFF_TOKEN,
  MAX_CONTEXT_CHARS,
  badgeDeletion,
  decodeReferencePrompt,
  diffSummaryText,
  messageSegments,
  referenceLocation,
  referencePrompt,
  sessionToken,
  terminalToken,
  type ContextReference,
} from '../src/shared/context-reference';
import { drafts, getDraft, useDrafts } from '../src/renderer/src/store/drafts';

vi.mock('@/lib/api', () => ({ errText: (error: unknown) => String(error) }));

const comment: ContextReference = {
  id: 'comment-1',
  kind: 'comment',
  path: 'src/example.ts',
  startLine: 8,
  endLine: 12,
  side: 'old',
  text: 'const value = 1;\nconsole.log(value);',
  comment: 'Please preserve the previous behavior.',
};

beforeEach(() => useDrafts.setState({ drafts: {}, active: null }));

describe('context references', () => {
  it('sends a precise snapshot and comment, including the old side of a diff', () => {
    const prompt = referencePrompt('Review this', [comment]);
    expect(referenceLocation(comment)).toBe('src/example.ts:8–12 (before change)');
    expect(prompt).toContain('Review this');
    expect(prompt).toContain('Comment on "src/example.ts:8–12 (before change)"');
    expect(prompt).toContain(comment.text);
    expect(prompt).toContain(comment.comment);
    expect(referencePrompt('', [{ id: 'folder', kind: 'path', path: 'src', directory: true }])).toContain(
      'Context from "src/"',
    );
  });

  it('sends a reply to a conversation passage as a card with its comment', () => {
    const reply: ContextReference = {
      id: 'reply-1',
      kind: 'quote',
      path: '',
      text: 'The date was off by one month.',
      comment: 'Why?',
    };
    expect(referenceLocation(reply)).toBe('conversation');
    const prompt = referencePrompt('', [reply]);
    expect(prompt).toContain('Reply to a passage of the "conversation"');
    expect(prompt).toContain(reply.text);
    expect(prompt).toContain('Why?');
  });

  it('quotes code fences without allowing the excerpt to escape its block', () => {
    const prompt = referencePrompt('', [{ ...comment, text: '```ts\nconst x = 1;\n```' }]);
    expect(prompt).toContain('````\n```ts\nconst x = 1;\n```\n````');
  });

  it('keeps context with its session and restores cards after a failed or queued send', () => {
    drafts.activate('session:one');
    expect(drafts.addReference('session:one', comment)).toBe(true);
    drafts.activate('session:two');
    expect(getDraft('session:two').references).toEqual([]);
    const snapshot = { text: 'Review this', attachments: [], references: getDraft('session:one').references };
    drafts.clear('session:one');
    drafts.recover('session:one', snapshot);
    expect(getDraft('session:one').references).toEqual([comment]);
    drafts.recover('session:one', { ...snapshot, text: 'another message' });
    expect(getDraft('session:one').recoveries).toHaveLength(1);
    drafts.clear('session:one');
    drafts.restore('session:one', 0);
    expect(getDraft('session:one').text).toBe('another message');
    expect(getDraft('session:one').references).toEqual([comment]);
    drafts.rekey('session:one', 'session:fork');
    expect(getDraft('session:fork').references).toEqual([comment]);
  });

  it('does not overwrite references when recovering text into a nonempty composer', () => {
    drafts.addReference('session:one', comment);
    drafts.recover('session:one', { text: 'rewound prompt', attachments: [] });
    expect(getDraft('session:one').references).toEqual([comment]);
    expect(getDraft('session:one').recoveries[0].text).toBe('rewound prompt');
  });

  it('enforces bounds and prevents reference changes during a send', () => {
    expect(drafts.addReference('session:one', { ...comment, text: 'x'.repeat(MAX_CONTEXT_CHARS + 1) })).toBe(false);
    expect(getDraft('session:one').references).toEqual([]);
    expect(getDraft('session:one').errors).toHaveLength(1);
    drafts.addReference('session:one', comment);
    drafts.lock('session:one', true);
    expect(drafts.addReference('session:one', { ...comment, id: 'other' })).toBe(false);
    drafts.removeReference('session:one', comment.id);
    expect(getDraft('session:one').references).toEqual([comment]);
    drafts.lock('session:one', false);
    drafts.removeReference('session:one', comment.id);
    expect(getDraft('session:one').references).toEqual([]);
  });

  it('refreshes a reference picked again under the same token', () => {
    const first: ContextReference = { id: 'a', kind: 'diff', path: '', token: DIFF_TOKEN, text: 'old' };
    const next: ContextReference = { id: 'b', kind: 'diff', path: '', token: DIFF_TOKEN, text: 'new' };
    expect(drafts.addReference('session:one', first)).toBe(true);
    expect(drafts.addReference('session:one', next)).toBe(true);
    expect(getDraft('session:one').references).toEqual([next]);
  });
});

describe('decodeReferencePrompt', () => {
  it('turns a sent prompt back into the typed text and its cards', () => {
    const quote: ContextReference = {
      id: 'q',
      kind: 'quote',
      path: '',
      text: '己改的\n\n(尤其 Clawd.tsx)',
      comment: 'hi',
    };
    const file: ContextReference = { id: 'f', kind: 'path', path: 'src/', directory: true };
    const decoded = decodeReferencePrompt(referencePrompt('看一下', [comment, quote, file]));
    expect(decoded?.text).toBe('看一下');
    expect(decoded?.references.map((r) => [r.kind, r.text, r.comment])).toEqual([
      ['comment', comment.text, comment.comment],
      ['quote', quote.text, 'hi'],
      ['path', undefined, undefined],
    ]);
    expect(decoded?.references[2].directory).toBe(true);
  });

  it('handles context with no typed text and ignores plain messages', () => {
    expect(decodeReferencePrompt(referencePrompt('', [comment]))?.text).toBe('');
    expect(decodeReferencePrompt('just text')).toBeNull();
  });
});

describe('@ context (diff, terminal, session)', () => {
  it('sends a diff as file names and line counts only', () => {
    const text = diffSummaryText([
      { path: 'src/a.ts', status: 'M', binary: false, add: 30, del: 5 },
      { path: 'src/b.ts', status: 'A', binary: false, add: 12, del: 0 },
    ]);
    expect(text).toContain('2 changed files, +42 −5');
    expect(text).toContain('src/a.ts  +30 −5');
    expect(text).toContain('src/b.ts (new)  +12 −0');
    const reference: ContextReference = { id: 'd', kind: 'diff', path: '', token: DIFF_TOKEN, text };
    const prompt = referencePrompt('看看改动', [reference]);
    expect(prompt).toContain('Context from "changes since the session base"');
    const decoded = decodeReferencePrompt(prompt);
    expect(decoded?.text).toBe('看看改动');
    expect(decoded?.references[0]).toMatchObject({ kind: 'diff', token: DIFF_TOKEN, text });
  });

  it('sends a terminal snapshot under its tab title', () => {
    const reference: ContextReference = {
      id: 't',
      kind: 'terminal',
      path: '',
      title: 'zsh 1',
      token: terminalToken('zsh 1'),
      text: '$ npm test\npass 12',
    };
    expect(terminalToken('zsh 1')).toBe('@term:zsh-1');
    const prompt = referencePrompt('看看终端', [reference]);
    expect(prompt).toContain('Context from "terminal: zsh 1"');
    expect(decodeReferencePrompt(prompt)?.references[0]).toMatchObject({
      kind: 'terminal',
      title: 'zsh 1',
      token: '@term:zsh-1',
      text: '$ npm test\npass 12',
    });
  });

  it('sends another session as a pointer with its id', () => {
    const reference: ContextReference = {
      id: 's',
      kind: 'session',
      path: '',
      title: 'Fix login bug',
      sessionId: 'abc123',
      token: sessionToken('Fix login bug'),
    };
    const prompt = referencePrompt('接着那边的活', [reference]);
    expect(prompt).toContain('Context from "session: Fix login bug (id abc123)"');
    expect(prompt).toContain('pidesk_read_session(session_id: "abc123")');
    const decoded = decodeReferencePrompt(prompt)?.references[0];
    expect(decoded).toMatchObject({
      kind: 'session',
      title: 'Fix login bug',
      sessionId: 'abc123',
      token: '@session:Fix-login-bug',
    });
  });

  it('splits a message into text and the badges drawn inline', () => {
    const references: ContextReference[] = [
      { id: 'd', kind: 'diff', path: '', token: DIFF_TOKEN, text: '1 changed file, +2 −1' },
      {
        id: 's',
        kind: 'session',
        path: '',
        title: 'Fix login bug',
        sessionId: 'abc',
        token: sessionToken('Fix login bug'),
      },
    ];
    const segments = messageSegments(
      '/skill:pdf-tools 看下 @diff 和 @src/a.ts，再问 @session:Fix-login-bug 和 a@b.com',
      references,
    );
    expect(segments.map((s) => (s.kind === 'text' ? s.text.trim() : `${s.kind}:${s.token}`))).toEqual([
      'command:/skill:pdf-tools',
      '看下',
      'reference:@diff',
      '和',
      'reference:@src/a.ts',
      '，再问',
      'reference:@session:Fix-login-bug',
      '和 a@b.com',
    ]);
    expect(segments[2]).toMatchObject({ reference: { kind: 'diff' } });
    expect(segments[4]).toMatchObject({ reference: null });
  });

  it('leaves @ tokens typed by hand as text when nothing was captured for them', () => {
    expect(
      messageSegments('看看 @diff 和 @term:zsh-1 还有 @src/a.ts', []).map((s) => (s.kind === 'text' ? s.text : s.kind)),
    ).toEqual(['看看 @diff 和 @term:zsh-1 还有 ', 'reference']);
  });

  it('badges a typed @path only when the caller knows the file', () => {
    const visible = messageSegments('看 @src/a.ts 和 @nope', [], { isKnownPath: (path) => path === 'src/a.ts' });
    expect(visible.map((s) => (s.kind === 'text' ? s.text : s.token))).toEqual(['看 ', '@src/a.ts', ' 和 @nope']);
    expect(
      messageSegments('看 @nope', [], { isKnownPath: () => false }).map((s) => (s.kind === 'text' ? s.text : s.token)),
    ).toEqual(['看 @nope']);
  });
});

describe('badge deletion', () => {
  const references: ContextReference[] = [
    { id: 'd', kind: 'diff', path: '', token: DIFF_TOKEN, text: '' },
    {
      id: 's',
      kind: 'session',
      path: '',
      title: 'Fix login bug',
      sessionId: 'abc',
      token: sessionToken('Fix login bug'),
    },
  ];
  const text = 'see @diff and @session:Fix-login-bug now';

  it('takes the whole badge from either side and from inside it', () => {
    expect(badgeDeletion(text, references, [9, 9], false)).toEqual({ start: 4, end: 9 });
    expect(badgeDeletion(text, references, [6, 6], false)).toEqual({ start: 4, end: 9 });
    expect(badgeDeletion(text, references, [4, 4], true)).toEqual({ start: 4, end: 9 });
    expect(badgeDeletion(text, references, [20, 20], false)).toEqual({ start: 14, end: 36 });
    expect(badgeDeletion(text, references, [36, 36], false)).toEqual({ start: 14, end: 36 });
    expect(badgeDeletion(text, references, [35, 35], true)).toEqual({ start: 14, end: 36 });
  });

  it('takes the space inserted after the token in the same Backspace', () => {
    expect(badgeDeletion(text, references, [10, 10], false)).toEqual({ start: 4, end: 10 });
    // A space the user typed themselves is plain text; only the one next to the token is attached.
    expect(badgeDeletion('see @diff  now', references, [11, 11], false)).toBeNull();
  });

  it('leaves plain text and unknown paths alone', () => {
    expect(badgeDeletion(text, references, [13, 13], false)).toBeNull();
    expect(badgeDeletion(text, references, [0, 0], false)).toBeNull();
    expect(badgeDeletion('@src/a.ts', [], [10, 10], false, { isKnownPath: () => false })).toBeNull();
  });

  it('widens a selection that touches a badge without shrinking it', () => {
    expect(badgeDeletion(text, references, [7, 20])).toEqual({ start: 4, end: 36 });
    expect(badgeDeletion(text, references, [2, 7])).toEqual({ start: 2, end: 9 });
    expect(badgeDeletion(text, references, [0, 3])).toBeNull();
  });
});
