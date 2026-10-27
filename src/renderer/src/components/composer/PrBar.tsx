import {
  ArrowUpIcon, CheckIcon, ChevronDownIcon, CircleDashedIcon, GitBranchIcon, GitCommitHorizontalIcon, GitMergeIcon, GitPullRequestCreateIcon, GitPullRequestIcon,
  LoaderCircleIcon, MessageSquareIcon, SquareArrowOutUpRightIcon, TriangleAlertIcon, XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { call } from '@/lib/api';
import { ago, fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { openDiffPanel, openPrComments, send, sessionDraftKey, setPrAuto } from '@/store/actions';
import { updateSession } from '@/store/app';
import { drafts } from '@/store/drafts';
import type { SessionView } from '@/store/types';
import { forgeName, forgeWords } from '@shared/forge';
import { gitActions, type GitAction, type GitActionItem } from './pr-actions';
import { fmtLines, prBadge, prCiLine, prRepo, prSize, type PrBadge, type PrLike, type PrTone } from '@shared/pr-status';

const DOT: Record<string, string> = { pass: 'bg-success', fail: 'bg-destructive', pending: 'bg-warning', none: 'bg-muted-foreground/60' };
const ACTION_ICON: Record<GitAction, typeof ArrowUpIcon> = { pr: GitPullRequestCreateIcon, commit: GitCommitHorizontalIcon, push: ArrowUpIcon };
const TONE: Record<PrTone, string> = {
  conflict: 'bg-warning/15 text-warning',
  review: 'bg-warning/15 text-warning',
  fail: 'bg-destructive/15 text-destructive',
  running: 'bg-info/15 text-info',
  ready: 'bg-success/15 text-success',
  draft: 'bg-muted text-muted-foreground',
  open: 'bg-muted text-muted-foreground',
  merged: 'bg-[#8957e5]/15 text-[#8957e5]',
  closed: 'bg-destructive/15 text-destructive',
};
const STATE_COLOR: Record<string, string> = { open: 'text-success', merged: 'text-[#8957e5]', closed: 'text-destructive' };
const CHECK_LABEL: Record<string, string> = { pass: 'passed', fail: 'failed', pending: 'running' };

/** Branch / PR status above the Code composer: what the branch still owes, and how to send it. */
export function PrBar({ s }: { s: SessionView }) {
  if (s.meta.kind === 'work' || s.prHidden || !s.meta.branch) return null;
  const id = s.meta.id;
  const st = s.gitState;
  const pr = s.pr;
  const { actions, primary } = gitActions({ branch: s.meta.branch, baseBranch: s.meta.baseBranch, st, pr, forge: pr?.forge ?? st?.forge });
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
  // The PR's own size beats the working tree once there is one: that is the number that gets reviewed.
  const size = pr ? prSize(pr) : null;
  const sync = st && (
    <span className="flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-[11px]">
      {dirty > 0 && (pending.length > 0 && !size ? (
        <Lines add={add} del={del} title="查看 Diff" onClick={openDiffPanel} />
      ) : (
        <span className="text-muted-foreground">{dirty} uncommitted</span>
      ))}
      {st.ahead > 0 && <span className="text-warning">{st.ahead} to push</span>}
      {!st.upstream && <span className="text-muted-foreground">not pushed</span>}
      {!dirty && !st.ahead && st.upstream && <span className="flex items-center gap-1 text-muted-foreground"><CheckIcon className="size-3" />synced</span>}
    </span>
  );
  const hide = (
    <button
      className="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
      title="Hide"
      aria-label="Hide the branch bar"
      onClick={() => updateSession(s.meta.id, (v) => void (v.prHidden = true))}
    >
      <XIcon className="size-3.5" />
    </button>
  );
  if (!pr) {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-lg border bg-card/60 px-2.5 py-1.5 text-xs transition-colors hover:bg-card">
        <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 whitespace-nowrap font-medium">{fname(s.meta.projectPath)}</span>
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={s.meta.branch}>{s.meta.branch}</span>
        <span className="flex-1" />
        {sync}
        {current && <SplitButton s={s} current={current} actions={actions} primary={primary} run={ask} />}
        {hide}
      </div>
    );
  }
  const open = () => call('app:openExternal', pr.url);
  const badge = prBadge(pr);
  const color = pr.draft ? 'text-muted-foreground' : STATE_COLOR[pr.state] ?? 'text-muted-foreground';
  const Icon = pr.state === 'merged' ? GitMergeIcon : GitPullRequestIcon;
  return (
    <div className="group/pr mb-2 flex items-center gap-2 rounded-lg border bg-card/60 px-2.5 py-1.5 text-xs transition-colors hover:bg-card">
      <div className="flex min-w-0 items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex min-w-0 cursor-default items-center gap-1.5">
              <button onClick={open} className={cn('flex shrink-0 items-center gap-1 font-medium tabular-nums', color)} title={`${badge.label} · ${pr.url}`}>
                {pr.mergeable === 'conflicting' ? <TriangleAlertIcon className="size-3.5 text-warning" /> : <Icon className="size-3.5" />}#{pr.num}
              </button>
              <span className="truncate text-muted-foreground" title={s.meta.projectPath}>{fname(s.meta.projectPath)}</span>
              <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/70" title={s.meta.branch}>{s.meta.branch}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" sideOffset={10} className="pr-card max-w-none rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl">
            <PrCard pr={pr} repo={prRepo(pr.url, fname(s.meta.projectPath))} badge={badge} />
          </TooltipContent>
        </Tooltip>
      </div>
      <span className="flex-1" />
      {sync}
      {size && <Lines add={size.add} del={size.del} title={size.files != null ? `${size.files} files · 查看 Diff` : '查看 Diff'} onClick={openDiffPanel} />}
      {!!pr.comments && (
        <button
          className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="在 Diff 中查看评审意见"
          onClick={() => void openPrComments()}
        >
          <MessageSquareIcon className="size-3.5" />{pr.comments}
        </button>
      )}
      <CiPanel s={s} pr={pr} open={open} ask={ask} />
      {current && <SplitButton s={s} current={current} actions={actions} primary={primary} run={ask} />}
      {hide}
    </div>
  );
}

/** The card that answers "what is this PR?" without leaving the composer. */
function PrCard({ pr, repo, badge }: { pr: PrLike; repo: string; badge: PrBadge }) {
  const size = prSize(pr);
  return (
    <div className="w-80 p-3">
      <div className="flex items-center gap-2">
        <span className={cn('flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4', TONE[badge.tone])}>
          {badge.tone === 'conflict' && <TriangleAlertIcon className="size-3" />}
          {badge.label}
        </span>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {repo} <span className="opacity-60">#{pr.num}</span>
        </span>
        {!!pr.updatedAt && <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground/80">{ago(pr.updatedAt)}</span>}
      </div>
      {pr.title && <p className="mt-2 line-clamp-3 text-[13px] font-semibold leading-snug" data-selectable>{pr.title}</p>}
      <div className="mt-2.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        {pr.author && <span className="truncate">{pr.author}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {size && <Lines add={size.add} del={size.del} />}
          {size?.files != null && <span className="tabular-nums">{size.files} files</span>}
        </span>
      </div>
    </div>
  );
}

/** `+2,504 −132` in one chip: the size of the change, whatever its source. */
function Lines({ add, del, title, onClick }: { add: number; del: number; title?: string; onClick?: () => void }) {
  const chip = (
    <>
      <span className="text-success">+{fmtLines(add)}</span>
      <span className="text-destructive">−{fmtLines(del)}</span>
    </>
  );
  const base = 'flex shrink-0 items-center gap-1.5 rounded-md bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] leading-4 tabular-nums';
  return onClick ? (
    <button className={cn(base, 'cursor-pointer transition-colors hover:bg-accent')} title={title} onClick={onClick}>{chip}</button>
  ) : (
    <span className={base} title={title}>{chip}</span>
  );
}

/** CI status in a chip, and the panel behind it: the checks themselves plus what the bar may do on its own. */
function CiPanel({ s, pr, open, ask }: { s: SessionView; pr: PrLike; open: () => void; ask: (text: string) => void }) {
  const checks = pr.checks ?? [];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
          title={prCiLine(pr)}
        >
          <span className={cn('size-1.5 rounded-full', DOT[pr.ci ?? 'none'], pr.ci === 'pending' && 'animate-pulse')} />
          CI
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-72 p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <span className="text-[11.5px] font-medium">CI monitoring</span>
          <button className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" title={`Open checks on ${forgeName(pr.forge)}`} onClick={open}>
            <SquareArrowOutUpRightIcon className="size-3.5" />
          </button>
        </div>
        <div className="px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            {pr.ci === 'pending' ? <LoaderCircleIcon className="size-3 shrink-0 animate-spin" /> : !checks.length ? <CircleDashedIcon className="size-3 shrink-0" /> : null}
            {prCiLine(pr)}
          </p>
          {!!checks.length && (
            <div className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto pr-1">
              {checks.map((c) => (
                <div key={c.n} className="flex items-center gap-2 py-0.5 text-[11.5px]">
                  <span className={cn('size-1.5 shrink-0 rounded-full', DOT[c.st])} />
                  {c.url ? (
                    <button className="min-w-0 truncate text-left hover:text-foreground hover:underline" title={`在 ${forgeName(pr.forge)} 打开 ${c.n}`} onClick={() => call('app:openExternal', c.url!)}>{c.n}</button>
                  ) : (
                    <span className="min-w-0 truncate" title={c.n}>{c.n}</span>
                  )}
                  <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground/70">{CHECK_LABEL[c.st]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-1 border-t px-3 py-2">
          <label className="flex cursor-pointer items-start gap-2 py-0.5 text-[11.5px]">
            <Checkbox className="mt-px size-3.5" checked={!!s.meta.autoFixCi} onCheckedChange={(v) => void setPrAuto(s.meta.id, { fixCi: v === true })} />
            <span>Auto-fix CI &amp; address comments</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 py-0.5 text-[11.5px]">
            <Checkbox className="mt-px size-3.5" checked={!!s.meta.autoMerge} onCheckedChange={(v) => void setPrAuto(s.meta.id, { merge: v === true })} />
            <span>Auto-merge when ready</span>
          </label>
        </div>
        {pr.ci === 'fail' && !s.meta.autoFixCi && (
          <>
            <div className="border-t" />
            <button
              className="w-full px-3 py-2 text-left text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => ask(`用 ${forgeWords(pr.forge).checks(pr.num)} 读出 PR #${pr.num} 的失败原因，修好代码后提交并推送；未解决的评审意见一并处理，直到检查不再失败。`)}
            >
              让 Pi 现在处理这一次
            </button>
          </>
        )}
        {(s.meta.autoFixCi || s.meta.autoMerge) && (
          <div className="border-t px-3 py-1.5 text-[10.5px] text-muted-foreground">
            后台监听中：变化会作为事件发到对话里
          </div>
        )}
      </PopoverContent>
    </Popover>
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
