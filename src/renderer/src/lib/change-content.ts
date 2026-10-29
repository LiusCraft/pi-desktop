// The two sides of changed files, fetched one file at a time as the Diff panel reaches them.
import type { FileChange, FileContent } from '@shared/protocol';
import { call } from './api';

const CACHE_LIMIT = 300;
const MAX_PARALLEL = 3;
const done = new Map<string, FileContent>();
const pending = new Map<string, Promise<void>>();
const queue: (() => void)[] = [];
let running = 0;
const listeners = new Set<() => void>();

const keyOf = (sid: string, hash: string | null, file: FileChange) =>
  `${sid}\u0000${hash ?? ''}\u0000${file.path}\u0000${file.rev}`;

/** The contents if they are in already. */
export function contentOf(sid: string, hash: string | null, file: FileChange): FileContent | undefined {
  return done.get(keyOf(sid, hash, file));
}

/** Be told whenever a file's contents arrive. */
export function onContent(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    running++;
    queue.shift()!();
  }
}

/** Ask for a file's contents (a few requests at a time, in the order asked); a no-op when they are held or on their way. */
export function wantContent(sid: string, hash: string | null, file: FileChange) {
  const key = keyOf(sid, hash, file);
  if (done.has(key) || pending.has(key)) return;
  const job = new Promise<void>((resolve) => {
    queue.push(() => {
      call('sessions:changeContent', sid, file.path, hash)
        .catch((): FileContent => ({ before: null, after: null, binary: true }))
        .then((content) => {
          if (done.size >= CACHE_LIMIT) {
            const oldest = done.keys().next();
            if (!oldest.done) done.delete(oldest.value);
          }
          done.set(key, content);
        })
        .finally(() => {
          pending.delete(key);
          running--;
          resolve();
          listeners.forEach((l) => l());
          pump();
        });
    });
  });
  pending.set(key, job);
  pump();
}
