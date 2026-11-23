import { useState, type KeyboardEvent } from 'react';
import { RotateCcwIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUTS,
  resetShortcut,
  shortcutConflict,
  shortcutFor,
  validShortcut,
  type ShortcutAction,
  type ShortcutOverrides,
} from '@shared/shortcuts';
import { Button } from '@/components/ui/button';
import { isMac } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { shortcutFromEvent, shortcutLabel } from '@/lib/shortcut-keys';
import { Group, Heading, Panel, Row } from './ui';

export function ShortcutsSection({
  overrides = {},
  onSave,
}: {
  overrides?: ShortcutOverrides;
  onSave: (overrides: ShortcutOverrides) => Promise<void>;
}) {
  const t = useT();
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const cancel = () => {
    setRecording(null);
    setError('');
  };
  const save = async (next: ShortcutOverrides) => {
    cancel();
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  };
  const record = (event: KeyboardEvent<HTMLButtonElement>, action: ShortcutAction) => {
    if (recording !== action || event.key === 'Tab' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') return cancel();
    if (event.repeat || ['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return;
    const binding = shortcutFromEvent(event.nativeEvent, isMac);
    if (!validShortcut(action, binding)) return setError(t('shortcuts.invalid'));
    const conflict = shortcutConflict(overrides, action, binding, isMac);
    if (conflict) return setError(t('shortcuts.conflict', { action: t(`shortcuts.${conflict}`) }));
    return void save({ ...overrides, [action]: binding });
  };
  const restore = (action: ShortcutAction) => {
    const displaced = shortcutConflict(overrides, action, DEFAULT_SHORTCUTS[action], isMac);
    if (displaced) toast.info(t('shortcuts.displaced', { action: t(`shortcuts.${displaced}`) }));
    void save(resetShortcut(overrides, action, isMac));
  };
  return (
    <>
      <Heading title={t('shortcuts.title')} sub={t('shortcuts.description')} />
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          disabled={saving || !Object.keys(overrides).length}
          onClick={() => void save({})}
        >
          <RotateCcwIcon /> {t('shortcuts.resetAll')}
        </Button>
      </div>
      {(['navigation', 'conversation', 'creation'] as const).map((group) => (
        <Group key={group} title={t(`shortcuts.${group}`)}>
          <Panel>
            <div className="divide-y divide-border">
              {(Object.keys(SHORTCUTS[group]) as ShortcutAction[]).map((action) => {
                const label = t(`shortcuts.${action}`);
                const current = shortcutFor(overrides, action);
                const active = recording === action;
                return (
                  <Row
                    key={action}
                    title={label}
                    hint={
                      active && error ? (
                        <span role="alert" className="text-destructive">
                          {error}
                        </span>
                      ) : undefined
                    }
                  >
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-w-24 font-mono"
                        disabled={saving}
                        aria-label={`${label}: ${active ? t('shortcuts.press') : current ? shortcutLabel(current) : t('shortcuts.unassigned')}`}
                        aria-pressed={active}
                        aria-invalid={active && !!error}
                        onClick={() => {
                          setRecording(action);
                          setError('');
                        }}
                        onKeyDown={(event) => record(event, action)}
                        onBlur={cancel}
                      >
                        {active ? t('shortcuts.press') : current ? shortcutLabel(current) : t('shortcuts.unassigned')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={saving || !current}
                        title={t('shortcuts.clear')}
                        aria-label={`${t('shortcuts.clear')}: ${label}`}
                        onClick={() => void save({ ...overrides, [action]: null })}
                      >
                        <XIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={saving || overrides[action] === undefined}
                        title={t('shortcuts.reset')}
                        aria-label={`${t('shortcuts.reset')}: ${label}`}
                        onClick={() => restore(action)}
                      >
                        <RotateCcwIcon />
                      </Button>
                    </div>
                  </Row>
                );
              })}
            </div>
          </Panel>
        </Group>
      ))}
    </>
  );
}
