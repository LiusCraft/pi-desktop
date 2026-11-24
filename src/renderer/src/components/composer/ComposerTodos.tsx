import { ChevronDownIcon, ListTodoIcon } from 'lucide-react';
import { TodoDisclosure } from '@/components/common/TodoDisclosure';
import { TodoList } from '@/components/thread/Items';
import { CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useT } from '@/lib/i18n';
import type { SessionView } from '@/store/types';

/** The current checklist lives above the editor, not inline with messages. */
export function ComposerTodos({ items }: { items: SessionView['lastTodos'] }) {
  const t = useT();
  if (!items.length) return null;
  const remaining = items.filter((item) => item.status !== 'completed').length;
  return (
    // The later, positioned composer covers this extra bottom edge; the list and header stay above it.
    <TodoDisclosure className="relative mx-4 -mb-3 rounded-2xl surface-flat bg-card pb-3">
      <CollapsibleTrigger className="group flex w-full items-center gap-2.5 rounded-2xl px-3 py-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        <ListTodoIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">{t('composer.todos')}</span>{' '}
        <span className="text-muted-foreground">
          {remaining ? t('composer.todosRemaining', { count: remaining }) : t('composer.todosDone')}
        </span>
        <ChevronDownIcon
          aria-hidden
          className="ml-auto size-3.5 shrink-0 text-muted-foreground group-data-[state=closed]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col justify-end overflow-hidden motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down">
        <div className="max-h-[min(25vh,11rem)] shrink-0 overflow-y-auto overscroll-contain px-3 pt-0.5 pb-2">
          <TodoList items={items} variant="dots" />
        </div>
      </CollapsibleContent>
    </TodoDisclosure>
  );
}
