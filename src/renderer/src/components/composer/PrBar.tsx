import {
  ArrowLeftIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
  GitPullRequestCreateIcon,
  GitPullRequestIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  SquareArrowOutUpRightIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { call } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { ago, fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { openDiffPanel, openPrComments, send, sessionDraftKey, setPrAuto } from '@/store/actions';
import { setPref, updateSession, useApp } from '@/store/app';
import { drafts } from '@/store/drafts';
import type { SessionView } from '@/store/types';
import type { SyncStrategy } from '@shared/protocol';
import { encodeCommandMessage, type BuiltinCommand } from '@shared/command-message';
import { forgeName, forgeWords } from '@shared/forge';
import { allowsPrRepair, DEFAULT_PR_BAR } from '@shared/pr-bar-settings';
import { gitActions, type GitAction, type GitActionItem } from './pr-actions';
import { fmtLines, prBadge, prCiLine, prRepo, prSize, type PrBadge, type PrLike, type PrTone } from '@shared/pr-status';

const DOT: Record<string, string> = {
  pass: 'bg-success',
  fail: 'bg-destructive',
  pending: 'bg-warning',
  none: 'bg-muted-foreground/60',
};
const ACTION_ICON: Record<GitAction, typeof ArrowUpIcon> = {
  pr: GitPullRequestCreateIcon,
  commit: GitCommitHorizontalIcon,
  push: ArrowUpIcon,
  sync: GitMergeIcon,
};
export const TONE: Record<PrTone, string> = {
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
/** The bar itself takes on the colour of the states that matter most; the rest stay neutral. */
const BAR_TONE: Partial<Record<PrTone, string>> = {
  merged: 'border-[#8957e5]/30 bg-[#8957e5]/5 hover:bg-[#8957e5]/8',
  conflict: 'border-warning/30 bg-warning/5 hover:bg-warning/8',
  closed: 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10',
};
const BAR_SURFACE = 'mb-2 flex min-w-0 items-center gap-2 rounded-lg surface-flat bg-chrome px-3 py-2 text-xs';
const STATE_COLOR: Record<string, string> = {
  open: 'text-success',
  merged: 'text-[#8957e5]',
  closed: 'text-destructive',
};
const CHECK_LABEL = { pass: 'prbar.checkPass', fail: 'prbar.checkFail', pending: 'prbar.checkPending' } as const;

/** Branch / PR status above the Code composer: what the branch still owes, and how to send it. */
export function PrBar({
  s,
  overview = false,
  onNavigate,
}: {
  s: SessionView;
  overview?: boolean;
  onNavigate?: () => void;
}) {
  const t = useT();
  const strategy = useApp((a) => a.prefs.syncStrategy);
  const settings = useApp((a) => a.settings.prBar ?? DEFAULT_PR_BAR);
  const armed = (allowsPrRepair(settings) && s.meta.autoFixCi) || (settings.autoMerge && s.meta.autoMerge);
  if (!settings.enabled || s.meta.kind === 'work' || !s.meta.branch) return null;
  if (!overview && (settings.placement !== 'composer' || s.prHidden || (!s.changes.length && !armed && !s.pr)))
    return null;
  const id = s.meta.id;
  const st = s.gitState;
  const pr = s.pr;
  const { actions, primary } = gitActions({
    branch: s.meta.branch,
    baseBranch: s.meta.baseBranch,
    st,
    pr: pr ?? (s.meta.prBinding ? s.meta.pr : null),
    binding: s.meta.prBinding,
    forge: pr?.forge ?? st?.forge,
    strategy,
  });
  // Nothing to commit, push or open: the bar would only restate the branch name.
  const available = actions.filter((a) => a.enabled);
  if (!overview && !armed && st && !pr && !st.behind && !st.baseBehind && !available.length) return null;
  // With nothing else to send, a base branch that moved on is the only thing the button offers.
  const current = available.find((a) => a.act === primary) ?? available.find((a) => a.act === 'sync');
  const ask = (command: BuiltinCommand, text: string) => {
    onNavigate?.();
    drafts.setText(sessionDraftKey(id), encodeCommandMessage(command, text));
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
  const showDiff = () => {
    onNavigate?.();
    openDiffPanel();
  };
  const surface = overview
    ? 'flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-chrome px-2 py-2 text-xs'
    : BAR_SURFACE;
  const diffChip =
    st && dirty > 0 && pending.length > 0 && !size ? (
      <span className="flex shrink-0 items-center font-mono text-xs whitespace-nowrap">
        <Lines add={add} del={del} title={t('prbar.viewDiff')} onClick={showDiff} />
      </span>
    ) : null;
  const hide = !overview && (
    <button
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      title={t('prbar.hide')}
      aria-label={t('prbar.hideBar')}
      onClick={() => updateSession(s.meta.id, (v) => void (v.prHidden = true))}
    >
      <XIcon className="size-3.5" />
    </button>
  );
  if (!pr) {
    return (
      <div data-slot="branch-bar" role="region" aria-label={t('prbar.status')} className={surface}>
        <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <BranchPath branch={s.meta.branch} baseBranch={s.meta.baseBranch} />
        <span className="flex-1" />
        {diffChip}
        <CiPanel s={s} pr={null} ask={ask} />
        {current && <SplitButton s={s} current={current} actions={available} primary={primary} run={ask} />}
        {hide}
      </div>
    );
  }
  const open = () => call('app:openExternal', pr.url);
  const badge = prBadge(pr);
  const color = pr.draft ? 'text-muted-foreground' : (STATE_COLOR[pr.state] ?? 'text-muted-foreground');
  const Icon = pr.state === 'merged' ? GitMergeIcon : GitPullRequestIcon;
  return (
    <div
      data-slot="branch-bar"
      role="region"
      aria-label={t('prbar.status')}
      className={cn(surface, 'group/pr', BAR_TONE[badge.tone])}
    >
      {overview && <PrCard pr={pr} repo={prRepo(pr.url, fname(s.meta.projectPath))} badge={badge} inline />}
      <div className="flex min-w-0 items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex min-w-0 cursor-default items-center gap-1.5">
              <button
                onClick={open}
                className={cn('flex shrink-0 items-center gap-1 font-medium tabular-nums', color)}
                title={`${badge.label} · ${pr.url}`}
              >
                {pr.mergeable === 'conflicting' ? (
                  <TriangleAlertIcon className="size-3.5 text-warning" />
                ) : (
                  <Icon className="size-3.5" />
                )}
                #{pr.num}
              </button>
              <BranchPath branch={s.meta.branch} baseBranch={s.meta.baseBranch} />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            sideOffset={10}
            className="pr-card max-w-none rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl"
          >
            <PrCard pr={pr} repo={prRepo(pr.url, fname(s.meta.projectPath))} badge={badge} />
          </TooltipContent>
        </Tooltip>
      </div>
      <span className="flex-1" />
      {diffChip}
      {size && (
        <Lines
          add={size.add}
          del={size.del}
          title={size.files != null ? t('prbar.filesDiff', { n: size.files }) : t('prbar.viewDiff')}
          onClick={showDiff}
        />
      )}
      {!!pr.comments && (
        <button
          className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t('prbar.viewComments')}
          onClick={() => {
            onNavigate?.();
            void openPrComments();
          }}
        >
          <MessageSquareIcon className="size-3.5" />
          {pr.comments}
        </button>
      )}
      {badge.tone === 'conflict' && (
        <Button
          size="xs"
          variant="outline"
          className="h-7 shrink-0 gap-1 border-warning/50 px-2 text-xs text-warning hover:text-warning"
          disabled={s.running}
          title={t('prbar.fixConflictsTip')}
          onClick={() =>
            ask(
              'fix-conflicts',
              t('prbar.conflictPrompt', {
                num: pr.num,
                base: pr.base ?? s.meta.baseBranch ?? t('gitact.targetFallback'),
              }),
            )
          }
        >
          <TriangleAlertIcon className="size-3" />
          {t('prbar.fixConflicts')}
        </Button>
      )}
      <CiPanel s={s} pr={pr} open={open} ask={ask} />
      {current && <SplitButton s={s} current={current} actions={available} primary={primary} run={ask} />}
      {hide}
    </div>
  );
}

function BranchPath({ branch, baseBranch }: { branch?: string | null; baseBranch?: string | null }) {
  const relation = !!baseBranch && !!branch && baseBranch !== branch;
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 overflow-hidden font-mono text-xs text-foreground/80"
      title={relation ? `${baseBranch} < ${branch}` : (branch ?? '')}
    >
      {relation ? (
        <>
          <span className="shrink-0 text-muted-foreground">{baseBranch}</span>
          <ArrowLeftIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{branch}</span>
        </>
      ) : (
        <span className="truncate">{branch}</span>
      )}
    </span>
  );
}

/** The card that answers "what is this PR?" without leaving the composer. */
function PrCard({ pr, repo, badge, inline = false }: { pr: PrLike; repo: string; badge: PrBadge; inline?: boolean }) {
  const t = useT();
  const size = prSize(pr);
  return (
    <div className={inline ? 'min-w-0 basis-full px-1 pb-1' : 'w-80 p-3'}>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium',
            TONE[badge.tone],
          )}
        >
          {badge.tone === 'conflict' && <TriangleAlertIcon className="size-3" />}
          {badge.label}
        </span>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {repo} <span className="opacity-60">#{pr.num}</span>
        </span>
        {!!pr.updatedAt && (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/80 tabular-nums">
            {ago(pr.updatedAt)}
          </span>
        )}
      </div>
      {pr.title && (
        <p className="mt-2 line-clamp-3 text-[13px] leading-snug font-semibold" data-selectable>
          {pr.title}
        </p>
      )}
      <div className="mt-2.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        {pr.author && <span className="truncate">{pr.author}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {size && <Lines add={size.add} del={size.del} />}
          {size?.files != null && <span className="tabular-nums">{t('prbar.files', { n: size.files })}</span>}
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
  const base = 'flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-xs leading-4 tabular-nums';
  return onClick ? (
    <button
      className={cn(
        base,
        'cursor-pointer transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
      )}
      aria-label={title}
      title={title}
      onClick={onClick}
    >
      {chip}
    </button>
  ) : (
    <span className={base} title={title}>
      {chip}
    </span>
  );
}

/** CI status in a chip, and the panel behind it: the checks themselves plus what the bar may do on its own. */
function CiPanel({
  s,
  pr,
  open,
  ask,
}: {
  s: SessionView;
  pr: PrLike | null;
  open?: () => void;
  ask: (command: BuiltinCommand, text: string) => void;
}) {
  const t = useT();
  const settings = useApp((a) => a.settings.prBar ?? DEFAULT_PR_BAR);
  const repair = allowsPrRepair(settings);
  const fixingCi = settings.fixCi && s.meta.autoFixCi;
  const checks = pr?.checks ?? [];
  const status = pr ? prCiLine(pr) : t('prbar.waitingForPr');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
          title={status}
        >
          <span
            className={cn('size-1.5 rounded-full', DOT[pr?.ci ?? 'none'], pr?.ci === 'pending' && 'animate-pulse')}
          />
          CI
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-72 p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <span className="text-[11.5px] font-medium">{t('prbar.ciMonitoring')}</span>
          {pr && (
            <button
              className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={t('prbar.openChecks', { forge: forgeName(pr.forge) })}
              onClick={open}
            >
              <SquareArrowOutUpRightIcon className="size-3.5" />
            </button>
          )}
        </div>
        <div className="px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            {pr?.ci === 'pending' ? (
              <LoaderCircleIcon className="size-3 shrink-0 animate-spin" />
            ) : !checks.length ? (
              <CircleDashedIcon className="size-3 shrink-0" />
            ) : null}
            {status}
          </p>
          {pr && !!checks.length && (
            <div className="space-y-0.5 mt-1.5 max-h-40 overflow-y-auto pr-1">
              {checks.map((c) => (
                <div key={c.n} className="flex items-center gap-2 py-0.5 text-[11.5px]">
                  <span className={cn('size-1.5 shrink-0 rounded-full', DOT[c.st])} />
                  {c.url ? (
                    <button
                      className="min-w-0 truncate text-left hover:text-foreground hover:underline"
                      title={t('prbar.openCheck', { forge: forgeName(pr.forge), name: c.n })}
                      onClick={() => call('app:openExternal', c.url!)}
                    >
                      {c.n}
                    </button>
                  ) : (
                    <span className="min-w-0 truncate" title={c.n}>
                      {c.n}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground/70">
                    {t(CHECK_LABEL[c.st])}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {(repair || settings.autoMerge) && (
          <div className="space-y-1 border-t px-3 py-2">
            {repair && (
              <label className="flex cursor-pointer items-start gap-2 py-0.5 text-[11.5px]">
                <Checkbox
                  className="mt-px size-3.5"
                  checked={!!s.meta.autoFixCi}
                  onCheckedChange={(v) => void setPrAuto(s.meta.id, { fixCi: v === true })}
                />
                <span>
                  {t(
                    settings.fixCi && settings.resolveConflicts && settings.addressComments
                      ? 'prbar.autoFix'
                      : 'prbar.autoFixAllowed',
                  )}
                </span>
              </label>
            )}
            {settings.autoMerge && (
              <label className="flex cursor-pointer items-start gap-2 py-0.5 text-[11.5px]">
                <Checkbox
                  className="mt-px size-3.5"
                  checked={!!s.meta.autoMerge}
                  onCheckedChange={(v) => void setPrAuto(s.meta.id, { merge: v === true })}
                />
                <span>{t('prbar.autoMerge')}</span>
              </label>
            )}
          </div>
        )}
        {pr?.ci === 'fail' && !fixingCi && (
          <>
            <div className="border-t" />
            <button
              className="w-full px-3 py-2 text-left text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() =>
                ask('fix-ci', t('prbar.fixCiPrompt', { checks: forgeWords(pr.forge).checks(pr.num), num: pr.num }))
              }
            >
              {t('prbar.fixOnce')}
            </button>
          </>
        )}
        {pr && ((repair && s.meta.autoFixCi) || (settings.autoMerge && s.meta.autoMerge)) && (
          <div className="border-t px-3 py-1.5 text-[10.5px] text-muted-foreground">{t('prbar.watching')}</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The default action plus a menu of the other ways to send the branch's work. */
function SplitButton({
  s,
  current,
  actions,
  primary,
  run,
}: {
  s: SessionView;
  current: GitActionItem;
  actions: GitActionItem[];
  primary: GitAction | null;
  run: (command: BuiltinCommand, text: string) => void;
}) {
  const t = useT();
  const { branch, baseBranch } = s.meta;
  const strategy = useApp((a) => a.prefs.syncStrategy);
  const showMenu = actions.length > 1 || current.act === 'sync';
  const ActionIcon = ACTION_ICON[current.act];
  return (
    <div className="flex shrink-0">
      <Button
        size="xs"
        variant="secondary"
        className={cn(
          'h-7 gap-1.5 border border-input bg-card px-2.5 text-xs shadow-surface hover:bg-accent',
          showMenu ? 'rounded-r-none' : 'rounded-md',
        )}
        disabled={s.running}
        title={current.hint}
        onClick={() => run(current.command, current.prompt)}
      >
        <ActionIcon className="size-3.5" />
        {current.label}
      </Button>
      {showMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="xs"
              variant="secondary"
              className="h-7 rounded-l-none border border-l-0 border-input bg-card px-1 text-xs shadow-surface hover:bg-accent"
              disabled={s.running}
              title={t('prbar.chooseSubmit')}
              aria-label={t('prbar.chooseSubmit')}
            >
              <ChevronDownIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-[22rem]">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              <BranchPath branch={branch} baseBranch={baseBranch} />
            </DropdownMenuLabel>
            {actions.map((a) => {
              const Icon = ACTION_ICON[a.act];
              return (
                <DropdownMenuItem
                  key={a.act}
                  onSelect={() => run(a.command, a.prompt)}
                  className="items-center gap-2 py-1.5"
                >
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/50 text-muted-foreground">
                    <Icon className="size-4" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-foreground">{a.label}</span>
                    <span className="block truncate text-[12px] leading-snug text-muted-foreground">{a.hint}</span>
                  </span>
                  <CheckIcon className={cn('ml-auto size-4 shrink-0 text-primary', a.act !== primary && 'invisible')} />
                </DropdownMenuItem>
              );
            })}
            {!!baseBranch && baseBranch !== branch && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">{t('gitact.strategy')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={strategy}
                  onValueChange={(v) => setPref('syncStrategy', v as SyncStrategy)}
                >
                  <DropdownMenuRadioItem value="merge" onSelect={(e) => e.preventDefault()}>
                    {t('gitact.strategyMerge')}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="rebase" onSelect={(e) => e.preventDefault()}>
                    {t('gitact.strategyRebase')}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
