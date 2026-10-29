// Scrollbars stay hidden until something scrolls: one capture-phase listener marks the
// scrolling element with `data-scrolling` (see globals.css) and clears it shortly after.
const HIDE_AFTER = 900;
const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

document.addEventListener(
  'scroll',
  (e) => {
    const el = e.target instanceof Element ? e.target : document.scrollingElement;
    if (!el) return;
    if (!el.hasAttribute('data-scrolling')) el.setAttribute('data-scrolling', '');
    clearTimeout(timers.get(el));
    timers.set(
      el,
      setTimeout(() => el.removeAttribute('data-scrolling'), HIDE_AFTER),
    );
  },
  { capture: true, passive: true },
);
