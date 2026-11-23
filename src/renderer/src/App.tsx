import { useEffect } from 'react';
import { useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import { CommandPalette } from '@/components/dialogs/CommandPalette';
import { SessionSwitcher } from '@/components/dialogs/SessionSwitcher';
import { DialogHost } from '@/components/dialogs/DialogHost';
import { NativeTooltip } from '@/components/common/NativeTooltip';
import { Main } from '@/components/layout/Main';
import { Sidebar } from '@/components/layout/Sidebar';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Toaster } from '@/components/ui/sonner';
import { TOOLTIP_DEFAULT_DELAY, TooltipProvider } from '@/components/ui/tooltip';
import { bridge } from '@/lib/api';
import { useShortcuts } from '@/lib/use-shortcuts';
import { useTheme } from '@/lib/theme';
import { bootstrap, fail, handleHostEvent, loadPlugins, openSession, toggleSidebar } from '@/store/actions';
import { getApp, setApp, useApp } from '@/store/app';
import { drafts } from '@/store/drafts';
import { watchSideWindows } from '@/store/side';
import { watchCodeSession } from '@/store/refresh';
import { watchUpdates } from '@/store/update';

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
    const offRefresh = watchCodeSession();
    const offUpdates = watchUpdates();
    bootstrap().catch(fail);
    return () => {
      offRefresh();
      offUpdates();
      offSide();
      offFocus();
      offHost();
      offSettings();
    };
  }, []);

  // A plugin page belongs to a package of the project in view: another project brings another set.
  const pluginProject = useApp((s) => (s.view === 'work' ? null : s.prefs.project));
  useEffect(() => {
    loadPlugins();
  }, [pluginProject]);

  // The sidebar's collapsed state lives in settings; the panel follows it.
  useEffect(() => {
    const p = sidebar.current;
    if (!p) return;
    if (collapsed && !p.isCollapsed()) p.collapse();
    if (!collapsed && p.isCollapsed()) p.expand();
  }, [collapsed, sidebar]);

  return (
    <TooltipProvider delayDuration={TOOLTIP_DEFAULT_DELAY}>
      <div className="h-screen w-screen" data-platform={bridge.platform}>
        <ResizablePanelGroup
          orientation="horizontal"
          id="shell"
          defaultLayout={shell.defaultLayout}
          onLayoutChanged={shell.onLayoutChanged}
        >
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
      <SessionSwitcher />
      <DialogHost />
      <NativeTooltip />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
