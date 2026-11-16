// The Scheduled tasks page: saved prompts that start a fresh session on a schedule.
// Code and Work each show their own tasks (a task starts the kind of session its tab uses); it
// replaces the conversation area while open. Tasks run on this machine, so only while the app is open.
import { useState, type ReactNode } from 'react';
import { ClockIcon, PencilIcon, PlayIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { PermissionMode, SessionKind } from '@shared/protocol';
import {
  weekdayName,
  describeSchedule,
  parseTime,
  type ScheduledTask,
  type TaskDraft,
  type TaskSchedule,
} from '@shared/schedule';
import { DateTimePicker, TimePicker } from '@/components/common/DateTimePicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { BackButton, Empty, Field, Heading, Panel } from '@/customize/ui';
import { call, errText } from '@/lib/api';
import { MODES } from '@/lib/constants';
import { t as tr, useT } from '@/lib/i18n';
import { ago, fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { openSession } from '@/store/actions';
import { useApp } from '@/store/app';
import { dialogs } from '@/store/dialogs';

/** Radix items can't have an empty value, so "no folder" travels as this. */
const NONE = '__none';

function Pick({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: ReactNode }[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('w-full', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectGroup>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

const SCHEDULE_TYPES: TaskSchedule['type'][] = ['manual', 'hourly', 'daily', 'weekdays', 'weekly', 'once', 'cron'];

function withType(type: TaskSchedule['type'], prev: TaskSchedule): TaskSchedule {
  const time = 'time' in prev ? prev.time : '09:00';
  switch (type) {
    case 'manual':
    case 'hourly':
      return { type };
    case 'daily':
    case 'weekdays':
      return { type, time };
    case 'weekly':
      return { type, time, day: prev.type === 'weekly' ? prev.day : 1 };
    case 'once':
      return { type, at: prev.type === 'once' ? prev.at : Date.now() + 3600_000 };
    case 'cron':
      return { type, expr: prev.type === 'cron' ? prev.expr : '0 9 * * 1-5' };
  }
}

function ScheduleFields({ value, onChange }: { value: TaskSchedule; onChange: (s: TaskSchedule) => void }) {
  const t = useT();
  return (
    <div className="space-y-2">
      <Pick
        value={value.type}
        onChange={(type) => onChange(withType(type as TaskSchedule['type'], value))}
        options={SCHEDULE_TYPES.map((type) => ({ value: type, label: t(`scheduled.type.${type}`) }))}
      />
      <div className="flex flex-wrap items-center gap-2">
        {value.type === 'weekly' && (
          <Pick
            className="w-28"
            value={String(value.day)}
            onChange={(day) => onChange({ ...value, day: Number(day) })}
            options={Array.from({ length: 7 }, (_, i) => ({ value: String(i), label: weekdayName(i) }))}
          />
        )}
        {(value.type === 'daily' || value.type === 'weekdays' || value.type === 'weekly') && (
          <TimePicker value={value.time} onChange={(time) => onChange({ ...value, time })} />
        )}
        {value.type === 'once' && <DateTimePicker value={value.at} onChange={(at) => onChange({ ...value, at })} />}
        {value.type === 'cron' && (
          <Input
            className="w-64 font-mono"
            value={value.expr}
            onChange={(e) => onChange({ ...value, expr: e.target.value })}
            spellCheck={false}
            placeholder="0 9 * * 1-5"
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          value.type === 'cron'
            ? 'scheduled.hint.cron'
            : value.type === 'hourly'
              ? 'scheduled.hint.hourly'
              : 'scheduled.hint.local',
        )}
      </p>
    </div>
  );
}

function TaskForm({ initial, kind, onDone }: { initial: TaskDraft; kind: SessionKind; onDone: () => void }) {
  const t = useT();
  const projects = useApp((s) => s.projects);
  const folders = useApp((s) => s.workFolders);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<TaskDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const work = kind === 'work';
  const places = work ? folders : projects;
  // A saved folder may have been removed from the picker since.
  const options =
    draft.projectPath && !places.some((p) => p.path === draft.projectPath)
      ? [{ path: draft.projectPath, name: fname(draft.projectPath) }, ...places]
      : places;

  const save = async () => {
    const s = draft.schedule;
    if ((s.type === 'daily' || s.type === 'weekdays' || s.type === 'weekly') && !parseTime(s.time))
      return void toast.error(t('scheduled.needTime'));
    setBusy(true);
    try {
      await call('tasks:save', draft);
      toast.success(t('scheduled.saved'));
      onDone();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <BackButton onClick={onDone}>{t('scheduled.back')}</BackButton>
      <Heading title={t(initial.id ? 'scheduled.edit' : 'scheduled.new')} sub={t('scheduled.form.sub')} />
      <div className="space-y-4 rounded-xl border bg-card p-4">
        <Field label={t('scheduled.name')} hint={t('scheduled.name.hint')}>
          <Input
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder={t('scheduled.namePh')}
          />
        </Field>
        <Field label={t('scheduled.prompt')} hint={t('scheduled.prompt.hint')}>
          <Textarea
            value={draft.prompt}
            onChange={(e) => set({ prompt: e.target.value })}
            rows={6}
            placeholder={t('scheduled.promptPh')}
          />
        </Field>
        <Field
          label={t(work ? 'scheduled.folder' : 'scheduled.project')}
          hint={work ? t('scheduled.folder.hint') : undefined}
        >
          <Pick
            value={draft.projectPath ?? (work ? NONE : '')}
            onChange={(path) => set({ projectPath: path === NONE ? null : path })}
            placeholder={t('scheduled.pickProject')}
            options={[
              ...(work ? [{ value: NONE, label: t('scheduled.tempWorkspace') }] : []),
              ...options.map((p) => ({
                value: p.path,
                label: (
                  <>
                    {p.name || fname(p.path)}
                    <span className="ml-2 truncate text-xs text-muted-foreground">{p.path}</span>
                  </>
                ),
              })),
            ]}
          />
        </Field>
        {!work && (
          <Label className="items-start gap-3 leading-normal font-normal">
            <Switch checked={draft.worktree} onCheckedChange={(worktree) => set({ worktree })} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">{t('scheduled.worktree')}</span>
              <span className="block text-xs text-muted-foreground">{t('scheduled.worktree.hint')}</span>
            </span>
          </Label>
        )}
        <Field
          label={t('scheduled.mode')}
          hint={draft.mode === 'default' ? t('scheduled.mode.ask') : MODES.find((m) => m.id === draft.mode)?.desc}
        >
          <Pick
            value={draft.mode}
            onChange={(mode) => set({ mode: mode as PermissionMode })}
            options={MODES.map((m) => ({ value: m.id, label: m.name }))}
          />
        </Field>
        <Field label={t('scheduled.when')}>
          <ScheduleFields value={draft.schedule} onChange={(schedule) => set({ schedule })} />
        </Field>
        <div className="flex gap-2 pt-1">
          <Button onClick={() => void save()} disabled={busy}>
            {t('scheduled.save')}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            {t('scheduled.cancel')}
          </Button>
        </div>
      </div>
    </>
  );
}

const nextLabel = (task: ScheduledTask) =>
  !task.enabled
    ? tr(task.schedule.type === 'once' && task.lastRunAt ? 'scheduled.completed' : 'scheduled.paused')
    : task.nextRunAt
      ? tr('scheduled.next', {
          at: new Date(task.nextRunAt).toLocaleString([], {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        })
      : tr('scheduled.manualRun');

function TaskDetail({ task, onBack, onEdit }: { task: ScheduledTask; onBack: () => void; onEdit: () => void }) {
  const t = useT();
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      const meta = await call('tasks:run', task.id);
      await openSession(meta.id);
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setRunning(false);
    }
  };
  const remove = async () => {
    if (
      !(await dialogs.confirm(
        t('scheduled.deleteTitle', { name: task.name }),
        t('scheduled.deleteBody'),
        t('scheduled.delete'),
        true,
      ))
    )
      return;
    try {
      await call('tasks:remove', task.id);
      onBack();
    } catch (err) {
      toast.error(errText(err));
    }
  };
  const toggle = (on: boolean) => void call('tasks:setEnabled', task.id, on).catch((e) => toast.error(errText(e)));
  const place = task.projectPath ? fname(task.projectPath) : t('scheduled.tempWorkspace');
  return (
    <>
      <BackButton onClick={onBack}>{t('scheduled.back')}</BackButton>
      <Heading
        title={task.name}
        sub={`${describeSchedule(task.schedule)} · ${nextLabel(task)}`}
        action={
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={task.enabled}
              onCheckedChange={toggle}
              aria-label={t(task.enabled ? 'scheduled.pause' : 'scheduled.enable')}
            />
            <Button size="sm" variant="outline" onClick={() => void run()} disabled={running}>
              <PlayIcon className="size-3.5" />
              {t('scheduled.runNow')}
            </Button>
            <Button size="sm" variant="outline" onClick={onEdit}>
              <PencilIcon className="size-3.5" />
              {t('scheduled.editBtn')}
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => void remove()}>
              <Trash2Icon className="size-3.5" />
              {t('scheduled.delete')}
            </Button>
          </div>
        }
      />
      <div className="space-y-2 mb-4 rounded-xl border bg-card px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{place}</Badge>
          <Badge variant="secondary">{MODES.find((m) => m.id === task.mode)?.name ?? task.mode}</Badge>
          {task.worktree && <Badge variant="secondary">worktree</Badge>}
        </div>
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">{task.prompt}</p>
      </div>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">
        {t('scheduled.runs')}
        {task.runs.length ? ` · ${task.runs.length}` : ''}
      </h3>
      <Panel>
        {task.runs.map((r) => (
          <div key={`${r.at}-${r.sessionId ?? 'skipped'}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="w-16 shrink-0 text-xs text-muted-foreground" title={new Date(r.at).toLocaleString()}>
              {ago(r.at)}
            </span>
            {r.status === 'started' && r.sessionId ? (
              <button
                className="min-w-0 flex-1 truncate text-left hover:underline"
                onClick={() => void openSession(r.sessionId!)}
              >
                {t('scheduled.openSession')}
                {r.note && <span className="ml-2 text-xs text-muted-foreground">{r.note}</span>}
              </button>
            ) : (
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {t('scheduled.skipped')}
                {r.note ? ` · ${r.note}` : ''}
              </span>
            )}
          </div>
        ))}
        {!task.runs.length && <Empty>{t('scheduled.noRuns')}</Empty>}
      </Panel>
    </>
  );
}

const blank = (kind: SessionKind, projectPath: string | null): TaskDraft => ({
  name: '',
  prompt: '',
  kind,
  projectPath,
  worktree: false,
  mode: 'auto',
  model: null,
  schedule: { type: 'daily', time: '09:00' },
});
const editing = (t: ScheduledTask): TaskDraft => ({
  id: t.id,
  name: t.name,
  prompt: t.prompt,
  kind: t.kind,
  projectPath: t.projectPath,
  worktree: t.worktree,
  mode: t.mode,
  model: t.model,
  schedule: t.schedule,
});

export function ScheduledPage() {
  const t = useT();
  const view = useApp((s) => s.view);
  const all = useApp((s) => s.tasks);
  const project = useApp((s) => s.prefs.project);
  const folder = useApp((s) => s.prefs.workFolder);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<TaskDraft | null>(null);
  const tasks = all.filter((task) => task.kind === view);
  const current = open ? tasks.find((task) => task.id === open) : undefined;

  let body: ReactNode;
  if (form) {
    body = <TaskForm initial={form} kind={view} onDone={() => setForm(null)} />;
  } else if (current) {
    body = <TaskDetail task={current} onBack={() => setOpen(null)} onEdit={() => setForm(editing(current))} />;
  } else {
    body = (
      <>
        <Heading
          title={t('scheduled.title')}
          sub={t(view === 'work' ? 'scheduled.sub.work' : 'scheduled.sub.code')}
          action={
            <Button
              size="sm"
              className="shrink-0"
              onClick={() => setForm(blank(view, view === 'work' ? (folder ?? null) : project))}
            >
              <PlusIcon className="size-4" />
              {t('scheduled.newTask')}
            </Button>
          }
        />
        <Panel>
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-3 px-4 py-3">
              <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => setOpen(task.id)}>
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                  <ClockIcon className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{task.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {describeSchedule(task.schedule)} · {nextLabel(task)}
                    {task.projectPath ? ` · ${fname(task.projectPath)}` : ''}
                  </span>
                </span>
              </button>
              <Switch
                checked={task.enabled}
                onCheckedChange={(on) =>
                  void call('tasks:setEnabled', task.id, on).catch((e) => toast.error(errText(e)))
                }
                aria-label={t(task.enabled ? 'scheduled.pause' : 'scheduled.enable')}
              />
            </div>
          ))}
          {!tasks.length && <Empty>{t('scheduled.empty')}</Empty>}
        </Panel>
      </>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto">
      <div
        key={form ? `form:${form.id ?? 'new'}` : (current?.id ?? 'list')}
        className="mx-auto max-w-3xl animate-in px-8 py-8 duration-200 fade-in-0 slide-in-from-bottom-1"
      >
        {body}
      </div>
    </div>
  );
}
