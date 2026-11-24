import { useState } from 'react';
import { ZapIcon } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { rememberFast, useApp } from '@/store/app';
import { setSessionFast } from '@/store/actions';
import { useDrafts } from '@/store/drafts';
import type { SessionMeta } from '@shared/protocol';
import { FootButton } from './Menus';

export function FastButton({ model, session }: { model: string | null; session?: SessionMeta }) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const supported = useApp((st) => st.models.some((m) => m.supportsFast && `${m.provider}/${m.id}` === model));
  const remembered = useApp((st) => model !== null && st.prefs.fastModels.includes(model));
  const sending = useDrafts((st) => Boolean(st.active && st.drafts[st.active]?.sending));
  if (!model || !supported) return null;
  const enabled = session ? session.fastModel === model : remembered;
  return (
    <FootButton
      type="button"
      title={t('composer.fastTip')}
      aria-label={t('composer.fast')}
      aria-pressed={enabled}
      disabled={saving || (!session && sending)}
      className="group shrink-0 focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-accent aria-pressed:text-foreground motion-safe:transition-colors"
      onClick={async () => {
        if (!session) {
          rememberFast(model, !enabled);
          return;
        }
        setSaving(true);
        try {
          await setSessionFast(session.id, model, !enabled);
        } finally {
          setSaving(false);
        }
      }}
    >
      <ZapIcon
        aria-hidden
        strokeWidth={1.5}
        className="size-3.5 shrink-0 fill-current motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.2,0.9,0.3,1.6)] motion-safe:group-aria-pressed:-translate-y-px motion-safe:group-aria-pressed:scale-110"
      />
      <span className="max-[420px]:sr-only">{t('composer.fast')}</span>
    </FootButton>
  );
}
