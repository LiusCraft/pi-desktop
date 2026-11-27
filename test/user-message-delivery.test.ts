import { expect, it } from 'vitest';
import { applyPiEvent, emptySession } from '../src/renderer/src/store/transcript';
import { buildMessage } from '../src/shared/attachments';
import type { SessionMeta } from '../src/shared/protocol';

it('confirms a plain-text message with a trailing newline without adding another bubble', () => {
  const s = emptySession({ id: 'session', kind: 'code' } as SessionMeta);
  const text = 'https://github.com/example/repo/pull/42#pullrequestreview-123\n';
  const clientId = 'submission';
  const { message } = buildMessage({ text, clientId, attachments: [] });
  s.items.push({ kind: 'user', key: 'pending', text, clientId, attachments: [], acknowledged: false });
  s.pendingUser = ['pending'];

  applyPiEvent(
    s,
    {
      type: 'message_end',
      message: {
        role: 'user',
        content: [{ type: 'text', text: message }],
        entryId: 'saved',
        timestamp: 1,
      },
    },
    'normal',
  );

  expect(s.items).toHaveLength(1);
  expect(s.items[0]).toMatchObject({ kind: 'user', key: 'pending', text, entryId: 'saved', delivered: true });
  expect(s.pendingUser).toEqual([]);
});
