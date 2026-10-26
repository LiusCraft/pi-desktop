import {
  ArrowUpIcon, CheckIcon, ChevronDownIcon, GitBranchIcon, GitCommitHorizontalIcon, GitMergeIcon, GitPullRequestCreateIcon, GitPullRequestIcon, MessageSquareIcon, XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { call } from '@/lib/api';
import { fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { send, sessionDraftKey } from '@/store/actions';
import { updateSession } from '@/store/app';
import { drafts } from '@/store/drafts';
import type { SessionView } from '@/store/types';
import { gitActions, type GitAction, type GitActionItem } from './pr-actions';

const DOT: Record<string, string> = { pass: 'bg-success', fail: 'bg-destructive', pending: 'bg-warning', none: 'bg-muted-foreground' };
const ACTION_ICON: Record<GitAction, typeof ArrowUpIcon> = { pr: GitPullRequestCreateIcon, commit: GitCommitHorizontalIcon, push: ArrowUpIcon };

/** Branch / PR status above the Code composer: what the branch still owes, and how to send it. */
export function PrBar({ s }: { s: SessionView }) {
  if (s.meta.kind === 'cowork' || s.prHidden || !s.meta.branch) return null;
  const id = s.meta.id;
  const st = s.gitState;
  const pr = s.pr;
  const { actions, primary } = gitActions({ branch: s.meta.branch, baseBranch: s.meta.baseBranch, st, pr });
  const current = actions.find((a) => a.act === primary);
  const ask = (text: string) => {
    drafts.setText(sessionDraftKey(id), text);
    void send(false);
  };
  // Files already dirty before this session are not in `changes`; count those instead.
  const dirtySet = new Set(st?.dirty ?? []);
  const pending = s.changes.filter((f) => dirtySet.has(f.path));
  const add = pending.reduce((a, f) => a + f.add, 0);
  const del = pending.reduce((a, f) => a + f.del, 0);
  const dirty = st?.dirty.length ?? 0;
  const sync = st && (
    <span className="flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-xs">
      {dirty > 0 && (pending.length > 0 ? (
        <span className="flex gap-1"><span className="text-success">+{add}</span><span className="text-destructive">−{del}</span></span>
      ) : (
        <span className="text-muted-foreground">{dirty} uncommitted</span>
      ))}
      {st.ahead > 0 && <span className="text-warning">{st.ahead} to push</span>}
      {!st.upstream && <span className="text-muted-foreground">not pushed</span>}
      {!dirty && !st.ahead && st.upstream && <span className="flex items-center gap-1 text-muted-foreground"><CheckIcon className="size-3" />synced</span>}
    </span>
  );
  const hide = (
    <button className="shrink-0 text-muted-foreground hover:text-foreground" title="Hide" onClick={() => updateSession(s.meta.id, (v) => void (v.prHidden = true))}>
      <XIcon className="size-3.5" />
    </button>
  );
  if (!pr) {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs">
        <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 whitespace-nowrap font-medium">{fname(s.meta.projectPath)}</span>
        <span className="min-w-0 truncate font-mono text-muted-foreground" title={s.meta.branch}>{s.meta.branch}</span>
        <span className="flex-1" />
        {sync}
        {current && <SplitButton s={s} current={current} actions={actions} primary={primary} run={ask} />}
        {hide}
      </div>
    );
  }
  const status = pr.state === 'merged' ? 'merged' : pr.state === 'closed' ? 'closed' : pr.draft ? 'draft' : 'open';
  const label = { open: 'Open', draft: 'Draft', closed: 'Closed', merged: 'Merged' }[status];
  const tone = { open: 'text-success', draft: 'text-muted-foreground', closed: 'text-destructive', merged: 'text-[#8957e5]' }[status];
  const open = () => call('app:openExternal', pr.url);
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs">
      <button onClick={open} className={cn('flex shrink-0 items-center gap-1 whitespace-nowrap font-medium', tone)} title={pr.url}>
        {status === 'merged' ? <GitMergeIcon className="size-3.5" /> : <GitPullRequestIcon className="size-3.5" />}#{pr.num}
      </button>
      <span className="min-w-0 truncate text-muted-foreground" title={`${s.meta.projectPath} · ${s.meta.branch}`}>{fname(s.meta.projectPath)}</span>
      <span className="flex-1" />
      {sync}
      {!!pr.comments && (
        <button className="flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground" title="Review comments" onClick={() => ask(`用 gh pr view ${pr.num} --comments 读取 PR #${pr.num} 的评审意见，逐条处理后提交并推送。`)}>
          <MessageSquareIcon className="size-3.5" />{pr.comments}
        </button>
      )}
      <button onClick={open} className={cn('shrink-0 whitespace-nowrap font-medium', tone)}>{label}</button>
      {!!pr.checks?.length && (
        <DropdownMenu>
          <DropdownMenuTrigger className="flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-accent">
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
            <DropdownMenuItem onSelect={() => ask(`用 gh pr checks ${pr.num} --watch 盯着 PR #${pr.num} 的 CI；如果有检查失败，读取失败日志、修复、提交并推送，直到全部通过。`)}>盯着 CI，失败就自动修</DropdownMenuItem>
            <DropdownMenuItem onSelect={open}>Open on GitHub</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {current && <SplitButton s={s} current={current} actions={actions} primary={primary} run={ask} />}
      {hide}
    </div>
  );
}

/** The default action plus a menu of the other ways to send the branch's work. */
function SplitButton({ s, current, actions, primary, run }: {
  s: SessionView;
  current: GitActionItem;
  actions: GitActionItem[];
  primary: GitAction | null;
  run: (text: string) => void;
}) {
  const { branch, baseBranch } = s.meta;
  return (
    <div className="flex shrink-0">
      <Button size="xs" variant="outline" className="h-6 rounded-r-none px-2 text-xs" disabled={s.running} title={current.hint} onClick={() => run(current.prompt)}>
        {current.label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="xs" variant="outline" className="h-6 rounded-l-none border-l-0 px-1 text-xs" disabled={s.running} title="Choose what to submit" aria-label="Choose what to submit">
            <ChevronDownIcon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-64">
          <DropdownMenuLabel className="flex items-baseline gap-1 text-xs text-muted-foreground">
            <span className="truncate">{branch}</span>
            {baseBranch && baseBranch !== branch && <span className="shrink-0 whitespace-nowrap opacity-70">→ {baseBranch}</span>}
          </DropdownMenuLabel>
          {actions.map((a) => {
            const Icon = ACTION_ICON[a.act];
            return (
              <DropdownMenuItem key={a.act} disabled={!a.enabled} onSelect={() => run(a.prompt)} className="items-start gap-2 py-1.5">
                <CheckIcon className={cn('mt-0.5 size-3.5 shrink-0', a.act !== primary && 'invisible')} />
                <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate">{a.label}</span>
                  <span className="block text-xs text-muted-foreground">{a.hint}</span>
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
