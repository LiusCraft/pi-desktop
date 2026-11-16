// One page of a desktop plugin, in a sandboxed iframe served from `pidesk-plugin://<id>/`. The page
// never touches the app's bridge: it posts a call, and this file decides — from the permissions the
// user granted — whether to answer it, then hands it to main (which refuses anything but a ready
// plugin) or to the agent host (which runs the plugin's own code).
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { DesktopPluginInfo, JsonValue, PluginPage as PluginPageDef, PluginPermission } from '@shared/protocol';
import { Button } from '@/components/ui/button';
import { bridge, call, errText } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { currentSession, useCurrent } from '@/store/app';
import { subscribePluginEvent } from './events';

/** How long a page may take to load before it is called unresponsive. */
const LOAD_TIMEOUT_MS = 8000;

/** The app's colours as CSS values, so a page looks like part of the app without knowing the theme. */
const TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--border',
  '--primary',
  '--primary-foreground',
  '--muted',
  '--muted-foreground',
  '--radius',
];
function themeTokens(): Record<string, JsonValue> {
  const style = getComputedStyle(document.documentElement);
  const tokens: Record<string, JsonValue> = { dark: document.documentElement.classList.contains('dark') };
  for (const name of TOKENS) tokens[name] = style.getPropertyValue(name).trim();
  return tokens;
}

/** What a page may know about the session it is looking at. */
function sessionInfo(s: ReturnType<typeof currentSession>): Record<string, string> | null {
  return s ? { id: s.meta.id, kind: s.meta.kind, title: s.meta.title, cwd: s.meta.cwd } : null;
}

/** One call from the page, answered here or passed on. `#storage.*` names are the runtime's, not the plugin's. */
type Runner = (method: string, args: unknown[]) => Promise<JsonValue>;

export function PluginFrame({ plugin, page }: { plugin: DesktopPluginInfo; page: PluginPageDef }) {
  const t = useT();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const current = useCurrent();
  const [loaded, setLoaded] = useState(false);
  const [crashed, setCrashed] = useState(false);
  /** Bumped by "reload": the iframe is remounted from scratch. */
  const [attempt, setAttempt] = useState(0);

  const send = useCallback((event: JsonValue) => {
    frame.current?.contentWindow?.postMessage({ kind: 'event', event }, '*');
  }, []);

  /** Everything the page is allowed to see, re-sent whenever it changes. */
  const sync = useCallback(() => {
    const readable = plugin.permissions.includes('session:read');
    send({ type: 'session', payload: readable ? sessionInfo(currentSession()) : null });
    send({ type: 'theme', payload: themeTokens() });
  }, [plugin.permissions, send]);

  const run = useCallback<Runner>(
    async (method, args) => {
      const allow = (permission: PluginPermission) => {
        if (!plugin.permissions.includes(permission)) throw new Error(t('pluginPage.noPermission', { permission }));
      };
      switch (method) {
        case 'session.current':
          allow('session:read');
          return sessionInfo(currentSession());
        case 'session.prompt': {
          allow('session:prompt');
          const s = currentSession();
          if (!s) throw new Error(t('pluginPage.noSession'));
          await call(
            'sessions:prompt',
            s.meta.id,
            { text: String(args[0] ?? ''), attachments: [], clientId: crypto.randomUUID() },
            'followUp',
          );
          return null;
        }
        case 'notify':
          allow('notify');
          toast(String(args[0] ?? ''));
          return null;
        case 'storage.get':
          allow('storage');
          return call('plugin:call', plugin.id, '#storage.get', [String(args[0] ?? '')]);
        case 'storage.set':
          allow('storage');
          await call('plugin:call', plugin.id, '#storage.set', [String(args[0] ?? ''), args[1] ?? null]);
          return null;
        case 'host.call':
          allow('host:call');
          return call('plugin:call', plugin.id, String(args[0] ?? ''), Array.isArray(args[1]) ? args[1] : []);
        default:
          throw new Error(t('pluginPage.unknownMethod', { method }));
      }
    },
    [plugin.id, plugin.permissions, t],
  );

  // The page's calls. `event.source` is checked so another frame cannot answer for this one.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || event.source !== win) return;
      const data = event.data as { id?: unknown; kind?: unknown; method?: unknown; args?: unknown } | null;
      if (!data || data.kind !== 'call' || typeof data.id !== 'number') return;
      const id = data.id;
      void run(String(data.method), Array.isArray(data.args) ? data.args : [])
        .then((value) => win.postMessage({ id, ok: true, value }, '*'))
        .catch((err) => win.postMessage({ id, ok: false, error: errText(err) }, '*'));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [run]);

  // What the plugin itself sends out: its open page hears it.
  useEffect(
    () =>
      subscribePluginEvent(plugin.id, (event) => {
        if (event.kind === 'data') send({ type: 'data', name: event.name, payload: event.payload });
      }),
    [plugin.id, send],
  );

  // A new session or a new theme reaches the page without a reload.
  useEffect(() => {
    if (loaded) sync();
  }, [current?.meta.id, current?.meta.title, loaded, sync]);
  useEffect(() => bridge.on('settings:changed', sync), [sync]);

  // A page that never finishes loading is broken, not slow: say so and offer a retry.
  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => setCrashed(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loaded, attempt]);

  return (
    <div className="relative min-h-0 flex-1">
      <iframe
        key={attempt}
        ref={frame}
        src={`pidesk-plugin://${plugin.id}/${page.entry}`}
        title={page.title}
        className="size-full border-0 bg-background"
        sandbox="allow-scripts allow-same-origin"
        onLoad={() => {
          setLoaded(true);
          setCrashed(false);
          sync();
        }}
      />
      {crashed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
          {t('pluginPage.crashed')}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLoaded(false);
              setCrashed(false);
              setAttempt((n) => n + 1);
            }}
          >
            {t('pluginPage.reload')}
          </Button>
        </div>
      )}
    </div>
  );
}
