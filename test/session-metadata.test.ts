import { describe, expect, it } from 'vitest';
import { referencePrompt } from '@shared/context-reference';
import { encodePeerMessage } from '@shared/peer-message';
import { MAX_SESSION_DESCRIPTION } from '@shared/protocol';
import { encodeTaskMessage } from '@shared/task-message';
import { parseDigest, requestText } from '../src/agent/naming';
import { formatPeerHints, type PeerSession } from '../src/agent/session-peers';

describe('session descriptions', () => {
  it('describes a delegated task without attached context or peer messages', () => {
    const prompt = referencePrompt('Fix login redirects @term:zsh', [
      { id: '1', kind: 'terminal', path: '', title: 'zsh', text: 'private terminal output' },
    ]);
    expect(requestText(encodeTaskMessage('Redirects', prompt))).toBe('Fix login redirects');
    expect(requestText(encodePeerMessage({ id: 'other', title: 'Another session' }, 'What did you do?'))).toBe('');
    expect(requestText('/reload')).toBe('');
  });

  it('validates the output independently of the title and bounds the description', () => {
    expect(parseDigest('```json\n{"title":"Redirects","description":"Found the cause.\\nTests next."}\n```')).toEqual({
      title: 'Redirects',
      description: 'Found the cause. Tests next.',
    });
    expect(parseDigest('{"title":"I cannot answer","description":"Next: test redirects."}')).toEqual({
      title: null,
      description: 'Next: test redirects.',
    });
    expect(parseDigest('Not JSON')).toBeNull();
    expect(parseDigest(JSON.stringify({ description: 'x'.repeat(MAX_SESSION_DESCRIPTION + 1) }))).toBeNull();
  });
});

it('shortlists recent topic matches and working peers, with a fixed context budget', () => {
  const now = Date.now();
  const peer = (id: string, title: string, patch: Partial<PeerSession> = {}): PeerSession => ({
    id,
    title,
    kind: 'code',
    project: '/not-injected',
    branch: 'not-injected-either',
    status: 'running',
    updatedAt: now,
    ...patch,
  });
  const hints = formatPeerHints(
    '处理登录重定向',
    [
      ...Array.from({ length: 6 }, (_, i) => peer(`unrelated-${i}`, 'Colors')),
      peer('recent-match', '重定向', { status: 'idle', description: '已定位登录问题' }),
      peer('title-only-match', '重定向', { status: 'idle' }),
      peer('old-match', '登录重定向', { status: 'idle', description: '旧方案', updatedAt: 0 }),
    ],
    now,
  );
  expect(hints).toContain('recent-match');
  expect(hints).toContain('title-only-match');
  expect(hints).toContain('unrelated-0');
  expect(hints).not.toContain('unrelated-2');
  expect(hints).not.toContain('old-match');
  expect(hints).not.toContain('not-injected');
});
