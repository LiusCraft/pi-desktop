import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EllipsisIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipHint } from '@/components/ui/tooltip';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Lower-priority actions move into the menu first; ties collapse from right to left. */
const PRIORITY = { secondary: 0, primary: 1, layout: 2, close: 3 } as const;

export type PanelAction = {
  id: string;
  priority?: keyof typeof PRIORITY;
} & (
  | {
      label: string;
      icon: ReactNode;
      disabled?: boolean;
      pressed?: boolean;
      /** Wait for the menu's focus scope to close before opening and focusing content. */
      focusContent?: boolean;
      onSelect: (wholeSession: boolean) => void;
    }
  | { button: ReactNode; menu: ReactNode }
);

export function IconBtn({ children, className, title, ...props }: React.ComponentProps<'button'>) {
  return (
    <TooltipHint title={title}>
      <button
        type="button"
        aria-label={title}
        {...props}
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-accent aria-pressed:text-foreground',
          className,
        )}
      >
        {children}
      </button>
    </TooltipHint>
  );
}

export function PanelActionButton({ action }: { action: PanelAction }) {
  if ('button' in action) return action.button;
  return (
    <IconBtn
      title={action.label}
      disabled={action.disabled}
      aria-pressed={action.pressed}
      onClick={(event) => action.onSelect(event.ctrlKey || event.metaKey)}
    >
      {action.icon}
    </IconBtn>
  );
}

function ActionMenuItem({
  action,
  onSelect,
}: {
  action: PanelAction;
  onSelect: (action: PanelAction, wholeSession: boolean) => void;
}) {
  if ('menu' in action) return action.menu;
  if (action.pressed !== undefined) {
    return (
      <DropdownMenuCheckboxItem
        checked={action.pressed}
        disabled={action.disabled}
        onSelect={() => onSelect(action, false)}
      >
        {action.icon}
        {action.label}
      </DropdownMenuCheckboxItem>
    );
  }
  return (
    <DropdownMenuItem disabled={action.disabled} onClick={(event) => onSelect(action, event.ctrlKey || event.metaKey)}>
      {action.icon}
      {action.label}
    </DropdownMenuItem>
  );
}

/** Measure this panel, not the window. Hidden buttons keep their natural width but cannot receive focus. */
export function PanelToolbar({
  title,
  actions,
  menu,
  fillTitle = false,
}: {
  title: ReactNode;
  actions: PanelAction[];
  menu?: ReactNode;
  /** The preview's address field fills the remaining space instead of sizing to its text. */
  fillTitle?: boolean;
}) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const titleLimit = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLDivElement>());
  const overflow = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const afterClose = useRef<(() => void) | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const showMenu = !!menu || hidden.size > 0;

  useLayoutEffect(() => {
    const measure = () => {
      const gap = parseFloat(getComputedStyle(root.current!).columnGap) || 0;
      const titleWidth = fillTitle
        ? titleLimit.current!.getBoundingClientRect().width
        : heading.current!.getBoundingClientRect().width;
      const widths = new Map(
        actions.map((action) => [action.id, buttons.current.get(action.id)!.getBoundingClientRect().width]),
      );
      const next = new Set<string>();
      const required = () => {
        const visible = actions.filter((action) => !next.has(action.id));
        // Reserve the overflow trigger before the first collapse, so introducing it
        // never forces a second action to disappear at the same threshold.
        return (
          titleWidth +
          visible.reduce((width, action) => width + widths.get(action.id)!, 0) +
          overflow.current!.getBoundingClientRect().width +
          gap * (visible.length + 1)
        );
      };
      const byPriority = [...actions]
        .reverse()
        .sort((a, b) => PRIORITY[a.priority ?? 'primary'] - PRIORITY[b.priority ?? 'primary']);
      for (const action of byPriority) {
        if (required() <= root.current!.getBoundingClientRect().width) break;
        next.add(action.id);
      }
      if ([...next].some((id) => buttons.current.get(id)?.contains(document.activeElement))) {
        moveFocus.current = true;
      }
      setHidden((previous) =>
        previous.size === next.size && [...next].every((id) => previous.has(id)) ? previous : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [
      root.current!,
      heading.current!,
      titleLimit.current!,
      overflow.current!,
      ...buttons.current.values(),
    ]) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [actions, menu, fillTitle]);

  useLayoutEffect(() => {
    // Keep keyboard users on a reachable control when the focused action moves into the menu.
    if (moveFocus.current) {
      moveFocus.current = false;
      trigger.current?.focus();
    }
  }, [hidden]);

  return (
    <div ref={root} data-slot="panel-toolbar" className="relative flex min-w-0 flex-1 items-center gap-1">
      <div ref={titleLimit} aria-hidden className="pointer-events-none invisible absolute w-40" />
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          ref={heading}
          data-slot="panel-title"
          className={cn(
            'flex w-max max-w-40 items-center gap-2 px-1 text-xs font-semibold whitespace-nowrap [&>span]:truncate',
            fillTitle && 'w-full max-w-none',
          )}
        >
          {title}
        </div>
      </div>
      {actions.map((action) => (
        <div
          key={action.id}
          ref={(element) => {
            if (element) buttons.current.set(action.id, element);
            else buttons.current.delete(action.id);
          }}
          data-panel-action={action.id}
          aria-hidden={hidden.has(action.id) || undefined}
          inert={hidden.has(action.id)}
          className={cn('flex shrink-0', hidden.has(action.id) && 'pointer-events-none invisible absolute')}
        >
          <PanelActionButton action={action} />
        </div>
      ))}
      <div
        ref={overflow}
        aria-hidden={!showMenu || undefined}
        inert={!showMenu}
        className={cn('flex shrink-0', !showMenu && 'pointer-events-none invisible absolute')}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconBtn ref={trigger} title={t('panel.more')}>
              <EllipsisIcon className="size-4" />
            </IconBtn>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              const action = afterClose.current;
              if (!action) return;
              afterClose.current = null;
              event.preventDefault();
              queueMicrotask(action);
            }}
          >
            {actions
              .filter((action) => hidden.has(action.id))
              .map((action) => (
                <ActionMenuItem
                  key={action.id}
                  action={action}
                  onSelect={(selected, wholeSession) => {
                    if ('onSelect' in selected) {
                      if (selected.focusContent) afterClose.current = () => selected.onSelect(wholeSession);
                      else selected.onSelect(wholeSession);
                    }
                  }}
                />
              ))}
            {hidden.size > 0 && menu && <DropdownMenuSeparator />}
            {menu}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
