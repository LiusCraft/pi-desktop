// Settings → Models: provider accounts (OAuth or API key, stored in pi's
// auth.json), custom endpoints (pi's models.json) and the models they expose,
// rendered as item lists instead of a table.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CheckCircle2Icon, ChevronDownIcon, ExternalLinkIcon, KeyRoundIcon, Loader2Icon, LogInIcon, PencilIcon, PlusIcon,
  RefreshCwIcon, SearchIcon, ServerIcon, Trash2Icon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AuthType, EndpointInfo, ModelCatalogInfo, ProviderInfo } from '@shared/protocol';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { bridge, call, errText, isRemote } from '@/lib/api';
import { t, useT } from '@/lib/i18n';
import { EndpointDialog } from './EndpointDialog';
import { LoginDialog, type AuthUiState } from './LoginDialog';
import { API_LABELS, agoLabel, modelMetaLine } from './model-format';

const Heading = ({ title, sub }: { title: string; sub: string }) => (
  <div className="mb-5">
    <h2 className="text-xl font-semibold">{title}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
  </div>
);
const Panel = ({ children }: { children: ReactNode }) => <div className="divide-y rounded-xl border bg-card">{children}</div>;
const Dot = () => <span className="mx-0.5 text-muted-foreground/70">·</span>;

function ProviderMark({ name, id }: { name: string; id: string }) {
  const letter = (name || id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 1).toUpperCase() || '?';
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-xs font-semibold text-muted-foreground">
      {letter}
    </span>
  );
}

function authLabel(provider: ProviderInfo): string | undefined {
  if (!provider.configured || !provider.authType) return undefined;
  if (provider.authType === 'oauth') return provider.subscription ? t('models.subscription') : t('models.accountLogin');
  return t('models.apiKey');
}

function endpointBadges(endpoint: EndpointInfo) {
  return (
    <>
      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{t('models.nModels', { n: endpoint.models.length })}</Badge>
      {endpoint.builtin && <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{t('models.overrides', { id: endpoint.id })}</Badge>}
      {!endpoint.keySet && <Badge variant="outline" className="border-amber-500/40 px-1.5 py-0 text-[10px] text-amber-600">{t('models.noKey')}</Badge>}
    </>
  );
}

export function ModelsSection() {
  const t = useT();
  const [catalog, setCatalog] = useState<ModelCatalogInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [login, setLogin] = useState<{ provider: string; providerName: string; authType: AuthType } | null>(null);
  const [auth, setAuth] = useState<AuthUiState>({});
  const [editor, setEditor] = useState<{ endpoint: EndpointInfo | null } | null>(null);
  const [deleting, setDeleting] = useState<EndpointInfo | null>(null);
  const metadataRetried = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await call('models:catalog');
      setCatalog(next);
      setError(null);
      // The host refreshes models.dev in the background; one retry shows its metadata without blocking the window.
      if (next.catalogAt === null && !metadataRetried.current) {
        metadataRetried.current = true;
        window.setTimeout(() => void load(), 2500);
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return bridge.on('host:event', (ev) => {
      if (ev.type === 'auth_prompt') {
        setAuth((state) => ({ ...state, loginId: ev.loginId, prompt: { requestId: ev.requestId, prompt: ev.prompt } }));
        return;
      }
      if (ev.type === 'auth_event') {
        setAuth((state) => {
          const next: AuthUiState = { ...state, loginId: ev.loginId };
          const event = ev.event;
          if (event.type === 'progress') next.progress = event.message;
          if (event.type === 'auth_url') {
            next.url = event.url;
            next.instructions = event.instructions;
            next.progress = t('models.waitBrowser');
            void call('app:openExternal', event.url);
          }
          if (event.type === 'device_code') {
            next.device = { userCode: event.userCode, verificationUri: event.verificationUri };
            next.progress = t('models.waitDevice');
          }
          if (event.type === 'info') {
            next.info = { message: event.message, links: event.links };
            next.progress = event.message;
          }
          return next;
        });
        return;
      }
      if (ev.type === 'models_changed') void load();
    });
  }, [load]);

  const startLogin = async (provider: ProviderInfo, authType: AuthType) => {
    setAuth({ progress: t('models.preparingLogin') });
    setLogin({ provider: provider.id, providerName: provider.name, authType });
    try {
      await call('models:login', provider.id, authType, provider.name);
      toast.success(authType === 'oauth' ? t('models.signedIn', { name: provider.name }) : t('models.keySaved', { name: provider.name }));
    } catch (err) {
      const message = errText(err);
      if (!/cancel/i.test(message)) toast.error(message);
    } finally {
      setLogin(null);
      setAuth({});
      await load();
    }
  };

  const respond = (requestId: string, value: string) => {
    if (!auth.loginId) return;
    setAuth((state) => ({ ...state, prompt: undefined, progress: t('models.verifying') }));
    void call('models:loginRespond', auth.loginId, requestId, value).catch((err) => toast.error(errText(err)));
  };

  const cancelLogin = () => {
    if (auth.loginId) void call('models:loginCancel', auth.loginId).catch(() => {});
    setLogin(null);
    setAuth({});
  };

  const logout = async (provider: ProviderInfo) => {
    setBusy(provider.id);
    try {
      await call('models:logout', provider.id);
      toast.success(provider.authType === 'oauth' ? t('models.signedOut', { name: provider.name }) : t('models.keyRemoved', { name: provider.name }));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
      await load();
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    metadataRetried.current = false;
    try {
      setCatalog(await call('models:refresh'));
      toast.success(t('models.catalogRefreshed'));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setRefreshing(false);
    }
  };

  const removeEndpoint = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    setBusy(target.id);
    try {
      setCatalog(await call('models:endpointRemove', target.id));
      toast.success(t('models.endpointRemoved', { name: target.name }));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const custom = catalog?.endpoints ?? [];
  const configured = catalog?.providers.filter((p) => p.configured) ?? [];
  const others = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (catalog?.providers ?? []).filter((p) => {
      if (p.configured) return false;
      if (!q) return showAll;
      return p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    });
  }, [catalog, query, showAll]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { endpoints: custom, providers: configured };
    return {
      endpoints: custom.filter((e) => e.name.toLowerCase().includes(q) || e.id.includes(q) || e.baseUrl.toLowerCase().includes(q)),
      providers: configured.filter((p) => p.name.toLowerCase().includes(q) || p.id.includes(q)),
    };
  }, [custom, configured, query]);
  const unconfigured = (catalog?.providers.length ?? 0) - configured.length;

  const reveal = (target: string) => {
    void call('app:revealPath', target, true).catch((err) => toast.error(errText(err)));
  };

  const providerActions = (provider: ProviderInfo) => {
    const canKey = provider.apiKey && provider.apiKeyLogin;
    const disabled = Boolean(busy) || Boolean(login);
    if (provider.configured) {
      return (
        <div className="flex shrink-0 items-center gap-1">
          {((provider.authType === 'oauth' && provider.oauth) || (provider.authType === 'api_key' && canKey)) && (
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => void startLogin(provider, provider.authType!)}>
              {provider.authType === 'oauth' ? t('models.relogin') : t('models.changeKey')}
            </Button>
          )}
          {provider.credential && (
            <Button size="sm" variant="ghost" className="text-destructive" disabled={disabled} onClick={() => void logout(provider)}>
              {t('models.signOut')}
            </Button>
          )}
        </div>
      );
    }
    if (provider.oauth && canKey) {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={disabled}>
              <LogInIcon className="size-3.5" />
              {t('models.signIn')}
              <ChevronDownIcon className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => void startLogin(provider, 'oauth')}>{provider.oauthName ?? t('models.accountLogin')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void startLogin(provider, 'api_key')}>{t('models.apiKey')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    if (provider.oauth) {
      return (
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => void startLogin(provider, 'oauth')}>
          <LogInIcon className="size-3.5" />
          {provider.subscription ? t('models.signInAccount') : t('models.signIn')}
        </Button>
      );
    }
    if (canKey) {
      return (
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => void startLogin(provider, 'api_key')}>
          <KeyRoundIcon className="size-3.5" />
          {t('models.setKey')}
        </Button>
      );
    }
    return <span className="shrink-0 text-xs text-muted-foreground">{provider.apiKey ? t('models.fromEnv') : t('models.noSetup')}</span>;
  };

  if (loading) {
    return (
      <>
        <Heading title={t('models.title')} sub={t('models.sub')} />
        <p className="text-sm text-muted-foreground">{t('models.loading')}</p>
      </>
    );
  }

  return (
    <>
      <Heading
        title={t('models.title')}
        sub={t('models.sub2')}
      />

      <div className="mb-4 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('models.search')} className="pl-8" />
        </div>
        <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? <Loader2Icon className="size-3.5 animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
          {t('models.refreshCatalog')}
        </Button>
      </div>

      {(error || (catalog?.errors.length ?? 0) > 0) && (
        <div className="mb-4 space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
          {error && <p>{error}</p>}
          {catalog?.errors.map((message) => <p key={message} className="whitespace-pre-wrap font-mono">{message}</p>)}
        </div>
      )}

      <div className="mb-2 flex items-end justify-between">
        <div>
          <h3 className="text-sm font-semibold">{t('models.accountsKeys')}</h3>
          <p className="text-xs text-muted-foreground">{t('models.connected', { n: configured.length })}</p>
        </div>
      </div>

      <Panel>
        {filtered.providers.map((provider) => (
          <div key={provider.id} className="flex items-center gap-3 px-4 py-3">
            <ProviderMark name={provider.name} id={provider.id} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{provider.name}</span>
                {provider.custom && <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{t('models.custom')}</Badge>}
                {provider.configured ? (
                  <Badge variant="secondary" className="gap-1 bg-primary/10 px-1.5 py-0 text-[10px] text-primary">
                    <CheckCircle2Icon className="size-2.5" />
                    {t('models.connectedBadge')}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                <span className="font-mono">{provider.id}</span>
                {provider.configured && (
                  <>
                    <Dot />
                    <span>{authLabel(provider)}</span>
                    {provider.source && <><Dot /><span>{provider.source}</span></>}
                  </>
                )}
                {!provider.configured && provider.models > 0 && <><Dot /><span>{t('models.nModels', { n: provider.models })}</span></>}
              </div>
            </div>
            {providerActions(provider)}
          </div>
        ))}
        {!filtered.providers.length && !others.length && (
          <div className="px-4 py-4 text-sm text-muted-foreground">
            {query ? t('models.noMatchProvider') : t('models.noneConfigured')}
          </div>
        )}
        {others.length > 0 && (
          <>
            <div className="px-4 py-2 text-xs text-muted-foreground">{t('models.notConfigured')}</div>
            {others.map((provider) => (
              <div key={provider.id} className="flex items-center gap-3 px-4 py-3">
                <ProviderMark name={provider.name} id={provider.id} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{provider.name}</span>
                    {provider.custom && <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{t('models.custom')}</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <span className="font-mono">{provider.id}</span>
                    {provider.models > 0 && <><Dot /><span>{t('models.nModels', { n: provider.models })}</span></>}
                    {provider.oauth && <><Dot /><span>{provider.subscription ? t('models.supportsSubscription') : t('models.supportsAccount')}</span></>}
                  </div>
                </div>
                {providerActions(provider)}
              </div>
            ))}
          </>
        )}
        {!query && unconfigured > 0 && (
          <div className="px-4 py-2">
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => setShowAll((v) => !v)}>
              {showAll ? t('models.hideUnconfigured') : t('models.showMoreProviders', { n: unconfigured })}
            </button>
          </div>
        )}
      </Panel>

      <div className="mt-6 mb-2 flex items-end justify-between">
        <div>
          <h3 className="text-sm font-semibold">{t('models.customEndpoints')}</h3>
          <p className="text-xs text-muted-foreground">{t('models.customEndpoints.sub')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditor({ endpoint: null })}>
          <PlusIcon className="size-3.5" />
          {t('models.addEndpoint')}
        </Button>
      </div>

      <Panel>
        {filtered.endpoints.map((endpoint) => (
          <Collapsible key={endpoint.id}>
            <div className="flex items-center gap-3 px-4 py-3">
              <ServerIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{endpoint.name}</span>
                  {endpointBadges(endpoint)}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  <span className="font-mono">{endpoint.id}</span>
                  <Dot />
                  {endpoint.api ? (API_LABELS[endpoint.api] ?? endpoint.api) : t('fmt.apiDefault')}
                  {endpoint.baseUrl && <><Dot /><span className="font-mono">{endpoint.baseUrl}</span></>}
                </div>
              </div>
              <CollapsibleTrigger asChild>
                <Button size="icon" variant="ghost" className="group size-8 shrink-0" aria-label={t('models.modelList')}>
                  <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
                </Button>
              </CollapsibleTrigger>
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => setEditor({ endpoint })}>
                <PencilIcon className="size-3.5" />
                {t('models.edit')}
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" disabled={Boolean(busy)} onClick={() => setDeleting(endpoint)}>
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
            <CollapsibleContent>
              <div className="border-t bg-muted/20 px-4 py-2">
                {endpoint.models.length ? (
                  endpoint.models.map((model) => (
                    <div key={model.id} className="flex items-baseline justify-between gap-3 py-1">
                      <div className="min-w-0">
                        <span className="truncate font-mono text-xs">{model.id}</span>
                        {model.name && model.name !== model.id && <span className="ml-2 text-xs text-muted-foreground">{model.name}</span>}
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{modelMetaLine(model)}</span>
                    </div>
                  ))
                ) : (
                  <p className="py-1 text-xs text-muted-foreground">{t('models.noModelsYet')}</p>
                )}
                {endpoint.extra.length > 0 && (
                  <p className="pt-1 text-[11px] text-muted-foreground">{t('models.otherFields', { fields: endpoint.extra.join(', ') })}</p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
        {!filtered.endpoints.length && (
          <div className="px-4 py-4 text-sm text-muted-foreground">
            {query ? t('models.noMatchEndpoint') : t('models.noEndpoints')}
          </div>
        )}
      </Panel>

      <div className="mt-6 space-y-1.5 rounded-xl border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0">{t('models.credentials')}</span>
          <span className="min-w-0 flex-1 truncate font-mono">{catalog?.paths.auth}</span>
          {!isRemote && (
            <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => catalog && reveal(catalog.paths.auth)}>
              <ExternalLinkIcon className="size-3" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0">{t('models.endpoints')}</span>
          <span className="min-w-0 flex-1 truncate font-mono">{catalog?.paths.models}</span>
          {!isRemote && (
            <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => catalog && reveal(catalog.paths.models)}>
              <ExternalLinkIcon className="size-3" />
            </Button>
          )}
        </div>
        <p className="pt-1">
          {catalog?.catalogAt ? t('models.metaUpdated', { ago: agoLabel(catalog.catalogAt) }) : t('models.metaNever')}
        </p>
      </div>

      {login && (
        <LoginDialog
          providerName={login.providerName}
          authType={login.authType}
          state={auth}
          onRespond={respond}
          onCancel={cancelLogin}
        />
      )}

      {editor && (
        <EndpointDialog
          endpoint={editor.endpoint}
          catalogAt={catalog?.catalogAt ?? null}
          onClose={() => setEditor(null)}
          onSaved={(next) => {
            setCatalog(next);
            setEditor(null);
          }}
        />
      )}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('models.deleteTitle', { name: deleting?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('models.deleteBody', { id: deleting?.id ?? '' })}
              {deleting && !deleting.builtin ? t('models.deleteKeyToo') : ''}{t('models.deleteAfter')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('models.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeEndpoint()} className="bg-destructive text-white hover:bg-destructive/90">
              {t('models.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
