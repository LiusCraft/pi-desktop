// What the host hands back when the transcript asks to see the messages a compaction replaced.
import { describe, expect, it } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { compactedMessages } from '../src/agent/hub';

describe('compacted history', () => {
  it('returns the messages before the kept tail, not the kept ones nor the summary', () => {
    const manager = SessionManager.inMemory('/p');
    manager.appendMessage({ role: 'user', content: 'summarized away', timestamp: 1 } as any);
    const kept = manager.appendMessage({ role: 'user', content: 'kept', timestamp: 2 } as any);
    manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'still in context' }], timestamp: 3 } as any);
    manager.appendCompaction('the summary', kept, 1000);

    const hidden = compactedMessages(manager);
    expect(hidden.map((m) => m.role)).toEqual(['user']);
    expect(hidden[0].content).toBe('summarized away');
  });

  it('is empty before the first compaction', () => {
    const manager = SessionManager.inMemory('/p');
    manager.appendMessage({ role: 'user', content: 'hi', timestamp: 1 } as any);
    expect(compactedMessages(manager)).toEqual([]);
  });

  it('returns everything above a compaction that keeps nothing', () => {
    const manager = SessionManager.inMemory('/p');
    manager.appendMessage({ role: 'user', content: 'one', timestamp: 1 } as any);
    manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'two' }], timestamp: 2 } as any);
    manager.appendCompaction('the summary', null, 500);
    expect(compactedMessages(manager)).toHaveLength(2);
  });
});
