// An info icon that shows a longer explanation on hover/focus, so the page itself can stay short.
import type { ReactNode } from 'react';
import { InfoIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function Tip({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 cursor-help appearance-none rounded border-0 bg-transparent p-0 text-muted-foreground/70 outline-none hover:text-foreground focus-visible:text-foreground"
        >
          <InfoIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs font-normal">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
