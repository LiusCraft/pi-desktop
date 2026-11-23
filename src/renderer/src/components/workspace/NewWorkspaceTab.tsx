import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { workspaceHttpUrl } from '@shared/workspace-web';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { call, errText, isRemote } from '@/lib/api';
import { relPath } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { openWorkspaceResource } from '@/store/actions';

const ABSOLUTE_PATH = /^(?:[a-z]:[/\\]|[/\\])/i;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

export function NewWorkspaceTab({
  sid,
  cwd,
  active,
  choices,
}: {
  sid: string;
  cwd: string;
  active: boolean;
  choices: ReactNode;
}) {
  const t = useT();
  const hint = useId();
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => () => void request.current++, []);
  useEffect(() => {
    if (active) input.current?.focus();
  }, [active]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = value.trim();
    if (!raw || busy) return;
    const url = workspaceHttpUrl(raw);
    if (url) {
      openWorkspaceResource(sid, { kind: 'web', url });
      return;
    }
    const absolute = ABSOLUTE_PATH.test(raw);
    if (raw.includes('\0') || (!absolute && SCHEME.test(raw))) {
      setError(t('panel.invalidWorkspaceTarget'));
      return;
    }
    const path = relPath(cwd, raw);
    const local = absolute && ABSOLUTE_PATH.test(path);
    if (local && isRemote) {
      setError(t('panel.invalidWorkspaceTarget'));
      return;
    }
    const id = ++request.current;
    setError('');
    setBusy(true);
    try {
      const content = local ? await call('workspace:localFile', raw) : await call('sessions:workspaceFile', sid, path);
      if (id !== request.current || !content) return;
      openWorkspaceResource(sid, { kind: 'file', detail: { type: 'file', path, line: 1, loading: false, ...content } });
    } catch (err) {
      if (id === request.current) setError(errText(err));
    } finally {
      if (id === request.current) setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto space-y-5 max-w-xl">
        <form className="space-y-2" aria-busy={busy} onSubmit={(event) => void submit(event)}>
          <div className="flex gap-2">
            <Input
              ref={input}
              aria-label={t('panel.workspaceTarget')}
              aria-describedby={hint}
              aria-invalid={!!error}
              placeholder={t('panel.workspaceTarget')}
              spellCheck={false}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError('');
              }}
            />
            <Button type="submit" disabled={!value.trim() || busy}>
              {t('panel.openWorkspaceTarget')}
            </Button>
          </div>
          <p id={hint} className="text-xs text-muted-foreground">
            {t('panel.workspaceTargetHint')}
          </p>
          {error && (
            <p role="alert" className="text-sm break-words text-destructive">
              {error}
            </p>
          )}
        </form>
        <section aria-label={t('panel.workspaceChoices')} className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">{t('panel.workspaceChoices')}</h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2">{choices}</div>
        </section>
      </div>
    </div>
  );
}
