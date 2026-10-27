import { GitPullRequestDraftIcon, GitPullRequestIcon, MessageCircleIcon, TriangleAlertIcon } from 'lucide-react';
import { TONE } from '@/components/composer/PrBar';
import { ago, fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { openSession } from '@/store/actions';
import { useApp } from '@/store/app';
import type { SessionView } from '@/store/types';
import { prBadge } from '@shared/pr-status';

/** Waiting on an approval or a question, or finished a turn the user has not looked at yet. */
const needsReply = (s: SessionView) => !!s.waiting || (s.unread && !s.running);

const byRecent = (a: SessionView, b: SessionView) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0);

function Row({ s, icon, note, badge }: { s: SessionView; icon: React.ReactNode; note: string; badge?: { label: string; className: string } }) {
  return (
    <button onClick={() => void openSession(s.meta.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-accent">
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{s.meta.title}</span>
      {badge && <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium', badge.className)}>{badge.label}</span>}
      <span className="shrink-0 text-xs text-muted-foreground">{note}</span>
    </button>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 px-2.5 text-xs font-medium text-muted-foreground">
        {title}
        <span className="rounded-full bg-muted px-1.5 text-[11px] leading-4">{count}</span>
      </div>
      {children}
    </div>
  );
}

/** Code mode's new-session page: code sessions to answer and PRs not yet merged. */
export function Inbox() {
  const sessions = useApp((st) => st.sessions);
  const mine = Object.values(sessions).filter((s) => !s.meta.archived && s.meta.kind === 'code');
  const replies = mine.filter(needsReply).sort((a, b) => Number(!!b.waiting) - Number(!!a.waiting) || byRecent(a, b));
  const prs = mine.filter((s) => s.pr?.state === 'open').sort(byRecent);
  if (!replies.length && !prs.length) return null;
  return (
    <div className="mt-6 w-full max-w-2xl space-y-4 text-left">
      {replies.length > 0 && (
        <Section title="Needs your reply" count={replies.length}>
          {replies.map((s) => (
            <Row
              key={s.meta.id}
              s={s}
              icon={s.waiting ? <TriangleAlertIcon className="size-3.5 text-warning" /> : <MessageCircleIcon className="size-3.5 text-primary" />}
              note={s.waiting ? 'Waiting for approval' : ago(s.meta.updatedAt || Date.now())}
            />
          ))}
        </Section>
      )}
      {prs.length > 0 && (
        <Section title="Open pull requests" count={prs.length}>
          {prs.map((s) => {
            const pr = s.pr!;
            const badge = prBadge(pr);
            return (
              <Row
                key={s.meta.id}
                s={s}
                icon={pr.draft ? <GitPullRequestDraftIcon className="size-3.5 text-muted-foreground" /> : <GitPullRequestIcon className="size-3.5 text-success" />}
                note={`#${pr.num} · ${fname(s.meta.projectPath)}`}
                badge={{ label: badge.label, className: TONE[badge.tone] }}
              />
            );
          })}
        </Section>
      )}
    </div>
  );
}
