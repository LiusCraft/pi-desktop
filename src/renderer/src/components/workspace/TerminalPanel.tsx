// The terminal card: a tab per shell, each a real pseudo-terminal drawn by xterm.js.
import { useCallback, useEffect, useRef, useState } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { TerminalInfo } from '@shared/protocol';
import { bridge, call } from '@/lib/api';
import { t as tr, useT } from '@/lib/i18n';
import { fontStack, resolvedTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { fail, togglePanel } from '@/store/actions';
import { getApp } from '@/store/app';
import type { SessionView } from '@/store/types';
import { Card, IconBtn, type CardProps } from './Panels';

const VSCODE_THEMES: Record<'light' | 'dark', ITheme> = {
  light: { background: '#ffffff', foreground: '#3b3b3b', cursor: '#3b3b3b', selectionBackground: '#add6ff' },
  dark: { background: '#1e1e1e', foreground: '#cccccc', cursor: '#aeafad', selectionBackground: '#264f78' },
};
const THEMES: Record<'light' | 'dark', ITheme> = {
  light: { background: '#f5f4ef', foreground: '#29261b', cursor: '#29261b', selectionBackground: '#d9d6c9' },
  dark: { background: '#1f1e1d', foreground: '#e5e3dc', cursor: '#e5e3dc', selectionBackground: '#4a4842' },
};
const termTheme = (palette = document.documentElement.dataset.palette, mode: 'light' | 'dark' = resolvedTheme()) =>
  (palette === 'vscode' ? VSCODE_THEMES : THEMES)[mode];
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const exitNotice = () => `\r\n\x1b[2m${tr('terminal.exited')}\x1b[0m\r\n`;

function TermView({ id, active }: { id: string; active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const fit = useRef<() => void>(() => {});

  useEffect(() => {
    const term = new Terminal({
      fontFamily: fontStack(getApp().settings.codeFont, FONT),
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      theme: termTheme(),
    });
    const fitter = new FitAddon();
    term.loadAddon(fitter);
    term.open(host.current!);

    const refit = () => {
      // A hidden tab measures as zero size; it refits when shown.
      if (!host.current?.offsetWidth) return;
      fitter.fit();
      void call('terminal:resize', id, term.cols, term.rows).catch(() => {});
    };
    fit.current = refit;

    // Subscribe before attaching so nothing printed meanwhile is lost; it queues until the backlog is drawn.
    let queue: string[] | null = [];
    const offData = bridge.on('terminal:data', (e) => {
      if (e.id !== id) return;
      if (queue) queue.push(e.data);
      else term.write(e.data);
    });
    const offExit = bridge.on('terminal:exit', (e) => e.id === id && term.write(exitNotice()));
    const offTheme = bridge.on('settings:changed', (s) => {
      term.options.theme = termTheme(s.palette, s.resolvedTheme);
      const family = fontStack(s.codeFont, FONT);
      if (term.options.fontFamily !== family) {
        term.options.fontFamily = family;
        refit();
      }
    });
    term.onData((data) => void call('terminal:write', id, data).catch(() => {}));

    let disposed = false;
    call('terminal:attach', id)
      .then((r) => {
        if (disposed) return;
        term.write(r.backlog);
        for (const chunk of queue ?? []) term.write(chunk);
        queue = null;
        if (r.exited) term.write(exitNotice());
        refit();
      })
      .catch(fail);

    const ro = new ResizeObserver(refit);
    ro.observe(host.current!);
    return () => {
      disposed = true;
      ro.disconnect();
      offData();
      offExit();
      offTheme();
      term.dispose();
    };
  }, [id]);

  useEffect(() => {
    if (active) requestAnimationFrame(() => fit.current());
  }, [active]);

  return <div ref={host} className={cn('absolute inset-0 px-2 py-1', !active && 'hidden')} />;
}

export function TerminalPanel({ s, ...card }: CardProps & { s: SessionView }) {
  const tx = useT();
  const sessionId = s.meta.id;
  const [tabs, setTabs] = useState<TerminalInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);

  const add = useCallback(async () => {
    try {
      const t = await call('terminal:create', sessionId);
      setTabs((list) => [...list, t]);
      setActive(t.id);
    } catch (err) {
      fail(err);
    }
  }, [sessionId]);

  // Tabs outlive the panel: reopen to the shells still running, or start the first one.
  useEffect(() => {
    let cancelled = false;
    setTabs([]);
    setActive(null);
    call('terminal:list', sessionId)
      .then((list) => {
        if (cancelled) return;
        if (!list.length) return void add();
        setTabs(list);
        setActive(list[0].id);
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [sessionId, add]);

  const close = (id: string) => {
    void call('terminal:close', id).catch(() => {});
    const rest = tabs.filter((t) => t.id !== id);
    if (!rest.length) return togglePanel(sessionId, 'terminal', false);
    setTabs(rest);
    if (active === id) setActive(rest[Math.max(0, tabs.findIndex((t) => t.id === id) - 1)].id);
  };

  return (
    <Card
      {...card}
      title={
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={cn(
                'group flex h-7 shrink-0 items-center gap-1 rounded-md pr-1 pl-2 text-xs',
                t.id === active ? 'bg-accent text-foreground' : 'font-normal text-muted-foreground hover:bg-accent/50',
              )}
            >
              <button type="button" onClick={() => setActive(t.id)} className="max-w-32 truncate">
                {t.title}
              </button>
              <button
                type="button"
                aria-label={tx('terminal.close')}
                onClick={() => close(t.id)}
                className="flex size-4 items-center justify-center rounded hover:bg-muted"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
          <IconBtn title={tx('terminal.new')} onClick={() => void add()}>
            <PlusIcon className="size-3.5" />
          </IconBtn>
        </div>
      }
      onClose={() => togglePanel(sessionId, 'terminal', false)}
      bodyClass="relative overflow-hidden bg-code"
    >
      {tabs.map((t) => (
        <TermView key={t.id} id={t.id} active={t.id === active} />
      ))}
    </Card>
  );
}
