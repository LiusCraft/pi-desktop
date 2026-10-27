// The Archived sessions page: sessions taken out of the sidebar but still on disk.
// Unarchive puts one back as it was; Delete forgets it for good (and its worktree).
import { ArchiveRestoreIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, Heading, Panel } from '@/customize/ui';
import { ago, fname } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { deleteSession, unarchiveSession } from '@/store/actions';
import { useApp } from '@/store/app';

export function ArchivedPage() {
  const t = useT();
  const sessions = useApp((s) => s.sessions);
  const list = Object.values(sessions)
    .filter((s) => s.meta.archived)
    .sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0));
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl animate-in px-8 py-8 duration-200 fade-in-0 slide-in-from-bottom-1">
        <Heading title={t('archived.title')} sub={t('archived.sub')} />
        <Panel>
          {list.map((s) => (
            <div key={s.meta.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.meta.title}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {s.meta.kind === 'work' ? 'Work' : 'Code'} · {s.meta.scratch ? t('archived.tempWorkspace') : fname(s.meta.projectPath)}
                  {s.meta.branch ? ` · ${s.meta.branch}` : ''} · {ago(s.meta.updatedAt || Date.now(), true)}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => void unarchiveSession(s.meta.id)}><ArchiveRestoreIcon className="size-4" />{t('archived.unarchive')}</Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void deleteSession(s.meta.id)}><Trash2Icon className="size-4" />{t('archived.delete')}</Button>
            </div>
          ))}
          {!list.length && <Empty>{t('archived.empty')}</Empty>}
        </Panel>
      </div>
    </div>
  );
}
