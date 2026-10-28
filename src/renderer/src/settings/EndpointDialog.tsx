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
import { t, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { API_LABELS, agoLabel, modelMetaLine } from './model-format';

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
            thinkingLevelMap: existing.thinkingLevelMap ?? model.thinkingLevelMap,
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
    <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={t('endpoint.editModel', { id: model.id })} onClick={onEdit}>
      <PencilIcon data-icon="inline-start" />{t('endpoint.editShort')}
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
  const t = useT();
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
        toast.success(t(result.models.some((m) => m.source === 'models.dev') ? 'endpoint.fetchedAligned' : 'endpoint.fetched', { n: result.models.length }));
      }
      if (result.error) setError(result.error.replace(/^(?:无法获取模型列表：|Cannot fetch the model list: )/, ''));
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
    if (editingModel) return setError(t('endpoint.finishModel'));
    if (!id.trim()) return setError(t('endpoint.needId'));
    if (!baseUrl.trim()) return setError(t('endpoint.needUrl'));
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
      toast.success(t(editing ? 'endpoint.updated' : 'endpoint.added'));
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
          <DialogTitle>{editing ? t('endpoint.editTitle', { name: endpoint!.name }) : t('endpoint.addTitle')}</DialogTitle>
          <DialogDescription>
            {t('endpoint.desc')}
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
              <p className="text-[11px] text-muted-foreground">{t('endpoint.idHint', { ref: `${id.trim().toLowerCase() || 'provider'}/model-id` })}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endpoint-name">{t('endpoint.displayName')}</Label>
              <Input id="endpoint-name" value={name} placeholder={id || t('endpoint.optional')} onChange={(e) => setName(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">{t('endpoint.nameHint')}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="endpoint-url">{t('endpoint.url')}</Label>
            <Input
              id="endpoint-url"
              value={baseUrl}
              spellCheck={false}
              placeholder="https://api.example.com/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('endpoint.urlHint')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('endpoint.apiType')}</Label>
              <Select value={api || 'provider-default'} onValueChange={(value) => setApi(value === 'provider-default' ? '' : value)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {apiOptions.map((value) => (
                    <SelectItem key={value || 'default'} value={value || 'provider-default'}>{value ? API_LABELS[value] ?? value : t('fmt.apiDefault')}</SelectItem>
                  ))}
                </SelectGroup></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endpoint-key">{t('endpoint.apiKey')}</Label>
              {endpoint?.builtin ? (
                <p className="flex h-9 items-center text-xs text-muted-foreground">{t('endpoint.builtinKey')}</p>
              ) : (
                <>
                  <Input
                    id="endpoint-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    disabled={removeKey}
                    placeholder={endpoint?.keySet ? t('endpoint.keySavedPh') : isLocal ? t('endpoint.localPh') : t('endpoint.optional')}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {endpoint?.keySet
                        ? t('endpoint.current', { source: endpoint.keySource ?? t('endpoint.saved') })
                        : isLocal
                          ? t('endpoint.localKey')
                          : baseUrl.trim()
                            ? t('endpoint.remoteNoKey')
                            : t('endpoint.enterUrlFirst')}
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
                        {removeKey ? t('endpoint.undoRemove') : t('endpoint.removeKey')}
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
                <div className="text-sm font-medium">{t('endpoint.models')}</div>
                <p className="text-[11px] text-muted-foreground">
                  {t('endpoint.selected', { n: selected.size, total: models.length })}{catalogAt ? t('endpoint.updatedAgo', { ago: agoLabel(catalogAt) }) : ''}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={!!busy || !!editingModel || !baseUrl.trim()} onClick={() => void discover()}>
                {busy === 'discover' ? <Loader2Icon className="size-3.5 animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
                {t('endpoint.fetch')}
              </Button>
            </div>

            {models.length > 8 && (
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} disabled={!!editingModel || !!busy} onChange={(e) => setQuery(e.target.value)} placeholder={t('endpoint.filter')} className="h-8 pl-8 text-xs" />
              </div>
            )}

            {models.length > 0 && (
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{t('endpoint.matches', { n: visibleModels.length })}</span>
                <div className="flex gap-2">
                  <button type="button" className="hover:underline" onClick={() => setSelected(new Set(models.map((m) => m.id)))}>{t('endpoint.selectAll')}</button>
                  <button type="button" className="hover:underline" onClick={() => setSelected(new Set())}>{t('endpoint.clear')}</button>
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
                  {models.length ? t('endpoint.noMatch') : t('endpoint.noModels')}
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
              <Input value={newModel} disabled={!!editingModel || !!busy} onChange={(e) => setNewModel(e.target.value)} placeholder={t('endpoint.addById')} className="h-8 text-xs" spellCheck={false} />
              <Button type="submit" size="sm" variant="outline" disabled={!newModel.trim() || !!editingModel || !!busy}>
                <PlusIcon className="size-3.5" />
                {t('endpoint.add')}
              </Button>
            </form>

            {models.some((model) => selected.has(model.id) && model.source === 'models.dev') && (
              <p className="text-[11px] text-muted-foreground">{t('endpoint.alignedNote')}</p>
            )}
          </div>

          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          {endpoint && endpoint.extra.length > 0 && (
            <p className="text-[11px] text-muted-foreground">{t('endpoint.extra', { fields: endpoint.extra.join(', ') })}</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={!!busy} onClick={onClose}>{t('endpoint.cancel')}</Button>
          <Button type="button" disabled={!!busy || !!editingModel} onClick={() => void save()}>
            {busy === 'save' && <Loader2Icon className="size-3.5 animate-spin" />}
            {t('endpoint.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
