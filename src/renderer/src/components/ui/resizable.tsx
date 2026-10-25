import { cn } from "@/lib/utils"
import * as ResizablePrimitive from "react-resizable-panels"

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

/**
 * A divider you can drag. Its hit area is wider than the line; on hover (or keyboard focus)
 * the line tints and a grip pill appears, and both turn solid while dragging.
 * `data-separator` is set by react-resizable-panels: inactive | hover | active | focus | disabled.
 */
function ResizableHandle({
  className,
  ...props
}: ResizablePrimitive.SeparatorProps) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "group/sep relative z-10 flex w-px shrink-0 cursor-col-resize items-center justify-center bg-border transition-colors outline-hidden",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-[9px] after:-translate-x-1/2",
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:cursor-row-resize",
        "aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:inset-y-auto aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-[9px] aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2",
        "data-[separator=hover]:bg-info/40 data-[separator=focus]:bg-info/40 data-[separator=active]:bg-info",
        "data-[separator=disabled]:cursor-default",
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute h-8 w-[5px] rounded-full border border-background bg-muted-foreground/70 opacity-0 shadow-sm transition-opacity duration-150",
          "group-aria-[orientation=horizontal]/sep:h-[5px] group-aria-[orientation=horizontal]/sep:w-8",
          "group-data-[separator=hover]/sep:opacity-100 group-data-[separator=focus]/sep:opacity-100 group-data-[separator=active]/sep:bg-info group-data-[separator=active]/sep:opacity-100"
        )}
      />
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
