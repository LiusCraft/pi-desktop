import { CheckIcon, GitBranchIcon, GitMergeIcon, GitPullRequestIcon, MessageSquareIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { call } from '@/lib/api';
import { fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { send, sessionDraftKey } from '@/store/actions';
import { updateSession } from '@/store/app';
import { drafts } from '@/store/drafts';
import type { SessionView } from '@/store/types';

const DOT: Record<string, string> = { pass: 'bg-success', fail: 'bg-destructive', pending: 'bg-warning', none: 'bg-muted-foreground' };

/** Branch / PR status above the Code composer, with shortcuts that become prompts. */
export function PrBar({ s }: { s: SessionView }) {
  if (s.meta.kind === 'cowork' || s.prHidden || !s.meta.branch) return null;
  const id = s.meta.id;
  // This bar reports live working-tree state, not the session-base diff the Diff panel shows,
  // so committing no longer looks like pending work.
  const st = s.gitState;
  const dirty = new Set(st?.dirty ?? []);
  const pending = s.changes.filter((f) => dirty.has(f.path));
  const ahead = st?.ahead ?? 0;
  // A PR needs a branch of its own and something to put in it.
  const canPr = !s.pr && s.meta.branch !== s.meta.baseBranch && (!st || st.dirty.length > 0 || ahead > 0);
  const draft = (text: string, go = false) => {
    drafts.setText(sessionDraftKey(id), text);
    if (go) void send(false);
  };
  const sync = () => {
    if (!st) return null;
    if (pending.length) {
      const add = pending.reduce((a, f) => a + f.add, 0), del = pending.reduce((a, f) => a + f.del, 0);
      return (
        <span className="flex gap-1 font-mono text-xs">
          <span className="text-success">+{add}</span>
          <span className="text-destructive">−{del}</span>
        </span>
      );
    }
    // Files that were already dirty before this session are not in `changes`; count them instead.
    if (st.dirty.length) return <span className="font-mono text-xs text-muted-foreground">{st.dirty.length} uncommitted</span>;
    if (ahead) return <span className="font-mono text-xs text-warning">{ahead} to push</span>;
    if (!st.upstream) return <span className="font-mono text-xs text-muted-foreground">not pushed</span>;
    return <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground"><CheckIcon className="size-3" />synced</span>;
  };
  if (!s.pr) {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs">
        <GitBranchIcon className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{fname(s.meta.projectPath)}</span>
        <span className="truncate font-mono text-muted-foreground" title={s.meta.branch}>{s.meta.branch}</span>
        <span className="flex-1" />
        {sync()}
        {canPr && (
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={s.running} onClick={() => draft(`提交当前所有改动（写一个清晰的 commit message），把分支 ${s.meta.branch} 推送到 origin，然后用 gh pr create 创建 PR，最后告诉我 PR 链接。`, true)}>
            Create PR
          </Button>
        )}
      </div>
    );
  }
  const pr = s.pr;
  const status = pr.state === 'merged' ? 'merged' : pr.state === 'closed' ? 'closed' : pr.draft ? 'draft' : 'open';
  const label = { open: 'Open', draft: 'Draft', closed: 'Closed', merged: 'Merged' }[status];
  const tone = { open: 'text-success', draft: 'text-muted-foreground', closed: 'text-destructive', merged: 'text-[#8957e5]' }[status];
  const open = () => call('app:openExternal', pr.url);
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs">
      <button onClick={open} className={cn('flex items-center gap-1 font-medium', tone)} title={pr.url}>
        {status === 'merged' ? <GitMergeIcon className="size-3.5" /> : <GitPullRequestIcon className="size-3.5" />}#{pr.num}
      </button>
      <span className="truncate text-muted-foreground" title={`${s.meta.projectPath} · ${s.meta.branch}`}>{fname(s.meta.projectPath)}</span>
      <span className="flex-1" />
      {sync()}
      {!!pr.comments && (
        <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground" title="Review comments" onClick={() => draft(`用 gh pr view ${pr.num} --comments 读取 PR #${pr.num} 的评审意见，逐条处理后提交并推送。`)}>
          <MessageSquareIcon className="size-3.5" />{pr.comments}
        </button>
      )}
      <button onClick={open} className={cn('font-medium', tone)}>{label}</button>
      {!!pr.checks?.length && (
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-accent">
            <span className={cn('size-2 rounded-full', DOT[pr.ci ?? 'none'])} />CI
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Checks · {pr.ci === 'pending' ? 'running' : pr.ci === 'pass' ? 'all passed' : 'failing'}</DropdownMenuLabel>
            {pr.checks.map((c) => (
              <div key={c.n} className="flex items-center gap-2 px-2 py-1 text-xs">
                <span className={cn('size-2 rounded-full', DOT[c.st])} />{c.n}
              </div>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => draft(`用 gh pr checks ${pr.num} --watch 盯着 PR #${pr.num} 的 CI；如果有检查失败，读取失败日志、修复、提交并推送，直到全部通过。`)}>盯着 CI，失败就自动修</DropdownMenuItem>
            <DropdownMenuItem onSelect={open}>Open on GitHub</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button className="text-muted-foreground hover:text-foreground" title="Hide" onClick={() => updateSession(s.meta.id, (v) => void (v.prHidden = true))}>
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
