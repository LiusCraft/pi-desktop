// One-of-N choice as a pill of buttons, built on the shadcn ToggleGroup (single selection).
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({ value, onChange, options, className, compact }: {
  value: T;
  onChange: (id: T) => void;
  options: readonly SegmentedOption<T>[];
  className?: string;
  /** Small text and padding, for the `text-xs` bars above code and output. */
  compact?: boolean;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      // Pressing the selected item would clear a single-select group; a choice always stays made.
      onValueChange={(id) => id && onChange(id as T)}
      spacing={1}
      className={cn('shrink-0 gap-0 bg-muted p-0.5', compact ? 'rounded-md' : 'rounded-lg', className)}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.id}
          value={o.id}
          title={o.hint}
          disabled={o.disabled}
          className={cn('h-auto rounded-md focus-visible:border-transparent focus-visible:ring-0 font-normal text-muted-foreground transition-[color,background-color,box-shadow] duration-200 hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm', compact ? 'px-2 py-0 text-xs' : 'px-3 py-1')}
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
