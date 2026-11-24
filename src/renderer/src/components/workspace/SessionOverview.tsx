import { useState, type ReactNode } from 'react';
import {
  ChevronRightIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  InfoIcon,
  LaptopIcon,
  ListTreeIcon,
  MessageSquareIcon,
  PlusIcon,
} from 'lucide-react';
import { fmtLines, prBadge, prCiLine, prSize, type PrLike } from '@shared/pr-status';
import { sideWindowKey, type SideChatSummary } from '@shared/protocol';
import { PrBar, TONE } from '@/components/composer/PrBar';
import { DEFAULT_PR_BAR } from '@shared/pr-bar-settings';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { call } from '@/lib/api';
import { fname } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { fail, togglePanel, toggleSessionInfo } from '@/store/actions';
import { useApp } from '@/store/app';
import { createSide, openSide, useSide, useSideList } from '@/store/side';
import type { SessionView } from '@/store/types';
import { IconBtn } from './PanelToolbar';

const ROW =
  'flex min-w-0 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';
const HEADING = 'px-2 py-1 text-xs font-medium text-muted-foreground';

export function sideChatLabel(t: ReturnType<typeof useT>, chat: SideChatSummary | undefined, index: number) {
  return chat?.title || (index >= 0 ? t('side.numbered', { n: index + 1 }) : t('side.title'));
}

function Lines({ add, del }: { add: number; del: number }) {
  return (
    <span className="flex shrink-0 gap-1.5 font-mono text-xs tabular-nums">
      <span className="text-success">+{fmtLines(add)}</span>
      <span className="text-destructive">−{fmtLines(del)}</span>
    </span>
  );
}

function PrBadge({ pr }: { pr: PrLike }) {
  const { label, tone } = prBadge(pr);
  return <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs', TONE[tone])}>{label}</span>;
}

function useEnvironmentName() {
  const t = useT();
  const remote = useApp((st) => st.remote);
  return remote?.name || remote?.host || t('overview.local');
}

/** Quick look at the active session, not a second copy of its metadata or git state. */
export function SessionOverview({ s }: { s: SessionView }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const sid = s.meta.id;
  const { chats, error } = useSideList(sid, open);
  const windows = useSide((st) => st.windows);
  const prBar = useApp((st) => st.settings.prBar ?? DEFAULT_PR_BAR);
  const env = useEnvironmentName();
  const pr = s.pr;
  const work = s.meta.kind === 'work';
  const lines = s.changes.reduce(({ add, del }, file) => ({ add: add + file.add, del: del + file.del }), {
    add: 0,
    del: 0,
  });
  const project = s.meta.scratch ? t('main.tempWorkspace') : fname(s.meta.projectPath);
  const branch = s.meta.branch ? `${project} · ${s.meta.branch}` : project;
  const openInfo = () => {
    setOpen(false);
    toggleSessionInfo(sid, true);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconBtn title={t('overview.title')} className="no-drag data-[state=open]:bg-accent">
          <ListTreeIcon className="size-4" aria-hidden />
        </IconBtn>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        aria-label={t('overview.title')}
        className="max-h-[var(--radix-popover-content-available-height)] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl p-2"
      >
        <button type="button" aria-label={t('overview.summary')} className={cn(ROW, 'items-start')} onClick={openInfo}>
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium" title={s.meta.title}>
              {s.meta.title}
            </span>
            <span className="line-clamp-2 text-xs break-words text-muted-foreground">
              {s.meta.description || t('overview.noSummary')}
            </span>
          </span>
          <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        <button type="button" className={ROW} onClick={openInfo}>
          <LaptopIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="shrink-0">{t('overview.environment')}</span>
          <span className="ml-auto truncate text-xs text-muted-foreground" title={env}>
            {env}
          </span>
        </button>
        {!work && (
          <>
            <section className="mt-1 border-t pt-1" aria-label={t('panel.changes')}>
              <h2 className={HEADING}>{t('panel.changes')}</h2>
              <button
                type="button"
                className={ROW}
                onClick={() => {
                  setOpen(false);
                  togglePanel(sid, 'diff', true);
                }}
              >
                <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate" title={branch}>
                  {branch}
                </span>
                <Lines {...lines} />
              </button>
            </section>
            {prBar.enabled && (
              <section className="mt-1 border-t pt-1" aria-label={t('overview.pullRequests')}>
                <h2 className={HEADING}>{t('overview.pullRequests')}</h2>
                {prBar.placement === 'overview' && s.meta.branch && (
                  <PrBar s={s} overview onNavigate={() => setOpen(false)} />
                )}
                {prBar.placement === 'composer' && pr ? (
                  <button type="button" className={ROW} onClick={openInfo}>
                    <GitPullRequestIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="flex-1 truncate" title={pr.title}>
                      #{pr.num}
                      {pr.title && ` · ${pr.title}`}
                    </span>
                    <PrBadge pr={pr} />
                  </button>
                ) : !pr ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('overview.noPr')}</p>
                ) : null}
              </section>
            )}
          </>
        )}
        <section className="mt-1 border-t pt-1" aria-label={t('side.list')}>
          <h2 className={HEADING}>{t('side.list')}</h2>
          {chats.map((chat, index) => {
            const label = sideChatLabel(t, chat, index);
            const popped = !!windows[sideWindowKey(sid, chat.id)];
            return (
              <button
                key={chat.id}
                type="button"
                className={ROW}
                title={label}
                onClick={() => {
                  setOpen(false);
                  void openSide(sid, chat.id).catch(fail);
                }}
              >
                <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate">{label}</span>
                {popped && <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
              </button>
            );
          })}
          {error && (
            <p role="alert" className="px-2 py-1 text-xs break-words text-destructive">
              {error}
            </p>
          )}
          <button
            type="button"
            className={ROW}
            onClick={() => {
              setOpen(false);
              void createSide(sid).catch(fail);
            }}
          >
            <PlusIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {t('side.new')}
          </button>
        </section>
      </PopoverContent>
    </Popover>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5 min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words" data-selectable>
        {children}
      </dd>
    </div>
  );
}

/** A durable reading surface for the information previewed in the titlebar. */
export function SessionInfo({ s }: { s: SessionView }) {
  const t = useT();
  const env = useEnvironmentName();
  const { meta, gitState, pr } = s;
  const prBar = useApp((st) => st.settings.prBar ?? DEFAULT_PR_BAR);
  const size = pr && prSize(pr);
  const model = s.model ?? meta.model;
  return (
    <div className="space-y-4 h-full overflow-y-auto p-4">
      <section className="space-y-1">
        <h2 className="text-xs font-medium text-muted-foreground">{t('overview.summary')}</h2>
        <p data-selectable className="font-semibold break-words">
          {meta.title}
        </p>
        <p data-selectable className="text-sm break-words whitespace-pre-wrap text-muted-foreground">
          {meta.description || t('overview.noSummary')}
        </p>
      </section>
      <section className="space-y-2 border-t pt-3">
        <h2 className="text-sm font-medium">{t('overview.environment')}</h2>
        <dl className="grid gap-2">
          <Field label={t('overview.environment')}>
            {env} · {t(meta.scratch ? 'main.tempWorkspace' : meta.worktree ? 'overview.worktree' : 'overview.checkout')}
          </Field>
          {!meta.scratch && <Field label={t('overview.project')}>{meta.projectPath}</Field>}
          <Field label={t('overview.cwd')}>{meta.cwd}</Field>
          {!!model && <Field label={t('overview.model')}>{model}</Field>}
          <Field label={t('overview.permissions')}>{t(`mode.${meta.mode}`)}</Field>
          {!!meta.branch && <Field label={t('overview.branch')}>{meta.branch}</Field>}
          {!!meta.baseBranch && <Field label={t('overview.base')}>{meta.baseBranch}</Field>}
          {!!gitState?.upstream && (
            <Field label={t('overview.upstream')}>
              {gitState.upstream}
              <span className="block text-xs text-muted-foreground">
                {t('overview.branchStatus', { ahead: gitState.ahead, behind: gitState.behind })}
              </span>
            </Field>
          )}
        </dl>
      </section>
      {meta.kind === 'code' && prBar.enabled && (
        <section className="space-y-2 border-t pt-3">
          <h2 className="text-sm font-medium">{t('overview.pullRequests')}</h2>
          {pr ? (
            <>
              <button
                type="button"
                className={cn(ROW, 'px-0 hover:underline')}
                onClick={() => void call('app:openExternal', pr.url).catch(fail)}
              >
                <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 break-words">
                  #{pr.num}
                  {pr.title && ` · ${pr.title}`}
                </span>
              </button>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <PrBadge pr={pr} />
                {pr.ci !== undefined && <span>{prCiLine(pr)}</span>}
                {size && <Lines add={size.add} del={size.del} />}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{t('overview.noPr')}</p>
          )}
        </section>
      )}
    </div>
  );
}
