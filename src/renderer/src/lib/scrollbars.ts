// Scrollbars stay hidden until the user scrolls: one capture-phase listener marks the
// scrolling element with `data-scrolling` (see globals.css) and clears it shortly after.
const HIDE_AFTER = 900;
const USER_SCROLL_INTENT_MS = 100;
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' ']);
const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
const userScrollIntent = new WeakMap<Element, number>();

const markUserScrollIntent = (target: EventTarget | null) => {
  const start = target instanceof Element ? target : document.scrollingElement;
  if (!start) return;
  const until = performance.now() + USER_SCROLL_INTENT_MS;
  for (let el: Element | null = start; el; el = el.parentElement) userScrollIntent.set(el, until);
};

document.addEventListener('wheel', (e) => markUserScrollIntent(e.target), { capture: true, passive: true });
document.addEventListener('touchstart', (e) => markUserScrollIntent(e.target), { capture: true, passive: true });
document.addEventListener('touchmove', (e) => markUserScrollIntent(e.target), { capture: true, passive: true });
document.addEventListener('pointerdown', (e) => markUserScrollIntent(e.target), { capture: true, passive: true });
document.addEventListener(
  'keydown',
  (e) => {
    if (SCROLL_KEYS.has(e.key)) markUserScrollIntent(e.target);
  },
  { capture: true, passive: true },
);

document.addEventListener(
  'scroll',
  (e) => {
    const el = e.target instanceof Element ? e.target : document.scrollingElement;
    if (!el) return;
    if ((userScrollIntent.get(el) ?? 0) < performance.now()) return;
    if (!el.hasAttribute('data-scrolling')) el.setAttribute('data-scrolling', '');
    clearTimeout(timers.get(el));
    timers.set(
      el,
      setTimeout(() => el.removeAttribute('data-scrolling'), HIDE_AFTER),
    );
  },
  { capture: true, passive: true },
);
