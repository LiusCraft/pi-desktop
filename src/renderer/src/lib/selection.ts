// Text selection is opt-in (see the user-select rules in globals.css), and Ctrl/Cmd+A only
// selects within the content block under focus or the pointer instead of the whole window.
const SCOPE = '.prose-chat, .code-lines, pre, [data-selectable]';

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'a') return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, textarea, [contenteditable="true"]')) return;

  e.preventDefault();
  const sel = window.getSelection();
  const anchor = sel?.anchorNode;
  const from = anchor instanceof Element ? anchor : anchor?.parentElement;
  const scope = from?.closest(SCOPE) ?? hovered?.closest(SCOPE);
  if (!sel || !scope) return;
  sel.selectAllChildren(scope);
});

let hovered: Element | null = null;
document.addEventListener(
  'pointermove',
  (e) => {
    hovered = e.target instanceof Element ? e.target : null;
  },
  { passive: true },
);
