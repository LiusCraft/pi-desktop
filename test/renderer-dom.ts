// Browser APIs without layout are enough for menu and view-orchestration tests.
// Each importing test opts into jsdom; the rest of the suite stays in Node.
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

export const invoke = vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>();

Object.assign(window, {
  piDesktop: {
    platform: 'linux',
    boot: { settings: { locale: 'en' }, info: {} },
    invoke,
    on: () => () => {},
  },
  matchMedia: (media: string): MediaQueryList => ({
    media,
    matches: false,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
for (const method of ['scrollIntoView', 'setPointerCapture', 'releasePointerCapture'])
  Object.defineProperty(HTMLElement.prototype, method, { configurable: true, value: () => {} });
Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false });

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  invoke.mockReset();
  localStorage.clear();
});
