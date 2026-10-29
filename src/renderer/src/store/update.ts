// The "new version" prompt: main reports a newer release, the user updates now or ignores that version.
import { toast } from 'sonner';
import type { ReleaseNote } from '@shared/update';
import { bridge, call, errText } from '@/lib/api';
import { t } from '@/lib/i18n';

const PERCENT = 100;

async function install(id: string | number) {
  toast.loading(t('update.downloading', { percent: 0 }), { id });
  const off = bridge.on('update:progress', (p) => {
    const percent = p.total ? Math.floor((p.received / p.total) * PERCENT) : 0;
    toast.loading(p.stage === 'launching' ? t('update.launching') : t('update.downloading', { percent }), { id });
  });
  try {
    await call('update:install');
    toast.dismiss(id);
  } catch (err) {
    toast.error(errText(err), { id });
  } finally {
    off();
  }
}

function offer(release: ReleaseNote) {
  const id = `update-${release.version}`;
  toast(t('update.found', { version: release.version }), {
    id,
    duration: Infinity,
    // Without an installer for this system the release page is the way to get it.
    action: release.asset
      ? { label: t('update.install'), onClick: () => void install(id) }
      : { label: t('update.viewOnGithub'), onClick: () => void call('app:openExternal', release.url) },
    cancel: {
      label: t('update.ignore'),
      onClick: () => void call('settings:set', { ignoredUpdate: release.version }).catch(() => {}),
    },
  });
}

/** Follow the automatic update check; returns the unsubscribe. */
export const watchUpdates = () => bridge.on('update:found', offer);
