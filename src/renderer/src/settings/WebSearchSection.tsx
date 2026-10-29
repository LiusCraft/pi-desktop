// Settings → General → Web search: the engines the model can search with, and the user's API key for each.
// "Auto" uses every engine that has a key (Exa needs none), in turn: it stays on the one that works and moves on
// to the next when that one fails (free quota used up), so the free tiers add up.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ENGINE_AUTO,
  ENGINE_INFO,
  KEYLESS_ENGINES,
  SEARCH_ENGINES,
  type EngineChoice,
  type SearchEngine,
  type WebSearchInfo,
} from '@shared/web-search';
import { Segmented } from '@/components/common/Segmented';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { call, errText } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Tip } from '@/components/common/Tip';
import { Panel } from './ui';

const fail = (err: unknown) => toast.error(errText(err));

function EngineRow({
  engine,
  info,
  onChange,
}: {
  engine: SearchEngine;
  info: WebSearchInfo;
  onChange: (info: WebSearchInfo) => void;
}) {
  const t = useT();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const saved = info.keys[engine];
  const meta = ENGINE_INFO[engine];
  const keyless = KEYLESS_ENGINES.includes(engine);

  const run = async (what: 'save' | 'test' | 'remove') => {
    setBusy(what);
    try {
      if (what === 'test') {
        await call('web:test', engine, key.trim() || undefined);
        toast.success(t('web.works', { engine: meta.label }));
      } else {
        const next = await call('web:save', {
          engine: info.engine,
          keys: { [engine]: what === 'remove' ? null : key },
        });
        setKey('');
        onChange(next);
        toast.success(t(what === 'remove' ? 'web.removed' : 'web.saved'));
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{meta.label}</span>
        {(saved || keyless) && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {info.current === engine && info.engine === ENGINE_AUTO
              ? t('web.configured.current')
              : saved
                ? t('web.configured')
                : t('web.keyless')}
          </span>
        )}
        <a
          className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
          href={meta.signup}
          target="_blank"
          rel="noreferrer"
        >
          {t('web.getKey')}
        </a>
      </div>
      <div className="text-xs text-muted-foreground">{t(meta.free)}</div>
      <div className="flex items-center gap-2">
        <Input
          className="h-8 flex-1 font-mono text-xs"
          type="password"
          value={key}
          placeholder={saved ? t('web.keyKeep') : t(keyless ? 'web.keyOptional' : 'web.keyPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || (!saved && !keyless && !key.trim())}
          onClick={() => void run('test')}
        >
          {busy === 'test' ? t('web.testing') : t('web.test')}
        </Button>
        <Button size="sm" disabled={busy !== null || !key.trim()} onClick={() => void run('save')}>
          {t('web.save')}
        </Button>
        {saved && (
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run('remove')}>
            {t('web.remove')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function WebSearchSection() {
  const t = useT();
  const [info, setInfo] = useState<WebSearchInfo | null>(null);
  useEffect(() => {
    void call('web:get').then(setInfo).catch(fail);
  }, []);
  if (!info) return null;

  const choose = async (engine: EngineChoice) => {
    try {
      setInfo(await call('web:save', { engine, keys: {} }));
    } catch (err) {
      fail(err);
    }
  };
  const choices: { id: EngineChoice; label: string }[] = [
    { id: ENGINE_AUTO, label: t('web.auto') },
    ...SEARCH_ENGINES.map((id) => ({ id, label: ENGINE_INFO[id].label })),
  ];

  return (
    <section className="mt-7">
      <h3 className="flex items-center gap-1.5 px-1 text-sm font-semibold">
        {t('web.title')}
        <Tip>{t('web.tip')}</Tip>
      </h3>
      <p className="mt-0.5 px-1 text-xs text-muted-foreground">{t('web.sub')}</p>
      <div className="mt-3 flex flex-col gap-2 px-1">
        <Segmented value={info.engine} options={choices} onChange={(id) => void choose(id)} className="self-start" />
        <p className="text-xs text-muted-foreground">
          {info.engine === ENGINE_AUTO
            ? t('web.hint.auto')
            : t('web.hint.fixed', { engine: ENGINE_INFO[info.engine].label })}
        </p>
      </div>
      <div className="mt-2">
        <Panel>
          {SEARCH_ENGINES.map((e) => (
            <EngineRow key={e} engine={e} info={info} onChange={setInfo} />
          ))}
        </Panel>
      </div>
    </section>
  );
}
