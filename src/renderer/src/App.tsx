import { useEffect } from 'react';
import { useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import { PERMISSION_CHOICES } from '@shared/protocol';
import { CommandPalette } from '@/components/dialogs/CommandPalette';
import { DialogHost } from '@/components/dialogs/DialogHost';
import { Main } from '@/components/layout/Main';
import { Sidebar } from '@/components/layout/Sidebar';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { bridge, call, isMac } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { answerUi, bootstrap, cycleViewMode, fail, handleHostEvent, openSession, showWelcome, stop, toggleSidebar, togglePanel } from '@/store/actions';
import { currentSession, getApp, setApp, useApp } from '@/store/app';
import { activeDraft, drafts } from '@/store/drafts';
import { useDialogs } from '@/store/dialogs';
import { watchSideWindows } from '@/store/side';

function useShortcuts() {
  useEffect(() => {
    // Sidebar first, in the capture phase, so text fields never swallow it.
    const sidebar = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!mod || e.altKey || e.shiftKey || e.isComposing || !['b', '.'].includes(e.key.toLowerCase())) return;
      e.preventDefault();
      if (!e.repeat) toggleSidebar();
    };
    const keys = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'k') {
        e.preventDefault();
        return setApp((s) => void (s.paletteOpen = !s.paletteOpen));
      }
      if (mod && e.key === ',') {
        e.preventDefault();
        return void call('settings:open');
      }
      if (getApp().paletteOpen || useDialogs.getState().current) return;
      if (mod && key === 'n') {
        e.preventDefault();
        return showWelcome();
      }
      const s = currentSession();
      if (!s) return;
      if (e.key === 'Escape' && s.running && !document.querySelector('[role=menu],[role=dialog]')) {
        e.preventDefault();
        return void stop(s.meta.id);
      }
      if (mod && key === 'o') {
        e.preventDefault();
        return cycleViewMode();
      }
      if (mod && key === 'd') {
        e.preventDefault();
        return togglePanel(s.meta.id, s.meta.kind === 'work' ? 'progress' : 'diff');
      }
      // 1 / 2 / 3 answer a waiting permission card while the composer is empty.
      const waiting = s.waiting ? s.items.find((i) => i.key === s.waiting) : undefined;
      if (waiting?.kind === 'perm' && ['1', '2', '3'].includes(e.key) && !mod && !activeDraft()?.text.trim() && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        const v = PERMISSION_CHOICES[Number(e.key) - 1];
        answerUi(s.meta.id, waiting.key, { value: v }, v);
      }
    };
    window.addEventListener('keydown', sidebar, true);
    window.addEventListener('keydown', keys);
    return () => {
      window.removeEventListener('keydown', sidebar, true);
      window.removeEventListener('keydown', keys);
    };
  }, []);
}

export function App() {
  useTheme();
  useShortcuts();
  const collapsed = useApp((s) => s.sidebarCollapsed);
  const sidebar = usePanelRef();
  const shell = useDefaultLayout({ id: 'shell' });

  useEffect(() => {
    const offHost = bridge.on('host:event', handleHostEvent);
    const offSettings = bridge.on('settings:changed', (settings) => {
      setApp((s) => void (s.settings = settings));
      // Turning the feature off takes effect immediately, not after the next turn.
      if (settings.suggestions === false) drafts.clearSuggestions();
    });
    const offFocus = bridge.on('session:focus', (id) => void openSession(id));
    const offSide = watchSideWindows();
    bootstrap().catch(fail);
    return () => {
      offSide();
      offFocus();
      offHost();
      offSettings();
    };
  }, []);

  // The sidebar's collapsed state lives in settings; the panel follows it.
  useEffect(() => {
    const p = sidebar.current;
    if (!p) return;
    if (collapsed && !p.isCollapsed()) p.collapse();
    if (!collapsed && p.isCollapsed()) p.expand();
  }, [collapsed, sidebar]);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="h-screen w-screen" data-platform={bridge.platform}>
        <ResizablePanelGroup orientation="horizontal" id="shell" defaultLayout={shell.defaultLayout} onLayoutChanged={shell.onLayoutChanged}>
          <ResizablePanel
            id="sidebar"
            panelRef={sidebar}
            defaultSize={300}
            minSize={240}
            maxSize={480}
            collapsible
            collapsedSize={0}
            onResize={(size) => {
              const isCollapsed = size.inPixels < 1;
              if (isCollapsed !== getApp().sidebarCollapsed) toggleSidebar(isCollapsed);
            }}
          >
            <Sidebar />
          </ResizablePanel>
          <ResizableHandle className="bg-sidebar-border" />
          <ResizablePanel id="main" minSize={420}>
            <Main />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <CommandPalette />
      <DialogHost />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
