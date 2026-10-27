import { memo, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, MessageCircleQuestionIcon, PencilLineIcon, XIcon } from 'lucide-react';
import type { Question, QuestionAnswer } from '@shared/protocol';
import { Markdown } from '@/components/common/Markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { answerUi } from '@/store/actions';
import { useT } from '@/lib/i18n';
import type { ItemOf } from '@/store/types';

const EMPTY: QuestionAnswer = { selected: [] };
const isAnswered = (a: QuestionAnswer) => a.selected.length > 0 || !!a.other?.trim();

/** The text form of one answer, for the collapsed summary. */
export const answerText = (a: QuestionAnswer | undefined) =>
  a && isAnswered(a) ? [...a.selected, ...(a.other?.trim() ? [a.other.trim()] : [])].join(', ') : '—';

function Indicator({ multi, on }: { multi: boolean; on: boolean }) {
  return (
    <span
      className={cn(
        'mt-0.5 flex size-4 shrink-0 items-center justify-center border transition-colors',
        multi ? 'rounded-[4px]' : 'rounded-full',
        on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
      )}
    >
      {on && (multi ? <CheckIcon className="size-3" /> : <span className="size-1.5 rounded-full bg-primary-foreground" />)}
    </span>
  );
}

function OptionRow({ multi, on, label, description, onClick, onPeek, children }: {
  multi: boolean; on: boolean; label: React.ReactNode; description?: string; onClick: () => void; onPeek?: () => void; children?: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-lg border transition-colors', on ? 'border-primary bg-primary/5' : 'hover:border-ring/60 hover:bg-accent/40')}>
      <button
        type="button"
        role={multi ? 'checkbox' : 'radio'}
        aria-checked={on}
        className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={onClick}
        onMouseEnter={onPeek}
        onFocus={onPeek}
      >
        <Indicator multi={multi} on={on} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{label}</span>
          {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
        </span>
      </button>
      {children}
    </div>
  );
}

function QuestionPane({ q, answer, onChange }: { q: Question; answer: QuestionAnswer; onChange: (a: QuestionAnswer) => void }) {
  const t = useT();
  const [peek, setPeek] = useState<number | null>(null);
  const [otherOn, setOtherOn] = useState(!!answer.other);
  const multi = q.multiSelect;
  const hasPreview = !multi && q.options.some((o) => o.preview);
  const shown = peek ?? Math.max(0, q.options.findIndex((o) => answer.selected.includes(o.label)));
  const preview = q.options[shown]?.preview;

  const pick = (label: string) => {
    if (multi) {
      const selected = answer.selected.includes(label) ? answer.selected.filter((s) => s !== label) : [...answer.selected, label];
      onChange({ ...answer, selected });
    } else {
      setOtherOn(false);
      onChange({ selected: [label] });
    }
  };
  const toggleOther = () => {
    const next = multi ? !otherOn : true;
    setOtherOn(next);
    onChange(multi ? { ...answer, other: next ? (answer.other ?? '') : undefined } : { selected: [], other: answer.other ?? '' });
  };

  return (
    <div className={cn('grid gap-3', hasPreview && 'md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]')}>
      <div className="flex min-w-0 flex-col gap-1.5" role={multi ? 'group' : 'radiogroup'} aria-label={q.question}>
        {q.options.map((o, i) => (
          <OptionRow key={o.label} multi={multi} on={answer.selected.includes(o.label)} label={o.label} description={o.description} onClick={() => pick(o.label)} onPeek={() => setPeek(i)} />
        ))}
        <OptionRow
          multi={multi}
          on={otherOn}
          label={<span className="flex items-center gap-1.5 text-muted-foreground"><PencilLineIcon className="size-3.5" />{t('q.other')}</span>}
          onClick={toggleOther}
          onPeek={() => setPeek(null)}
        >
          {otherOn && (
            <div className="px-3 pb-2.5 pl-[2.375rem]">
              <Input
                autoFocus
                className="h-8"
                placeholder={t('q.otherPh')}
                value={answer.other ?? ''}
                onChange={(e) => onChange({ ...answer, other: e.target.value })}
              />
            </div>
          )}
        </OptionRow>
      </div>
      {hasPreview && (
        <div className="min-w-0 rounded-lg border bg-muted/30" data-selectable>
          <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">{t('q.preview')}</div>
          <div className="max-h-60 overflow-auto p-3 text-sm">
            {preview ? <Markdown text={preview} /> : <span className="text-muted-foreground">{t('q.noPreview')}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export const QuestionsItem = memo(function QuestionsItem({ sid, item }: { sid: string; item: ItemOf<'ask'> }) {
  const t = useT();
  const r = item.request;
  const questions = r.kind === 'questions' ? r.questions : [];
  const [answers, setAnswers] = useState<QuestionAnswer[]>(() => questions.map(() => EMPTY));
  const [tab, setTab] = useState('0');
  const [collapsed, setCollapsed] = useState(false);
  const idx = Number(tab);

  if (item.resolved) {
    const done = item.resolved !== 'cancelled' && item.answers;
    return (
      <div className="rounded-xl border bg-card/60 px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {done ? <CheckIcon className="size-3.5 text-success" /> : <XIcon className="size-3.5 text-destructive" />}
          <span>{t(done ? 'q.answered' : 'q.dismissed')}</span>
        </div>
        {done && (
          <dl className="mt-1.5 space-y-1 text-sm">
            {questions.map((q, i) => (
              <div key={i} className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground">{q.header}</dt>
                <dd data-selectable className="min-w-0 font-medium">{answerText(item.answers?.[i])}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }

  const last = idx === questions.length - 1;
  const allDone = answers.every(isAnswered);
  const set = (i: number, a: QuestionAnswer) => setAnswers((prev) => prev.map((p, j) => (j === i ? a : p)));
  const submit = () =>
    answerUi(sid, item.key, {
      answers: answers.map((a) => ({ selected: a.selected, ...(a.other?.trim() ? { other: a.other.trim() } : {}) })),
    }, 'Answered');

  const toggle = (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0"
      aria-expanded={!collapsed}
      aria-label={t(collapsed ? 'q.expandQuestions' : 'q.collapseQuestions')}
      title={t(collapsed ? 'q.expand' : 'q.collapse')}
      onClick={() => setCollapsed((c) => !c)}
    >
      {collapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}
    </Button>
  );

  const answered = answers.filter(isAnswered).length;

  return (
    <div className="overflow-hidden rounded-xl border border-primary/40 bg-card shadow-sm">
      <Tabs value={tab} onValueChange={setTab} className="gap-0">
        <div className={cn('flex items-center gap-2 bg-muted/30 px-3.5 py-2 transition-[border-color] duration-200', collapsed ? 'border-b border-transparent' : 'border-b')}>
          <MessageCircleQuestionIcon className="size-4 shrink-0 text-primary" />
          {collapsed ? (
            <button type="button" className="min-w-0 flex-1 cursor-pointer truncate py-1 text-left text-sm" onClick={() => setCollapsed(false)}>
              <span className="font-medium">{questions[idx]?.question}</span>
              <span className="ml-2 text-xs text-muted-foreground">{answered}/{questions.length} answered</span>
            </button>
          ) : questions.length > 1 ? (
            <TabsList className="h-8 min-w-0 flex-1 justify-start overflow-x-auto bg-transparent p-0">
              {questions.map((q, i) => (
                <TabsTrigger key={i} value={String(i)} className="h-8 flex-none gap-1.5 px-2.5 data-[state=active]:border-border">
                  {isAnswered(answers[i]) ? <CheckIcon className="size-3.5 text-success" /> : <span className="size-1.5 rounded-full bg-muted-foreground/40" />}
                  {q.header}
                </TabsTrigger>
              ))}
            </TabsList>
          ) : (
            <span className="min-w-0 flex-1 truncate py-1 text-sm font-medium">{questions[0]?.header}</span>
          )}
          {!collapsed && questions.length > 1 && <span className="flex-1" />}
          {toggle}
        </div>
        {/* Rows animate between 1fr and 0fr, so the body slides shut without knowing its own height. */}
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
            collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
          )}
          aria-hidden={collapsed}
          inert={collapsed}
        >
          <div className="min-h-0 overflow-hidden">
            {/* The card never outgrows the window: long options and previews scroll inside it. */}
            <div className="max-h-[min(45vh,420px)] overflow-y-auto">
              {questions.map((q, i) => (
                <TabsContent key={i} value={String(i)} className="space-y-3 p-3.5">
                  <div>
                    <div data-selectable className="text-sm font-medium whitespace-pre-wrap">{q.question}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{t(q.multiSelect ? 'q.selectAll' : 'q.selectOne')}</div>
                  </div>
                  <QuestionPane q={q} answer={answers[i]} onChange={(a) => set(i, a)} />
                </TabsContent>
              ))}
            </div>
            <div className="flex items-center gap-2 border-t px-3.5 py-2.5">
              <Button variant="ghost" size="sm" onClick={() => answerUi(sid, item.key, { cancelled: true }, 'cancelled')}>{t('q.dismiss')}</Button>
              <div className="flex-1" />
              {idx > 0 && (
                <Button variant="outline" size="sm" onClick={() => setTab(String(idx - 1))}>
                  <ArrowLeftIcon /> {t('q.back')}
                </Button>
              )}
              {last ? (
                <Button size="sm" disabled={!allDone} onClick={submit}>{t('q.submit')}</Button>
              ) : (
                <Button size="sm" disabled={!isAnswered(answers[idx])} onClick={() => setTab(String(idx + 1))}>
                  {t('q.next')} <ArrowRightIcon />
                </Button>
              )}
            </div>
          </div>
        </div>
      </Tabs>
    </div>
  );
});
