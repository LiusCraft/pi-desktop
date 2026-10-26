// The Scheduled tasks page: saved prompts that start a fresh session on a schedule.
// Code and Work each show their own tasks (a task starts the kind of session its tab uses); it
// replaces the conversation area while open. Tasks run on this machine, so only while the app is open.
import { useState, type ReactNode } from 'react';
import { ClockIcon, PencilIcon, PlayIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { PermissionMode, SessionKind } from '@shared/protocol';
import { WEEKDAYS, describeSchedule, parseTime, type ScheduledTask, type TaskDraft, type TaskSchedule } from '@shared/schedule';
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
import { ago, fname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { openSession, showWelcome } from '@/store/actions';
import { useApp } from '@/store/app';
import { dialogs } from '@/store/dialogs';

/** Radix items can't have an empty value, so "no folder" travels as this. */
const NONE = '__none';

function Pick({ value, onChange, options, placeholder, className }: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: ReactNode }[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('w-full', className)}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent position="popper"><SelectGroup>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectGroup></SelectContent>
    </Select>
  );
}

const SCHEDULE_TYPES: { id: TaskSchedule['type']; label: string }[] = [
  { id: 'manual', label: '手动（只在点「立即运行」时）' },
  { id: 'hourly', label: '每小时' },
  { id: 'daily', label: '每天' },
  { id: 'weekdays', label: '工作日' },
  { id: 'weekly', label: '每周' },
  { id: 'once', label: '只运行一次' },
  { id: 'cron', label: '自定义 cron' },
];

function withType(type: TaskSchedule['type'], prev: TaskSchedule): TaskSchedule {
  const time = 'time' in prev ? prev.time : '09:00';
  switch (type) {
    case 'manual': case 'hourly': return { type };
    case 'daily': case 'weekdays': return { type, time };
    case 'weekly': return { type, time, day: prev.type === 'weekly' ? prev.day : 1 };
    case 'once': return { type, at: prev.type === 'once' ? prev.at : Date.now() + 3600_000 };
    case 'cron': return { type, expr: prev.type === 'cron' ? prev.expr : '0 9 * * 1-5' };
  }
}

function ScheduleFields({ value, onChange }: { value: TaskSchedule; onChange: (s: TaskSchedule) => void }) {
  return (
    <div className="space-y-2">
      <Pick value={value.type} onChange={(type) => onChange(withType(type as TaskSchedule['type'], value))} options={SCHEDULE_TYPES.map((t) => ({ value: t.id, label: t.label }))} />
      <div className="flex flex-wrap items-center gap-2">
        {value.type === 'weekly' && (
          <Pick className="w-28" value={String(value.day)} onChange={(day) => onChange({ ...value, day: Number(day) })} options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} />
        )}
        {(value.type === 'daily' || value.type === 'weekdays' || value.type === 'weekly') && (
          <TimePicker value={value.time} onChange={(time) => onChange({ ...value, time })} />
        )}
        {value.type === 'once' && (
          <DateTimePicker value={value.at} onChange={(at) => onChange({ ...value, at })} />
        )}
        {value.type === 'cron' && (
          <Input className="w-64 font-mono" value={value.expr} onChange={(e) => onChange({ ...value, expr: e.target.value })} spellCheck={false} placeholder="0 9 * * 1-5" />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {value.type === 'cron' ? '五个字段：分 时 日 月 星期（0 是周日），按本机时间，间隔不能小于 1 小时。'
          : value.type === 'hourly' ? '整点运行。'
          : '按本机时间。电脑休眠或应用没开时会错过，下次打开时补跑一次。'}
      </p>
    </div>
  );
}

function TaskForm({ initial, kind, onDone }: { initial: TaskDraft; kind: SessionKind; onDone: () => void }) {
  const projects = useApp((s) => s.projects);
  const folders = useApp((s) => s.workFolders);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<TaskDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const work = kind === 'work';
  const places = work ? folders : projects;
  // A saved folder may have been removed from the picker since.
  const options = draft.projectPath && !places.some((p) => p.path === draft.projectPath) ? [{ path: draft.projectPath, name: fname(draft.projectPath) }, ...places] : places;

  const save = async () => {
    const s = draft.schedule;
    if ((s.type === 'daily' || s.type === 'weekdays' || s.type === 'weekly') && !parseTime(s.time)) return void toast.error('请填写时间');
    setBusy(true);
    try {
      await call('tasks:save', draft);
      toast.success('已保存');
      onDone();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <BackButton onClick={onDone}>返回任务列表</BackButton>
      <Heading title={initial.id ? '编辑定时任务' : '新建定时任务'} sub="到点后会新开一个会话，把下面的指令交给 Pi Desktop 去做。" />
      <div className="space-y-4 rounded-xl border bg-card p-4">
        <Field label="名称" hint="用作会话标题，同一个分区里不能重名。">
          <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="每日代码审查" />
        </Field>
        <Field label="指令" hint="每次运行都没有上下文，所以要写得完整：做什么、怎样算完成。">
          <Textarea value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} rows={6} placeholder="查看昨天合并的 PR，指出可能的回归风险，并总结成一份简报。" />
        </Field>
        <Field label={work ? '文件夹' : '项目'} hint={work ? '不选就每次用一个全新的临时工作区。' : undefined}>
          <Pick
            value={draft.projectPath ?? (work ? NONE : '')}
            onChange={(path) => set({ projectPath: path === NONE ? null : path })}
            placeholder="选择项目…"
            options={[
              ...(work ? [{ value: NONE, label: '临时工作区' }] : []),
              ...options.map((p) => ({ value: p.path, label: <>{p.name || fname(p.path)}<span className="ml-2 truncate text-xs text-muted-foreground">{p.path}</span></> })),
            ]}
          />
        </Field>
        {!work && (
          <Label className="items-start gap-3 font-normal leading-normal">
            <Switch checked={draft.worktree} onCheckedChange={(worktree) => set({ worktree })} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">每次在独立的 worktree 里运行</span>
              <span className="block text-xs text-muted-foreground">关闭时直接在项目目录里改，包括未提交的改动。</span>
            </span>
          </Label>
        )}
        <Field label="权限模式" hint={draft.mode === 'default' ? '需要批准时，这次运行会停在那里等你去会话里确认。' : MODES.find((m) => m.id === draft.mode)?.desc}>
          <Pick value={draft.mode} onChange={(mode) => set({ mode: mode as PermissionMode })} options={MODES.map((m) => ({ value: m.id, label: m.name }))} />
        </Field>
        <Field label="运行时间">
          <ScheduleFields value={draft.schedule} onChange={(schedule) => set({ schedule })} />
        </Field>
        <div className="flex gap-2 pt-1">
          <Button onClick={() => void save()} disabled={busy}>保存</Button>
          <Button variant="ghost" onClick={onDone}>取消</Button>
        </div>
      </div>
    </>
  );
}

const nextLabel = (t: ScheduledTask) =>
  !t.enabled ? (t.schedule.type === 'once' && t.lastRunAt ? '已完成' : '已暂停')
    : t.nextRunAt ? `下次 ${new Date(t.nextRunAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '手动运行';

function TaskDetail({ task, onBack, onEdit }: { task: ScheduledTask; onBack: () => void; onEdit: () => void }) {
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
    if (!(await dialogs.confirm(`删除“${task.name}”？`, '已经运行产生的会话会保留，只是不再按计划运行。', '删除', true))) return;
    try {
      await call('tasks:remove', task.id);
      onBack();
    } catch (err) {
      toast.error(errText(err));
    }
  };
  const toggle = (on: boolean) => void call('tasks:setEnabled', task.id, on).catch((e) => toast.error(errText(e)));
  const place = task.projectPath ? fname(task.projectPath) : '临时工作区';
  return (
    <>
      <BackButton onClick={onBack}>返回任务列表</BackButton>
      <Heading
        title={task.name}
        sub={`${describeSchedule(task.schedule)} · ${nextLabel(task)}`}
        action={
          <div className="flex shrink-0 items-center gap-2">
            <Switch checked={task.enabled} onCheckedChange={toggle} aria-label={task.enabled ? '暂停' : '启用'} />
            <Button size="sm" variant="outline" onClick={() => void run()} disabled={running}><PlayIcon className="size-3.5" />立即运行</Button>
            <Button size="sm" variant="outline" onClick={onEdit}><PencilIcon className="size-3.5" />编辑</Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => void remove()}><Trash2Icon className="size-3.5" />删除</Button>
          </div>
        }
      />
      <div className="mb-4 space-y-2 rounded-xl border bg-card px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{place}</Badge>
          <Badge variant="secondary">{MODES.find((m) => m.id === task.mode)?.name ?? task.mode}</Badge>
          {task.worktree && <Badge variant="secondary">worktree</Badge>}
        </div>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{task.prompt}</p>
      </div>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">运行记录{task.runs.length ? ` · ${task.runs.length}` : ''}</h3>
      <Panel>
        {task.runs.map((r) => (
          <div key={`${r.at}-${r.sessionId ?? 'skipped'}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="w-16 shrink-0 text-xs text-muted-foreground" title={new Date(r.at).toLocaleString()}>{ago(r.at)}</span>
            {r.status === 'started' && r.sessionId ? (
              <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => void openSession(r.sessionId!)}>
                打开会话{r.note && <span className="ml-2 text-xs text-muted-foreground">{r.note}</span>}
              </button>
            ) : (
              <span className="min-w-0 flex-1 truncate text-muted-foreground">已跳过{r.note ? ` · ${r.note}` : ''}</span>
            )}
          </div>
        ))}
        {!task.runs.length && <Empty>还没有运行过。到点或点「立即运行」之后，每次运行都会在这里留一条记录。</Empty>}
      </Panel>
    </>
  );
}

const blank = (kind: SessionKind, projectPath: string | null): TaskDraft => ({
  name: '', prompt: '', kind, projectPath, worktree: false, mode: 'auto', model: null, schedule: { type: 'daily', time: '09:00' },
});
const editing = (t: ScheduledTask): TaskDraft => ({
  id: t.id, name: t.name, prompt: t.prompt, kind: t.kind, projectPath: t.projectPath, worktree: t.worktree, mode: t.mode, model: t.model, schedule: t.schedule,
});

export function ScheduledPage() {
  const view = useApp((s) => s.view);
  const all = useApp((s) => s.tasks);
  const project = useApp((s) => s.prefs.project);
  const folder = useApp((s) => s.prefs.workFolder);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<TaskDraft | null>(null);
  const tasks = all.filter((t) => t.kind === view);
  const current = open ? tasks.find((t) => t.id === open) : undefined;

  let body: ReactNode;
  if (form) {
    body = <TaskForm initial={form} kind={view} onDone={() => setForm(null)} />;
  } else if (current) {
    body = <TaskDetail task={current} onBack={() => setOpen(null)} onEdit={() => setForm(editing(current))} />;
  } else {
    body = (
      <>
        <Heading
          title="Scheduled"
          sub={`按计划自动运行的${view === 'work' ? ' Work ' : ' Code '}任务：到点新开一个会话。任务在本机运行，只有应用开着、电脑没休眠时才会触发。`}
          action={<Button size="sm" className="shrink-0" onClick={() => setForm(blank(view, view === 'work' ? folder ?? null : project))}><PlusIcon className="size-4" />新建任务</Button>}
        />
        <Panel>
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3">
              <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => setOpen(t.id)}>
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40"><ClockIcon className="size-4 text-muted-foreground" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{describeSchedule(t.schedule)} · {nextLabel(t)}{t.projectPath ? ` · ${fname(t.projectPath)}` : ''}</span>
                </span>
              </button>
              <Switch checked={t.enabled} onCheckedChange={(on) => void call('tasks:setEnabled', t.id, on).catch((e) => toast.error(errText(e)))} aria-label={t.enabled ? '暂停' : '启用'} />
            </div>
          ))}
          {!tasks.length && <Empty>还没有定时任务。点「新建任务」，例如“每个工作日早上 9 点总结昨天合并的 PR”。</Empty>}
        </Panel>
      </>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto">
      <button className="absolute right-4 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="关闭" onClick={() => showWelcome()}>
        <XIcon className="size-4" />
      </button>
      <div key={form ? `form:${form.id ?? 'new'}` : (current?.id ?? 'list')} className="mx-auto max-w-3xl animate-in px-8 py-8 duration-200 fade-in-0 slide-in-from-bottom-1">{body}</div>
    </div>
  );
}
