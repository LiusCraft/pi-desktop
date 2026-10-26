// The Archived sessions page: sessions taken out of the sidebar but still on disk.
// Unarchive puts one back as it was; Delete forgets it for good (and its worktree).
import { ArchiveRestoreIcon, Trash2Icon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, Heading, Panel } from '@/customize/ui';
import { ago, fname } from '@/lib/format';
import { deleteSession, showWelcome, unarchiveSession } from '@/store/actions';
import { useApp } from '@/store/app';

export function ArchivedPage() {
  const sessions = useApp((s) => s.sessions);
  const list = Object.values(sessions)
    .filter((s) => s.meta.archived)
    .sort((a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0));
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto">
      <button className="absolute right-4 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="关闭" onClick={() => showWelcome()}>
        <XIcon className="size-4" />
      </button>
      <div className="mx-auto max-w-3xl animate-in px-8 py-8 duration-200 fade-in-0 slide-in-from-bottom-1">
        <Heading title="Archived sessions" sub="归档的会话不再出现在侧边栏，对话和 worktree 仍保留在磁盘上。恢复后和归档前一样；删除则连同它的 worktree 一起清掉（项目里的文件不受影响）。" />
        <Panel>
          {list.map((s) => (
            <div key={s.meta.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.meta.title}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {s.meta.kind === 'work' ? 'Work' : 'Code'} · {s.meta.scratch ? 'Temporary workspace' : fname(s.meta.projectPath)}
                  {s.meta.branch ? ` · ${s.meta.branch}` : ''} · {ago(s.meta.updatedAt || Date.now(), true)}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => void unarchiveSession(s.meta.id)}><ArchiveRestoreIcon className="size-4" />Unarchive</Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void deleteSession(s.meta.id)}><Trash2Icon className="size-4" />Delete</Button>
            </div>
          ))}
          {!list.length && <Empty>没有归档的会话。在侧边栏会话右边的「…」里选 Archive 就会放到这里。</Empty>}
        </Panel>
      </div>
    </div>
  );
}
