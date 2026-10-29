// Settings → General → Idle context: when a long-idle session continues on a fresh context, and
// which models get their own threshold instead of the global one.
import { useEffect, useState } from 'react';
import { XIcon } from 'lucide-react';
import type { Settings } from '@shared/protocol';
import { IDLE_RESET_DEFAULT_MINUTES, IDLE_RESET_MAX_MINUTES } from '@shared/idle-reset';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import { ModelPicker } from './ModelPicker';
import { Group, Panel, Row } from './ui';

/**
 * Whole minutes, 0 allowed: `value` is what the setting holds (null = no value of its own), and the
 * field only commits a number it can stand behind — anything else falls back to what is stored.
 */
function MinutesInput({ value, fallback, label, onCommit }: {
  value: number | null;
  fallback: number;
  label: string;
  onCommit: (value: number | null) => void;
}) {
  const shown = String(value ?? '');
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    if (!text.trim()) return onCommit(null);
    const next = Math.round(Number(text));
    if (!Number.isFinite(next) || next < 0) return setText(shown);
    onCommit(Math.min(IDLE_RESET_MAX_MINUTES, next));
    return undefined;
  };
  return (
    <Input
      type="number"
      min={0}
      max={IDLE_RESET_MAX_MINUTES}
      value={text}
      placeholder={String(fallback)}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      className="h-8 w-20 text-center"
    />
  );
}

export function ContextSection({ settings, patch }: { settings: Partial<Settings>; patch: (value: Partial<Settings>) => void }) {
  const t = useT();
  const global = settings.idleResetMinutes ?? IDLE_RESET_DEFAULT_MINUTES;
  const configured = settings.idleResetModels ?? {};
  const overrides = Object.entries(configured).sort(([a], [b]) => a.localeCompare(b));
  const setModel = (key: string, minutes: number | null) => {
    const next = { ...configured };
    if (minutes === null) delete next[key];
    else next[key] = minutes;
    patch({ idleResetModels: next });
  };

  return (
    <Group id="idleContext" title={t('settings.idleReset')} sub={t('settings.idleReset.sub')} tip={t('settings.idleReset.tip')}>
      <Panel>
        <Row title={t('settings.idleReset.global')} hint={t('settings.idleReset.global.hint')}>
          <div className="flex shrink-0 items-center gap-2">
            <MinutesInput
              value={settings.idleResetMinutes ?? null}
              fallback={IDLE_RESET_DEFAULT_MINUTES}
              label={t('settings.idleReset.global')}
              onCommit={(minutes) => patch({ idleResetMinutes: minutes ?? 0 })}
            />
            <span className="text-sm text-muted-foreground">{t('settings.minutesUnit')}</span>
          </div>
        </Row>
        {overrides.map(([key, minutes]) => (
          <Row key={key} title={key} hint={t('settings.idleReset.model.hint')}>
            <div className="flex shrink-0 items-center gap-2">
              <MinutesInput
                value={minutes}
                fallback={global}
                label={key}
                onCommit={(next) => setModel(key, next)}
              />
              <span className="text-sm text-muted-foreground">{t('settings.minutesUnit')}</span>
              <Button variant="ghost" size="icon" aria-label={t('settings.idleReset.models')} onClick={() => setModel(key, null)}>
                <XIcon className="size-4" />
              </Button>
            </div>
          </Row>
        ))}
        <Row title={t('settings.idleReset.add')}>
          <ModelPicker
            // A picker used as an action: the value stays empty, so it keeps showing the placeholder.
            key={overrides.length}
            value={null}
            className="w-64 shrink-0"
            emptyLabel={t('settings.idleReset.pick')}
            label={t('settings.idleReset.pickerLabel')}
            onChange={(id) => { if (id && !(id in configured)) setModel(id, global); }}
          />
        </Row>
      </Panel>
    </Group>
  );
}
