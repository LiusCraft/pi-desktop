// The request log's list: one line per request, newest first. A line opens to its details.
import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { toast } from 'sonner';
import { REQUEST_PAGE_SIZE, REQUEST_STATUS, type RequestRecord, type RequestStatus } from '@shared/request-log';
import type { MessageKey } from '@shared/i18n';
import { Button } from '@/components/ui/button';
import { call, errText } from '@/lib/api';
import { fmtCost, fmtMs, fmtTok } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { openSession } from '@/store/actions';
import { useApp } from '@/store/app';
import { purposeLabel, originKey } from './origin';

const fail = (err: unknown) => toast.error(errText(err));

/** From this status up the vendor refused the request; a failed stream behind a 200 has none worth showing. */
const HTTP_ERROR = 400;
const STATUS_LABEL: Record<RequestStatus, MessageKey> = {
  ok: 'privacy.status.ok',
  error: 'privacy.status.error',
  aborted: 'privacy.status.aborted',
};
const STATUS_DOT: Record<RequestStatus, string> = {
  ok: 'bg-emerald-400',
  error: 'bg-destructive',
  aborted: 'bg-muted-foreground',
};

/** Columns of the list; the model takes what is left. */
const COLUMNS = 'grid-cols-[4.25rem_6rem_6rem_minmax(6rem,1fr)_2.75rem_2.75rem_4.25rem_4.5rem_3.5rem_4.25rem]';

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const time = (at: number) =>
  sameDay(at, Date.now())
    ? new Date(at).toLocaleTimeString(undefined, { hour12: false })
    : new Date(at).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });

const COLUMN_LABELS: MessageKey[] = [
  'privacy.col.time',
  'privacy.col.session',
  'privacy.col.purpose',
  'privacy.col.model',
  'privacy.col.input',
  'privacy.col.output',
  'privacy.col.cacheRead',
  'privacy.col.cacheWrite',
  'privacy.col.duration',
  'privacy.col.status',
];
/** The columns that hold numbers, which sit to the right. */
const NUMERIC = new Set([4, 5, 6, 7, 8]);

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all">{children}</dd>
    </>
  );
}

/** The session a request was made in: its title, which opens it; a deleted one says so. */
function SessionLink({ id, className }: { id: string | undefined; className?: string }) {
  const t = useT();
  const session = useApp((s) => (id ? s.sessions[id] : undefined));
  if (!id) return <span className={cn('text-muted-foreground', className)}>—</span>;
  if (!session)
    return <span className={cn('truncate text-muted-foreground', className)}>{t('activity.deletedSession')}</span>;
  return (
    <span
      role="link"
      tabIndex={0}
      title={session.meta.title}
      className={cn('truncate hover:underline', className)}
      onClick={(e) => {
        e.stopPropagation();
        if (!session.meta.archived) void openSession(id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.stopPropagation();
          if (!session.meta.archived) void openSession(id);
        }
      }}
    >
      {session.meta.title}
    </span>
  );
}

function Details({ r, showBody }: { r: RequestRecord; showBody: boolean }) {
  const t = useT();
  const masked = r.masked
    ? Object.entries(r.masked)
        .map(([k, n]) => `${k} ×${n}`)
        .join(', ')
    : '';
  const fullTime = new Date(r.at).toLocaleString();
  return (
    <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 bg-muted/30 px-4 py-3 text-xs">
      <Detail label={t('privacy.col.time')}>{fullTime}</Detail>
      <Detail label={t('privacy.col.status')}>
        {t(STATUS_LABEL[r.status])}
        {r.httpStatus ? ` · HTTP ${r.httpStatus}` : ''}
      </Detail>
      <Detail label={t('privacy.col.duration')}>
        {fmtMs(r.durationMs)}
        {r.firstTokenMs !== undefined ? ` · ${t('privacy.d.firstToken')} ${fmtMs(r.firstTokenMs)}` : ''}
      </Detail>
      <Detail label={t('privacy.d.model')}>{r.model}</Detail>
      <Detail label={t('privacy.col.provider')}>{r.provider}</Detail>
      <Detail label={t('privacy.col.session')}>
        <SessionLink id={r.sessionId} className="inline-block max-w-full align-bottom" />
      </Detail>
      <Detail label={t('privacy.col.purpose')}>{purposeLabel(originKey(r))}</Detail>
      <Detail label={t('privacy.d.tokens')}>
        {t('privacy.d.tokensValue', {
          input: r.tokens.input.toLocaleString(),
          output: r.tokens.output.toLocaleString(),
          read: r.tokens.cacheRead.toLocaleString(),
          write: r.tokens.cacheWrite.toLocaleString(),
        })}
      </Detail>
      <Detail label={t('privacy.d.cost')}>{r.unpriced ? t('privacy.d.noPrice') : fmtCost(r.cost)}</Detail>
      {r.sessionId && (
        <Detail label={t('privacy.d.session')}>
          <span className="font-mono">{r.sessionId}</span>
        </Detail>
      )}
      {masked && <Detail label={t('privacy.col.masked')}>{masked}</Detail>}
      {r.error && (
        <Detail label={t('privacy.d.error')}>
          <span className="text-destructive">{r.error}</span>
        </Detail>
      )}
      {showBody && r.body && (
        <Detail label={t('privacy.body')}>
          <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono whitespace-pre-wrap">{r.body}</pre>
        </Detail>
      )}
    </dl>
  );
}

function RequestRow({
  r,
  open,
  onToggle,
  showBody,
}: {
  r: RequestRecord;
  open: boolean;
  onToggle: () => void;
  showBody: boolean;
}) {
  const t = useT();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          'grid w-full cursor-pointer items-center gap-x-2 px-4 py-2 text-left text-xs hover:bg-accent/40',
          COLUMNS,
        )}
      >
        <span className="flex items-center gap-1 text-muted-foreground tabular-nums">
          <ChevronRightIcon className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
          {time(r.at)}
        </span>
        <SessionLink id={r.sessionId} />
        <span className="truncate text-muted-foreground" title={purposeLabel(originKey(r))}>
          {purposeLabel(originKey(r))}
        </span>
        <span className="truncate" title={`${r.provider}/${r.model}`}>
          {r.model}
        </span>
        <span className="text-right tabular-nums">{fmtTok(r.tokens.input)}</span>
        <span className="text-right tabular-nums">{fmtTok(r.tokens.output)}</span>
        <span className="text-right text-muted-foreground tabular-nums">{fmtTok(r.tokens.cacheRead)}</span>
        <span className="text-right text-muted-foreground tabular-nums">{fmtTok(r.tokens.cacheWrite)}</span>
        <span className="text-right tabular-nums">{fmtMs(r.durationMs)}</span>
        <span className={cn('flex items-center gap-1.5', r.status !== REQUEST_STATUS.ok && 'text-destructive')}>
          <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[r.status])} />
          {t(STATUS_LABEL[r.status])}
          {r.httpStatus && r.httpStatus >= HTTP_ERROR ? ` ${r.httpStatus}` : ''}
        </span>
      </button>
      {open && <Details r={r} showBody={showBody} />}
    </div>
  );
}

export function RequestList() {
  const t = useT();
  const [showBody, setShowBody] = useState(false);
  const [records, setRecords] = useState<RequestRecord[] | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = async (before?: number) => {
    try {
      const page = await call('requests:list', { limit: REQUEST_PAGE_SIZE, before });
      setRecords((prev) => (before ? [...(prev ?? []), ...page] : page));
      setMore(page.length === REQUEST_PAGE_SIZE);
    } catch (err) {
      fail(err);
    }
  };
  useEffect(() => {
    void load();
    void call('requests:getSettings')
      .then((s) => setShowBody(s.logBody))
      .catch(fail);
  }, []);

  return (
    <section>
      <h3 className="mb-2 px-1 text-sm font-semibold">{t('privacy.group.requests')}</h3>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className={cn('grid gap-x-2 border-b px-4 py-2 text-xs text-muted-foreground', COLUMNS)}>
          {COLUMN_LABELS.map((key, i) => (
            <span key={key} className={cn('truncate', NUMERIC.has(i) && 'text-right')}>
              {t(key)}
            </span>
          ))}
        </div>
        <div className="divide-y">
          {records && records.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('privacy.empty')}</p>
          )}
          {records?.map((r) => (
            <RequestRow
              key={r.id}
              r={r}
              open={open === r.id}
              onToggle={() => setOpen(open === r.id ? null : r.id)}
              showBody={showBody}
            />
          ))}
        </div>
        {more && records && (
          <div className="flex justify-center border-t px-4 py-2.5">
            <Button size="sm" variant="ghost" onClick={() => void load(records[records.length - 1].at)}>
              {t('privacy.more')}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
