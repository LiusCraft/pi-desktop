// Add or edit a custom endpoint in pi's models.json. The model list can be
// fetched from the endpoint itself, and every model id is matched against
// models.dev so context window, output limit and prices are filled automatically.
import { useMemo, useState } from 'react';
import { Loader2Icon, PencilIcon, PlusIcon, RefreshCwIcon, SearchIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ENDPOINT_APIS, type EndpointDraft, type EndpointInfo, type EndpointModel, type ModelCatalogInfo } from '@shared/protocol';
import { alignModel } from '@shared/model-metadata';
import { ModelEditor } from './ModelEditor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { call, errText } from '@/lib/api';
import { cn } from '@/lib/utils';
import { API_LABELS, agoZh, modelMetaLine } from './model-format';

const DEFAULT_API = 'openai-completions';

/** Merge a freshly fetched list over what the editor already has; local values win. */
export function mergeModels(current: EndpointModel[], fetched: EndpointModel[]): EndpointModel[] {
  const byId = new Map(current.map((model) => [model.id, model]));
  for (const model of fetched) {
    const existing = byId.get(model.id);
    byId.set(
      model.id,
      existing
        ? {
            id: existing.id,
            name: existing.name ?? model.name,
            contextWindow: existing.contextWindow ?? model.contextWindow,
            maxTokens: existing.maxTokens ?? model.maxTokens,
            reasoning: existing.reasoning ?? model.reasoning,
            input: existing.input ?? model.input,
            cost: alignModel(existing, model).cost,
            source: existing.source ?? model.source,
          }
        : model,
    );
  }
  return [...byId.values()];
}

function ModelRow({ model, selected, disabled, onToggle, onEdit }: { model: EndpointModel; selected: boolean; disabled: boolean; onToggle: () => void; onEdit: () => void }) {
  return (
    <div className="flex items-center gap-1">
    <Label className={cn('min-w-0 flex-1 items-start gap-2.5 rounded-md px-2 py-2 font-normal leading-normal hover:bg-accent', !disabled && 'cursor-pointer')}>
      <Checkbox checked={selected} disabled={disabled} onCheckedChange={onToggle} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-mono text-xs">{model.id}</span>
          {model.source === 'models.dev' && <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] text-muted-foreground">models.dev</Badge>}
        </span>
        {model.name && model.name !== model.id && <span className="mt-0.5 block truncate text-xs">{model.name}</span>}
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{modelMetaLine(model)}</span>
      </span>
    </Label>
    <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`编辑模型 ${model.id}`} onClick={onEdit}>
      <PencilIcon data-icon="inline-start" />编辑
    </Button>
    </div>
  );
}

export function EndpointDialog({
  endpoint,
  catalogAt,
  onClose,
  onSaved,
}: {
  /** null: add a new endpoint. */
  endpoint: EndpointInfo | null;
  catalogAt: number | null;
  onClose: () => void;
  onSaved: (catalog: ModelCatalogInfo) => void;
}) {
  const editing = Boolean(endpoint);
  const [id, setId] = useState(endpoint?.id ?? '');
  const [name, setName] = useState(endpoint && endpoint.name !== endpoint.id ? endpoint.name : '');
  const [baseUrl, setBaseUrl] = useState(endpoint?.baseUrl ?? '');
  const [api, setApi] = useState(endpoint?.api || (endpoint?.builtin ? '' : DEFAULT_API));
  const [apiKey, setApiKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [models, setModels] = useState<EndpointModel[]>(endpoint?.models ?? []);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(endpoint?.models.map((model) => model.id) ?? []));
  const [newModel, setNewModel] = useState('');
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'discover' | 'save' | null>(null);

  const apiOptions = useMemo(() => {
    const known = ENDPOINT_APIS as readonly string[];
    const values = api && !known.includes(api) ? [api, ...ENDPOINT_APIS] : [...ENDPOINT_APIS];
    return endpoint?.builtin ? ['', ...values] : values;
  }, [api, endpoint?.builtin]);
  const visibleModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((model) => !q || model.id.toLowerCase().includes(q) || model.name?.toLowerCase().includes(q));
  }, [models, query]);
  const isLocal = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(baseUrl.trim());

  const toggle = (modelId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const discover = async () => {
    setError(null);
    setBusy('discover');
    try {
      const result = await call('models:endpointDiscover', {
        id: id.trim().toLowerCase(),
        name: name.trim() || undefined,
        baseUrl: baseUrl.trim(),
        api,
        apiKey: apiKey.trim() || undefined,
        models: [],
      } satisfies EndpointDraft);
      if (result.models.length) {
        const firstLoad = models.length === 0;
        setModels((prev) => mergeModels(prev, result.models));
        if (firstLoad) setSelected(new Set(result.models.map((model) => model.id)));
        toast.success(`获取到 ${result.models.length} 个模型${result.models.some((m) => m.source === 'models.dev') ? '，已按 models.dev 对齐元数据' : ''}`);
      }
      if (result.error) setError(result.error.replace(/^无法获取模型列表：/, ''));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const addModel = () => {
    const modelId = newModel.trim();
    if (!modelId || busy || editingModel) return;
    setModels((prev) => (prev.some((model) => model.id === modelId) ? prev : [...prev, { id: modelId, source: 'manual' }]));
    setSelected((prev) => new Set(prev).add(modelId));
    setNewModel('');
    setQuery('');
    setEditingModel(modelId);
  };

  const save = async () => {
    setError(null);
    if (editingModel) return setError('请先应用或取消模型修改');
    if (!id.trim()) return setError('请填写 Provider ID');
    if (!baseUrl.trim()) return setError('请填写 API 地址');
    setBusy('save');
    try {
      const draft: EndpointDraft = {
        id: id.trim().toLowerCase(),
        name: name.trim() || undefined,
        baseUrl: baseUrl.trim(),
        api,
        apiKey: !endpoint?.builtin && apiKey.trim() ? apiKey.trim() : undefined,
        removeKey: removeKey || undefined,
        models: models.filter((model) => selected.has(model.id)),
      };
      const catalog = await call('models:endpointSave', draft);
      toast.success(editing ? '端点已更新' : '端点已添加');
      onSaved(catalog);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[86vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? `编辑端点 · ${endpoint!.name}` : '添加自定义端点'}</DialogTitle>
          <DialogDescription>
            写入 pi 的 <span className="font-mono">models.json</span>，pi CLI 也会看到这个端点。密钥保存在 <span className="font-mono">auth.json</span>，不会写进 models.json。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="endpoint-id">Provider ID</Label>
              <Input
                id="endpoint-id"
                value={id}
                disabled={editing}
                spellCheck={false}
                placeholder="my-endpoint"
                onChange={(e) => setId(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))}
              />
              <p className="text-[11px] text-muted-foreground">模型会以 <span className="font-mono">{id.trim().toLowerCase() || 'provider'}/model-id</span> 出现在模型菜单里。</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endpoint-name">显示名称</Label>
              <Input id="endpoint-name" value={name} placeholder={id || '可留空'} onChange={(e) => setName(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">留空时使用 Provider ID。</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="endpoint-url">API 地址</Label>
            <Input
              id="endpoint-url"
              value={baseUrl}
              spellCheck={false}
              placeholder="https://api.example.com/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              OpenAI 兼容端点通常以 <span className="font-mono">/v1</span> 结尾；Anthropic 兼容端点填服务根地址即可。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>API 类型</Label>
              <Select value={api || 'provider-default'} onValueChange={(value) => setApi(value === 'provider-default' ? '' : value)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {apiOptions.map((value) => (
                    <SelectItem key={value || 'default'} value={value || 'provider-default'}>{value ? API_LABELS[value] ?? value : '跟随 provider 默认'}</SelectItem>
                  ))}
                </SelectGroup></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endpoint-key">API 密钥</Label>
              {endpoint?.builtin ? (
                <p className="flex h-9 items-center text-xs text-muted-foreground">内置 provider：密钥在上方“账号与密钥”里管理。</p>
              ) : (
                <>
                  <Input
                    id="endpoint-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    disabled={removeKey}
                    placeholder={endpoint?.keySet ? '已保存密钥，留空保持不变' : isLocal ? '本地端点可留空' : '可留空'}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {endpoint?.keySet
                        ? `当前：${endpoint.keySource ?? '已保存'}`
                        : isLocal
                          ? '本地地址会自动写入 pi 的占位密钥。'
                          : baseUrl.trim()
                            ? '没有密钥的远程端点不会出现在模型菜单里。'
                            : '填写地址后会自动判断是否需要密钥。'}
                    </span>
                    {endpoint?.keySet && (
                      <button
                        type="button"
                        className={cn('shrink-0 hover:underline', removeKey ? 'text-destructive' : 'text-muted-foreground')}
                        onClick={() => {
                          setRemoveKey((v) => !v);
                          setApiKey('');
                        }}
                      >
                        {removeKey ? '取消移除' : '移除密钥'}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">模型</div>
                <p className="text-[11px] text-muted-foreground">
                  已选 {selected.size} / {models.length} · 每个模型均可编辑，models.dev 提供参考值{catalogAt ? `（${agoZh(catalogAt)}更新）` : ''}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={!!busy || !!editingModel || !baseUrl.trim()} onClick={() => void discover()}>
                {busy === 'discover' ? <Loader2Icon className="size-3.5 animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
                获取模型列表
              </Button>
            </div>

            {models.length > 8 && (
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} disabled={!!editingModel || !!busy} onChange={(e) => setQuery(e.target.value)} placeholder="筛选模型" className="h-8 pl-8 text-xs" />
              </div>
            )}

            {models.length > 0 && (
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{visibleModels.length} 个匹配</span>
                <div className="flex gap-2">
                  <button type="button" className="hover:underline" onClick={() => setSelected(new Set(models.map((m) => m.id)))}>全选</button>
                  <button type="button" className="hover:underline" onClick={() => setSelected(new Set())}>清空</button>
                </div>
              </div>
            )}

            <div className="max-h-64 overflow-y-auto">
              {visibleModels.length ? (
                visibleModels.map((model) => (
                  <div key={model.id}>
                    <ModelRow model={model} selected={selected.has(model.id)} disabled={!!busy || (!!editingModel && editingModel !== model.id)} onToggle={() => toggle(model.id)} onEdit={() => setEditingModel(model.id)} />
                    {editingModel === model.id && (
                      <ModelEditor model={model} onCancel={() => setEditingModel(null)} onApply={(updated) => {
                        setModels((previous) => previous.map((item) => item.id === updated.id ? updated : item));
                        setSelected((previous) => new Set(previous).add(updated.id));
                        setEditingModel(null);
                        setError(null);
                      }} />
                    )}
                  </div>
                ))
              ) : (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  {models.length ? '没有匹配的模型。' : '还没有模型。点“获取模型列表”，或手动添加模型 ID。'}
                </p>
              )}
            </div>

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addModel();
              }}
            >
              <Input value={newModel} disabled={!!editingModel || !!busy} onChange={(e) => setNewModel(e.target.value)} placeholder="手动添加模型 ID" className="h-8 text-xs" spellCheck={false} />
              <Button type="submit" size="sm" variant="outline" disabled={!newModel.trim() || !!editingModel || !!busy}>
                <PlusIcon className="size-3.5" />
                添加
              </Button>
            </form>

            {models.some((model) => selected.has(model.id) && model.source === 'models.dev') && (
              <p className="text-[11px] text-muted-foreground">models.dev 仅补充缺失值；点击模型旁的“编辑”可覆盖上下文、最大输出、价格和能力。</p>
            )}
          </div>

          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          {endpoint && endpoint.extra.length > 0 && (
            <p className="text-[11px] text-muted-foreground">这个条目在 models.json 里还有：{endpoint.extra.join('、')}（保存时保持原样）。</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={!!busy} onClick={onClose}>取消</Button>
          <Button type="button" disabled={!!busy || !!editingModel} onClick={() => void save()}>
            {busy === 'save' && <Loader2Icon className="size-3.5 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
