// The latest artifacts on the Work welcome screen; renders nothing while there are none.
import { useEffect, useState } from 'react';
import type { ArtifactMeta } from '@shared/artifacts';
import { call } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { ago } from '@/lib/format';
import { showArtifacts } from '@/store/actions';
import { subscribeResource } from '@/store/resources';
import { Thumbnail } from './ArtifactsPage';

const RECENT_COUNT = 3;

export function RecentArtifacts() {
  const t = useT();
  const [list, setList] = useState<ArtifactMeta[]>([]);
  useEffect(() => {
    const load = () =>
      void call('artifacts:list')
        .then(setList)
        .catch(() => setList([]));
    load();
    window.addEventListener('focus', load);
    const offSaved = subscribeResource('artifacts', load);
    return () => {
      window.removeEventListener('focus', load);
      offSaved();
    };
  }, []);
  const recent = [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_COUNT);
  if (!recent.length) return null;
  return (
    <div className="mt-8">
      <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
        <span>{t('artifacts.recent')}</span>
        <button className="text-xs hover:text-foreground" onClick={showArtifacts}>
          {t('artifacts.viewAll')}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {recent.map((a) => (
          <div key={a.id} className="overflow-hidden rounded-xl border bg-card">
            <Thumbnail a={a} />
            <div className="px-3 py-2">
              <div className="truncate text-sm font-medium" title={a.title}>
                {a.title}
              </div>
              <div className="text-xs text-muted-foreground">{ago(a.updatedAt, true)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
