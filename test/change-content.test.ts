import { describe, expect, it, vi } from 'vitest';
import type { FileChange, FileContent } from '../src/shared/protocol';

vi.mock('../src/renderer/src/lib/api', () => ({
  call: vi.fn<
    (method: string, sid: string, path: string, hash: string | null, base?: string | null) => Promise<FileContent>
  >(async (_method, _sid, _path, _hash, base) => ({
    before: base ?? null,
    after: 'working tree',
    binary: false,
  })),
}));

const { contentOf, wantContent } = await import('../src/renderer/src/lib/change-content');
const { call } = await import('../src/renderer/src/lib/api');
const file: FileChange = { path: 'same.txt', status: 'M', rev: 'same-revision', add: 1, del: 1, binary: false };

describe('lazy Diff content', () => {
  it('keeps different comparison bases isolated and sends the resolved base to the host', async () => {
    wantContent('session', null, file, 'branch-base');
    wantContent('session', null, file, 'head-base');
    await vi.waitFor(() => {
      expect(contentOf('session', null, file, 'branch-base')?.before).toBe('branch-base');
      expect(contentOf('session', null, file, 'head-base')?.before).toBe('head-base');
    });
    expect(call).toHaveBeenCalledWith('sessions:changeContent', 'session', 'same.txt', null, 'branch-base');
    expect(call).toHaveBeenCalledWith('sessions:changeContent', 'session', 'same.txt', null, 'head-base');
    wantContent('session', null, file, 'branch-base');
    expect(call).toHaveBeenCalledTimes(2);
  });
});
