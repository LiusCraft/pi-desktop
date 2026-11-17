// @vitest-environment jsdom
import './renderer-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DropdownMenuItem } from '../src/renderer/src/components/ui/dropdown-menu';
import { TooltipProvider } from '../src/renderer/src/components/ui/tooltip';
import { PanelToolbar, type PanelAction } from '../src/renderer/src/components/workspace/PanelToolbar';

// jsdom has no layout. Supply only the measurements/resize notifications; React,
// Radix menus, focus management and event handlers stay real. Electron tests
// separately exercise the actual CSS and draggable splitters.
let width: number;
let titleWidth: number;
let buttonWidths: Map<string, number>;
let observers: Set<MeasuredResizeObserver>;
let style: HTMLStyleElement;
const rect = (size: number) => new DOMRect(0, 0, size, 28);

class MeasuredResizeObserver implements ResizeObserver {
  readonly targets = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    observers.add(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    observers.delete(this);
  }
  notify() {
    if ([...this.targets].some((target) => target.getAttribute('data-slot') === 'panel-toolbar'))
      this.callback([], this);
  }
}

beforeEach(() => {
  width = 400;
  titleWidth = 80;
  buttonWidths = new Map();
  observers = new Set();
  vi.stubGlobal('ResizeObserver', MeasuredResizeObserver);
  style = document.createElement('style');
  style.textContent = '[data-slot="panel-toolbar"] { column-gap: 4px; } .invisible { visibility: hidden; }';
  document.head.append(style);
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute('data-slot') === 'panel-toolbar') return rect(width);
    if (this.getAttribute('data-slot') === 'panel-title') return rect(titleWidth);
    if (this.classList.contains('w-40')) return rect(160);
    if (this.hasAttribute('data-panel-action'))
      return rect(buttonWidths.get(this.getAttribute('data-panel-action')!) ?? 28);
    if (this.parentElement?.getAttribute('data-slot') === 'panel-toolbar' && this === this.parentElement.lastChild)
      return rect(28);
    return original.call(this);
  });
});

afterEach(() => {
  style.remove();
  vi.unstubAllGlobals();
});

const select = () => vi.fn<(wholeSession: boolean) => void>();
const icon = <svg aria-hidden />;
const actions = (): PanelAction[] => [
  { id: 'tree', label: 'File tree', icon, onSelect: select() },
  { id: 'find', label: 'Find', icon, onSelect: select() },
  { id: 'open', priority: 'secondary', label: 'Open', icon, onSelect: select() },
  { id: 'expand', priority: 'layout', label: 'Expand', icon, onSelect: select() },
  { id: 'close', priority: 'close', label: 'Close', icon, onSelect: select() },
];
const view = (props: Partial<ComponentProps<typeof PanelToolbar>> = {}) => (
  <TooltipProvider>
    <PanelToolbar title="Files" actions={actions()} {...props} />
  </TooltipProvider>
);
function resize(next: number) {
  width = next;
  act(() => {
    for (const observer of observers) observer.notify();
  });
}
const visible = () =>
  [...document.querySelectorAll<HTMLElement>('[data-panel-action]')]
    .filter((element) => !element.hasAttribute('aria-hidden'))
    .map((element) => element.dataset.panelAction);
async function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Panel options' }), { key: 'Enter' });
  return screen.findByRole('menu');
}
async function closeMenu() {
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}

describe('responsive panel toolbar', () => {
  it('moves one action at a time by priority and restores them at the same boundaries', () => {
    render(view());
    expect(visible()).toEqual(['tree', 'find', 'open', 'expand', 'close']);
    expect(screen.queryByRole('button', { name: 'Panel options' })).toBeNull();
    const steps = [
      [272, ['tree', 'find', 'open', 'expand', 'close']],
      [240, ['tree', 'find', 'expand', 'close']],
      [208, ['tree', 'expand', 'close']],
      [176, ['expand', 'close']],
      [144, ['close']],
      [112, []],
    ] as const;
    for (const [size, expected] of [...steps, ...steps.toReversed()]) {
      resize(size);
      expect(visible()).toEqual(expected);
    }
  });

  it('remeasures title and individual button widths, and reserves the menu before the first collapse', () => {
    width = 272;
    render(view());
    buttonWidths.set('find', 60);
    resize(width);
    expect(visible()).toEqual(['tree', 'find', 'expand', 'close']);
    titleWidth = 112;
    resize(width);
    expect(visible()).toEqual(['tree', 'expand', 'close']);
    titleWidth = 80;
    buttonWidths.clear();
    resize(width);
    expect(visible()).toEqual(['tree', 'find', 'open', 'expand', 'close']);
  });

  it('keeps explicit menu options available even when every toolbar action fits', async () => {
    const refresh = vi.fn<() => void>();
    render(view({ menu: <DropdownMenuItem onSelect={refresh}>Refresh</DropdownMenuItem> }));
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Find' })).toBeNull();
    await closeMenu();
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh' }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('preserves Ctrl/Meta modifiers for both direct buttons and overflow items', async () => {
    const expand = select();
    render(view({ actions: [{ id: 'expand', label: 'Expand', icon, onSelect: expand }] }));
    const button = screen.getByRole('button', { name: 'Expand' });
    for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }]) fireEvent.click(button, modifiers);
    expect(expand.mock.calls).toEqual([[false], [true], [true]]);
    resize(112);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Expand' }), { metaKey: true });
    expect(expand).toHaveBeenLastCalledWith(true);
  });

  it('keeps toggle state and disabled actions in the overflow menu', async () => {
    width = 112;
    const disabled = select();
    function StatefulToolbar() {
      const [checked, setChecked] = useState(true);
      return view({
        actions: [
          {
            id: 'tree',
            label: checked ? 'Hide tree' : 'Show tree',
            icon,
            pressed: checked,
            onSelect: () => setChecked((value) => !value),
          },
          { id: 'back', label: 'Back', icon, disabled: true, onSelect: disabled },
        ],
      });
    }
    const mounted = render(<StatefulToolbar />);
    expect(mounted.container.querySelector('[data-panel-action="back"] button')?.hasAttribute('disabled')).toBe(true);
    await openMenu();
    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Hide tree' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    const back = screen.getByRole('menuitem', { name: 'Back' });
    expect(back.hasAttribute('data-disabled')).toBe(true);
    fireEvent.keyDown(back, { key: 'Enter' });
    expect(disabled).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    await openMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Show tree' }).getAttribute('aria-checked')).toBe('false');
    await closeMenu();
    resize(400);
    expect(screen.getByRole('button', { name: 'Show tree' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('renders a custom dropdown trigger or its menu entry without replacing its handlers', async () => {
    const open = vi.fn<() => void>();
    render(
      view({
        actions: [
          {
            id: 'open',
            button: <button onClick={open}>Open externally</button>,
            menu: <DropdownMenuItem onSelect={open}>Open externally</DropdownMenuItem>,
          },
        ],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open externally' }));
    expect(open).toHaveBeenCalledOnce();
    resize(112);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open externally' }));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('hands focus to content only after the real menu focus scope has closed', async () => {
    width = 112;
    const menuAtInvocation: (Element | null)[] = [];
    function SearchToolbar() {
      const [search, setSearch] = useState(false);
      return (
        <>
          {view({
            actions: [
              {
                id: 'find',
                label: 'Find',
                icon,
                focusContent: true,
                onSelect: () => {
                  menuAtInvocation.push(screen.queryByRole('menu'));
                  setSearch(true);
                },
              },
            ],
          })}
          {search && <input aria-label="Find in files" ref={(input) => input?.focus()} />}
        </>
      );
    }
    render(<SearchToolbar />);
    await openMenu();
    const item = screen.getByRole('menuitem', { name: 'Find' });
    act(() => item.focus());
    fireEvent.keyDown(item, { key: 'Enter' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Find in files' })));
    expect(menuAtInvocation).toEqual([null]);
  });

  it('moves focus to the overflow trigger if the focused button is collapsed', () => {
    render(view());
    const button = screen.getByRole('button', { name: 'Open' });
    act(() => button.focus());
    expect(document.activeElement).toBe(button);
    resize(240);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Panel options' }));
  });

  it('uses a fixed title budget for address fields and cleans up removed actions and observers', async () => {
    width = 220;
    const mounted = render(view({ fillTitle: true }));
    expect(visible()).toEqual([]);
    mounted.rerender(view({ actions: [] }));
    expect(visible()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Panel options' })).toBeNull();
    mounted.rerender(view({ actions: [{ id: 'new', label: 'New terminal', icon, onSelect: select() }] }));
    expect(visible()).toEqual(['new']);
    expect(
      [...observers].some((observer) =>
        [...observer.targets].some((target) => target.getAttribute('data-panel-action') === 'new'),
      ),
    ).toBe(true);
    mounted.unmount();
    await waitFor(() => expect(observers.size).toBe(0));
  });
});
