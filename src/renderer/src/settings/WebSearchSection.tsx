// Settings → 通用 → 联网搜索: the engines the model can search with, and the user's API key for each.
// "自动" uses every engine that has a key, in turn: it stays on the one that works and moves on
// to the next when that one fails (free quota used up), so the free tiers add up.
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ENGINE_AUTO, ENGINE_INFO, SEARCH_ENGINES, type EngineChoice, type SearchEngine, type WebSearchInfo } from '@shared/web-search';
import { Segmented } from '@/components/common/Segmented';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { call, errText } from '@/lib/api';

const Panel = ({ children }: { children: ReactNode }) => <div className="divide-y rounded-xl border bg-card">{children}</div>;

const fail = (err: unknown) => toast.error(errText(err));

const CHOICES = [
  { id: ENGINE_AUTO, label: '自动' },
  ...SEARCH_ENGINES.map((id) => ({ id, label: ENGINE_INFO[id].label })),
] satisfies { id: EngineChoice; label: string }[];

function EngineRow({ engine, info, onChange }: { engine: SearchEngine; info: WebSearchInfo; onChange: (info: WebSearchInfo) => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const saved = info.keys[engine];
  const meta = ENGINE_INFO[engine];

  const run = async (what: 'save' | 'test' | 'remove') => {
    setBusy(what);
    try {
      if (what === 'test') {
        await call('web:test', engine, key.trim() || undefined);
        toast.success(`${meta.label} 可用`);
      } else {
        const next = await call('web:save', { engine: info.engine, keys: { [engine]: what === 'remove' ? null : key } });
        setKey('');
        onChange(next);
        toast.success(what === 'remove' ? '已移除' : '已保存');
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
        {saved && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{info.current === engine && info.engine === ENGINE_AUTO ? '已配置 · 当前使用' : '已配置'}</span>}
        <a className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline" href={meta.signup} target="_blank" rel="noreferrer">获取密钥</a>
      </div>
      <div className="text-xs text-muted-foreground">{meta.free}</div>
      <div className="flex items-center gap-2">
        <Input
          className="h-8 flex-1 font-mono text-xs"
          type="password"
          value={key}
          placeholder={saved ? '••••••••（留空表示不修改）' : 'API Key'}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
        />
        <Button size="sm" variant="outline" disabled={busy !== null || (!saved && !key.trim())} onClick={() => void run('test')}>{busy === 'test' ? '检测中…' : '测试'}</Button>
        <Button size="sm" disabled={busy !== null || !key.trim()} onClick={() => void run('save')}>保存</Button>
        {saved && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run('remove')}>移除</Button>}
      </div>
    </div>
  );
}

export function WebSearchSection() {
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
  const configured = SEARCH_ENGINES.filter((e) => info.keys[e]);

  return (
    <section>
      <h3 className="px-1 text-sm font-semibold">联网搜索</h3>
      <p className="mt-0.5 px-1 text-xs text-muted-foreground">
        让模型能搜索网页（pidesk_web_search）并读取网页内容（pidesk_web_fetch，无需密钥）。搜索需要你自己的 API 密钥，下面几家都有免费额度。密钥只保存在这台电脑的数据目录中，不会显示或发给模型。
      </p>
      <div className="mt-3 flex flex-col gap-2 px-1">
        <Segmented value={info.engine} options={CHOICES} onChange={(id) => void choose(id)} className="self-start" />
        <p className="text-xs text-muted-foreground">
          {info.engine === ENGINE_AUTO
            ? '自动：优先用上次成功的引擎；它失败（如免费额度用完）就换下一个已配置的重试，之后默认用换到的这个。'
            : `固定使用 ${ENGINE_INFO[info.engine].label}，失败时不会换别的引擎。`}
          {info.engine === ENGINE_AUTO && !configured.length && '还没有配置任何密钥，模型暂时不能联网搜索。'}
        </p>
      </div>
      <div className="mt-2">
        <Panel>
          {SEARCH_ENGINES.map((e) => <EngineRow key={e} engine={e} info={info} onChange={setInfo} />)}
        </Panel>
      </div>
    </section>
  );
}
