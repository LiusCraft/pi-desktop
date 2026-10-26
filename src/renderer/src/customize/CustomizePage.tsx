// The Customize page: Skills, Connectors and Plugins, mapped onto pi's skills,
// MCP servers and packages, plus the subagent identities Pi Desktop adds. It replaces the
// conversation area while open; project-level entries follow the project picked in the sidebar.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BotIcon, PackageIcon, PlugZapIcon, ScrollTextIcon, SparklesIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomizeCatalog } from '@shared/protocol';
import { call, errText } from '@/lib/api';
import { fname } from '@/lib/format';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { showWelcome } from '@/store/actions';
import { useApp } from '@/store/app';
import { AgentsSection } from './AgentsSection';
import { ConnectorsSection } from './ConnectorsSection';
import { PluginsSection } from './PluginsSection';
import { SkillsSection } from './SkillsSection';
import { Empty, Heading, Panel } from './ui';

type Tab = 'skills' | 'connectors' | 'plugins' | 'prompts' | 'agents';

/** Prompt templates are plain Markdown files, so they only need a list here. */
function PromptsSection({ catalog }: { catalog: CustomizeCatalog }) {
  return (
    <>
      <Heading title="Commands" sub="提示模板：在输入框里打 /名称 就能展开成一段预设的提示。把 .md 文件放进 prompts 文件夹即可添加。" />
      <Panel>
        {catalog.prompts.map((p) => (
          <div key={p.file} className="flex items-start gap-3 px-4 py-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40"><ScrollTextIcon className="size-4 text-muted-foreground" /></span>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-sm font-medium">/{p.name}</div>
              <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.description || '（没有描述）'}</div>
            </div>
            <span className="text-xs text-muted-foreground">{p.scope === 'package' ? '插件' : p.scope === 'project' ? '项目' : '个人'}</span>
          </div>
        ))}
        {!catalog.prompts.length && <Empty>还没有提示模板。在 {catalog.dirs.prompts} 里放一个 Markdown 文件就会出现在这里。</Empty>}
      </Panel>
    </>
  );
}

export function CustomizePage() {
  const view = useApp((s) => s.view);
  // Work folders are usually plain document folders, so project-level entries (a `.pi` folder) belong to Code only.
  const project = useApp((s) => (s.view === 'work' ? null : s.prefs.project));
  const [tab, setTab] = useState<Tab>('skills');
  const [catalog, setCatalog] = useState<CustomizeCatalog | null>(null);

  const load = useCallback(() => {
    void call('customize:list', project).then(setCatalog).catch((e) => toast.error(errText(e)));
  }, [project]);
  useEffect(load, [load, view]);

  const tabs: { id: Tab; label: string; icon: ReactNode; count?: number }[] = [
    { id: 'skills', label: 'Skills', icon: <SparklesIcon className="size-4" />, count: catalog?.skills.length },
    { id: 'connectors', label: 'Connectors', icon: <PlugZapIcon className="size-4" />, count: catalog?.connectors.length },
    { id: 'plugins', label: 'Plugins', icon: <PackageIcon className="size-4" />, count: catalog?.plugins.length },
    { id: 'prompts', label: 'Commands', icon: <ScrollTextIcon className="size-4" />, count: catalog?.prompts.length },
    { id: 'agents', label: 'Subagents', icon: <BotIcon className="size-4" /> },
  ];
  const props = catalog && { catalog, project, onCatalog: setCatalog };

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} orientation="vertical" className="min-h-0 flex-1 flex-row gap-0">
      <nav className="w-52 shrink-0 space-y-0.5 border-r px-2 py-3">
        <div className="flex h-8 items-center px-2.5 text-sm font-semibold">Customize</div>
        <TabsList className="h-auto w-full flex-col items-stretch gap-0.5 bg-transparent p-0">
          {tabs.map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              className="h-8 flex-none justify-start gap-2.5 rounded-lg px-2.5 shadow-none hover:bg-accent/60 data-[state=active]:bg-accent data-[state=active]:shadow-none"
            >
              {t.icon}
              <span className="flex-1 text-left">{t.label}</span>
              {!!t.count && <span className="text-xs tabular-nums">{t.count}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="px-2.5 pt-4 text-xs text-muted-foreground">
          {project ? <>项目：<span className="font-medium text-foreground" title={project}>{fname(project)}</span></> : view === 'work' ? 'Work 只使用个人配置' : '没有选择项目，只显示个人配置'}
        </div>
      </nav>
      <div className="relative min-w-0 flex-1 overflow-y-auto">
        <button className="absolute right-4 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="关闭" onClick={() => showWelcome()}>
          <XIcon className="size-4" />
        </button>
        <div key={tab} className="mx-auto max-w-3xl animate-in px-8 py-8 duration-200 fade-in-0 slide-in-from-bottom-1">
          {tab === 'agents' ? (
            <AgentsSection />
          ) : !props ? (
            <div className="text-sm text-muted-foreground">加载中…</div>
          ) : tab === 'skills' ? (
            <SkillsSection {...props} />
          ) : tab === 'connectors' ? (
            <ConnectorsSection {...props} />
          ) : tab === 'plugins' ? (
            <PluginsSection {...props} />
          ) : (
            <PromptsSection catalog={catalog} />
          )}
        </div>
      </div>
    </Tabs>
  );
}
