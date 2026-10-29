'use client';

import * as React from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { DayPicker, getDefaultClassNames } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

function Calendar({ className, classNames, showOutsideDays = true, ...props }: React.ComponentProps<typeof DayPicker>) {
  const defaults = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-1', className)}
      classNames={{
        root: cn('w-fit', defaults.root),
        months: cn('relative flex flex-col gap-4', defaults.months),
        month: cn('flex w-full flex-col gap-3', defaults.month),
        nav: cn('absolute inset-x-0 top-0 flex h-8 w-full items-center justify-between', defaults.nav),
        button_previous: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'size-8 p-0 select-none aria-disabled:opacity-50',
          defaults.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'size-8 p-0 select-none aria-disabled:opacity-50',
          defaults.button_next,
        ),
        month_caption: cn('flex h-8 w-full items-center justify-center px-8', defaults.month_caption),
        caption_label: cn('text-sm font-medium select-none', defaults.caption_label),
        month_grid: 'w-full border-collapse',
        weekdays: cn('flex', defaults.weekdays),
        weekday: cn('flex-1 rounded-md text-[0.8rem] font-normal text-muted-foreground select-none', defaults.weekday),
        week: cn('mt-1 flex w-full', defaults.week),
        day: cn('group/day relative aspect-square size-8 p-0 text-center text-sm select-none', defaults.day),
        day_button: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'size-8 p-0 font-normal group-data-[selected=true]/day:bg-primary group-data-[selected=true]/day:text-primary-foreground group-data-[selected=true]/day:hover:bg-primary',
          defaults.day_button,
        ),
        today: cn('rounded-md bg-accent text-accent-foreground', defaults.today),
        outside: cn('text-muted-foreground opacity-50', defaults.outside),
        disabled: cn('text-muted-foreground opacity-40', defaults.disabled),
        hidden: cn('invisible', defaults.hidden),
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className, ...rest }) =>
          orientation === 'left' ? (
            <ChevronLeftIcon className={cn('size-4', className)} {...rest} />
          ) : (
            <ChevronRightIcon className={cn('size-4', className)} {...rest} />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };
