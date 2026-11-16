// What a handoff card stands in for: the messages an idle rebuild dropped from the model's context.
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { HANDOFF_CUSTOM_TYPE } from '../src/shared/idle-reset';
import { dropContextAbove, omittedMessages } from '../src/agent/hub';

const user = (text: string) => ({ role: 'user' as const, content: text, timestamp: Date.now() });

/** What a rebuild does: hand the model a card, then drop everything above it. */
function rebuild(manager: SessionManager) {
  const card = manager.appendCustomMessageEntry(HANDOFF_CUSTOM_TYPE, 'handoff card', true, { sessionId: 's' });
  dropContextAbove(manager);
  return card;
}

const texts = (messages: { content?: unknown }[]) => messages.map((m) => String(m.content));

describe('omittedMessages', () => {
  it('returns nothing before the first rebuild', () => {
    const manager = SessionManager.inMemory(process.cwd());
    manager.appendMessage(user('hello'));
    assert.deepEqual(omittedMessages(manager), []);
  });

  it('returns the messages the card replaced, in order', () => {
    const manager = SessionManager.inMemory(process.cwd());
    manager.appendMessage(user('first'));
    manager.appendMessage(user('second'));
    rebuild(manager);
    assert.deepEqual(texts(omittedMessages(manager)), ['first', 'second']);
  });

  it('leaves nothing above the card in the model context', () => {
    const manager = SessionManager.inMemory(process.cwd());
    manager.appendMessage(user('first'));
    rebuild(manager);
    // Entries stay as empty shells; what the model reads is the projection's messages.
    assert.deepEqual(
      manager.buildSessionProjection().messages.filter((m) => m.role === 'user'),
      [],
    );
    assert.equal(manager.buildSessionProjection().messages.length, 1);
  });

  it('scopes each card to its own segment after a second rebuild', () => {
    const manager = SessionManager.inMemory(process.cwd());
    manager.appendMessage(user('first'));
    rebuild(manager);
    manager.appendMessage(user('second'));
    rebuild(manager);
    // Only the newest card's segment comes back: 'first' already belongs to the older card, which
    // itself is part of that segment.
    assert.deepEqual(texts(omittedMessages(manager)), ['handoff card', 'second']);
  });

  it('shows the older card itself as part of the history it folded away', () => {
    const manager = SessionManager.inMemory(process.cwd());
    manager.appendMessage(user('first'));
    rebuild(manager);
    manager.appendMessage(user('second'));
    rebuild(manager);
    const shown = omittedMessages(manager);
    assert.equal(shown.filter((m) => (m as { role?: string }).role === 'custom').length, 1);
  });
});
