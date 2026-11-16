// Time and date-time pickers built from shadcn parts: two Selects for the clock, and a Calendar in a
// Popover for the day. Local time throughout, like the schedule maths.
import { CalendarIcon } from 'lucide-react';
import { zhCN } from 'react-day-picker/locale';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));

function Part({
  value,
  options,
  label,
  onChange,
}: {
  value: string;
  options: string[];
  label: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[4.5rem] tabular-nums" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-64">
        <SelectGroup>
          {options.map((o) => (
            <SelectItem key={o} value={o} className="tabular-nums">
              {o}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** `HH:MM`, 24-hour. */
export function TimePicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (time: string) => void;
  className?: string;
}) {
  const t = useT();
  const [h = '09', m = '00'] = value.split(':');
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Part
        value={pad(Number(h) || 0)}
        options={HOURS}
        label={t('time.hour')}
        onChange={(v) => onChange(`${v}:${pad(Number(m) || 0)}`)}
      />
      <span className="text-muted-foreground">:</span>
      <Part
        value={pad(Number(m) || 0)}
        options={MINUTES}
        label={t('time.minute')}
        onChange={(v) => onChange(`${pad(Number(h) || 0)}:${v}`)}
      />
    </div>
  );
}

/** A moment as epoch milliseconds: pick the day in a calendar, then the time. */
export function DateTimePicker({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (at: number) => void;
  className?: string;
}) {
  const d = new Date(value);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const setDay = (day: Date | undefined) => {
    if (!day) return;
    const next = new Date(day);
    next.setHours(d.getHours(), d.getMinutes(), 0, 0);
    onChange(next.getTime());
  };
  const setTime = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    const next = new Date(d);
    next.setHours(h, m, 0, 0);
    onChange(next.getTime());
  };
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-44 justify-start font-normal">
            <CalendarIcon className="size-4 text-muted-foreground" />
            {d.toLocaleDateString([], { year: 'numeric', month: 'numeric', day: 'numeric' })}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          <Calendar
            mode="single"
            locale={zhCN}
            selected={d}
            defaultMonth={d}
            onSelect={setDay}
            disabled={{ before: startOfToday }}
          />
        </PopoverContent>
      </Popover>
      <TimePicker value={time} onChange={setTime} />
    </div>
  );
}
