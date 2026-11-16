import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { TOOLTIP_DEFAULT_DELAY, TooltipSurface } from '@/components/ui/tooltip';

type TooltipPlacement = { left: number; top: number; side: 'top' | 'bottom' };
type TooltipState = ({ text: string } & TooltipPlacement) | null;

const DATA_TITLE = 'data-pi-tooltip';
const GAP = 8;
const EDGE = 8;

function targetOf(event: Event) {
  const node = event.target;
  return node instanceof Element ? node.closest<HTMLElement>(`[${DATA_TITLE}]`) : null;
}

function captureTitle(element: Element) {
  const title = element.getAttribute('title');
  if (title == null) return;
  element.setAttribute(DATA_TITLE, title);
  element.removeAttribute('title');
}

function captureTitles(root: ParentNode) {
  if (root instanceof Element) captureTitle(root);
  root.querySelectorAll('[title]').forEach(captureTitle);
}

function tooltipPosition(element: HTMLElement, text: string): TooltipPlacement {
  const rect = element.getBoundingClientRect();
  const width = Math.min(320, Math.max(120, Math.min(320, text.length * 7.5 + 20)));
  const left = Math.min(Math.max(EDGE, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - EDGE);
  const above = rect.top >= 48;
  return { left, top: above ? rect.top - GAP : rect.bottom + GAP, side: above ? 'top' : 'bottom' };
}

/** Disables browser-native title bubbles and renders the app's themed tooltip surface instead. */
export function NativeTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  useEffect(() => {
    let active: HTMLElement | null = null;
    let timer: number | null = null;

    const cancel = () => {
      if (timer == null) return;
      window.clearTimeout(timer);
      timer = null;
    };

    captureTitles(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof Element) captureTitle(record.target);
        else if (record.type === 'childList')
          for (const node of record.addedNodes)
            if (node instanceof Element || node instanceof DocumentFragment) captureTitles(node);
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['title'],
      childList: true,
      subtree: true,
    });

    const hide = (element = active) => {
      if (element === active || !element) {
        active = null;
        setTooltip(null);
      }
    };
    const show = (element: HTMLElement) => {
      if (element.closest('[data-slot="tooltip-trigger"]')) return;
      const text = element.getAttribute(DATA_TITLE);
      if (!text?.trim()) return;
      hide();
      active = element;
      setTooltip({ text, ...tooltipPosition(element, text) });
    };
    const schedule = (element: HTMLElement | null) => {
      cancel();
      if (!element || element.closest('[data-slot="tooltip-trigger"]') || !element.getAttribute(DATA_TITLE)?.trim())
        return;
      if (active && active !== element) hide();
      timer = window.setTimeout(() => {
        timer = null;
        show(element);
      }, TOOLTIP_DEFAULT_DELAY);
    };
    const onOver = (event: Event) => {
      const element = targetOf(event);
      if (
        !element ||
        ((event as MouseEvent).relatedTarget instanceof Node &&
          element.contains((event as MouseEvent).relatedTarget as Node))
      )
        return;
      schedule(element);
    };
    const onOut = (event: Event) => {
      cancel();
      if (!active) return;
      const next = (event as MouseEvent).relatedTarget;
      if (!(next instanceof Node) || !active.contains(next)) hide();
    };
    const onFocus = (event: Event) => {
      schedule(targetOf(event));
    };
    const onBlur = (event: Event) => {
      if (active && event.target instanceof Node && active.contains(event.target)) hide();
    };
    const onViewportChange = () => {
      if (active) {
        const text = active.getAttribute(DATA_TITLE) ?? '';
        setTooltip({ text, ...tooltipPosition(active, text) });
      }
    };

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', onBlur, true);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    return () => {
      cancel();
      hide();
      observer.disconnect();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('focusout', onBlur, true);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    };
  }, []);

  if (!tooltip) return null;
  return createPortal(
    <TooltipSurface
      role="tooltip"
      className="pointer-events-none fixed z-[100] w-fit max-w-[min(320px,calc(100vw-16px))] px-2.5 py-1.5 text-xs text-balance break-words whitespace-normal"
      style={{
        left: tooltip.left,
        top: tooltip.top,
        transform: tooltip.side === 'top' ? 'translateY(-100%)' : undefined,
      }}
    >
      {tooltip.text}
    </TooltipSurface>,
    document.body,
  );
}
