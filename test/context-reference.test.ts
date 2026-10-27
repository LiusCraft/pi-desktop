import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CONTEXT_CHARS, referenceLocation, referencePrompt, type ContextReference } from '../src/shared/context-reference';
import { drafts, getDraft, useDrafts } from '../src/renderer/src/store/drafts';

vi.mock('@/lib/api', () => ({ errText: (error: unknown) => String(error) }));

const comment: ContextReference = {
  id: 'comment-1', kind: 'comment', path: 'src/example.ts', startLine: 8, endLine: 12,
  side: 'old', text: 'const value = 1;\nconsole.log(value);', comment: 'Please preserve the previous behavior.',
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
    expect(referencePrompt('', [{ id: 'folder', kind: 'path', path: 'src', directory: true }])).toContain('Context from "src/"');
  });

  it('sends a reply to a conversation passage as a card with its comment', () => {
    const reply: ContextReference = { id: 'reply-1', kind: 'quote', path: '', text: 'The date was off by one month.', comment: 'Why?' };
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
});
