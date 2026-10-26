// A model dropdown for settings. It uses the themed Radix select: a native <select>
// pops up a white, unreadable list in the dark theme.
import { useEffect, useState } from 'react';
import type { ModelInfo } from '@shared/protocol';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { bridge, call } from '@/lib/api';
import { cn } from '@/lib/utils';

// Radix items cannot have an empty value.
const NONE = '__none__';

/** Models with working credentials, grouped by provider; `null` means "no choice". */
export function ModelPicker({ value, onChange, emptyLabel, label, className }: {
  value: string | null;
  onChange: (id: string | null) => void;
  emptyLabel: string;
  label: string;
  className?: string;
}) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffect(() => {
    const load = () => {
      void call('models:list').then((r) => setModels(r.models.filter((m) => m.provider !== 'demo'))).catch(() => {});
    };
    load();
    // A login or endpoint change in the models section refreshes this list too.
    return bridge.on('host:event', (ev) => { if (ev.type === 'models_changed') load(); });
  }, []);
  const known = !value || models.some((m) => `${m.provider}/${m.id}` === value);
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger aria-label={label} className={cn('h-9 w-full', className)}><SelectValue /></SelectTrigger>
      <SelectContent position="popper" side="bottom" align="start" sideOffset={4} avoidCollisions={false}>
        <SelectGroup>
          <SelectItem value={NONE}>{emptyLabel}</SelectItem>
          {!known && <SelectItem value={value!}>{value}（不可用）</SelectItem>}
        </SelectGroup>
        {[...new Set(models.map((m) => m.provider))].map((provider) => (
          <SelectGroup key={provider}>
            <SelectLabel>{provider}</SelectLabel>
            {models.filter((m) => m.provider === provider).map((m) => (
              <SelectItem key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{m.name || m.id}</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
