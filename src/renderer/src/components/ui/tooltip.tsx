'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Tooltip as TooltipPrimitive } from 'radix-ui';

/** Shared shadcn surface for both Radix tooltips and the title bridge. */
export const tooltipSurface = 'tooltip-surface relative rounded-lg border bg-popover text-popover-foreground shadow-lg';
export const TOOLTIP_DEFAULT_DELAY = 1000;
const TOOLTIP_POINTER_FOCUS_SUPPRESSION = 1200;

export function TooltipSurface({ className, ...props }: React.ComponentProps<'div'>) {
  return <div {...props} className={cn(tooltipSurface, className)} />;
}

export function TooltipHint({ title, children }: { title?: string; children: React.ReactElement }) {
  const suppressFocusUntil = React.useRef(0);
  if (!title) return children;
  const triggerElement = children as React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  const trigger = React.cloneElement(triggerElement, {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      suppressFocusUntil.current = Date.now() + TOOLTIP_POINTER_FOCUS_SUPPRESSION;
      triggerElement.props.onPointerDown?.(event);
    },
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      if (Date.now() < suppressFocusUntil.current) {
        event.currentTarget.blur();
        event.preventDefault();
        return;
      }
      triggerElement.props.onFocus?.(event);
    },
  });
  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

function TooltipProvider({
  delayDuration = TOOLTIP_DEFAULT_DELAY,
  skipDelayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  );
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-fit max-w-[min(320px,calc(100vw-16px))] origin-(--radix-tooltip-content-transform-origin) animate-in px-3 py-1.5 text-xs text-balance break-words whitespace-normal fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          tooltipSurface,
          className,
        )}
        collisionPadding={8}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
