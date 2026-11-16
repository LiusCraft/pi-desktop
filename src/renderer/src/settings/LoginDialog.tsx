// The dialog pi's own login flow drives: an OAuth browser/device flow, or the
// prompts an API-key setup asks. Prompts and progress arrive as host events;
// answers go back by request id, exactly like pi's terminal login dialog.
import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon, ExternalLinkIcon, Loader2Icon } from 'lucide-react';
import type { AuthPrompt, AuthType } from '@shared/protocol';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useCopy } from '@/components/common/Copy';
import { call } from '@/lib/api';
import { useT } from '@/lib/i18n';

export interface AuthUiState {
  loginId?: string;
  progress?: string;
  url?: string;
  instructions?: string;
  device?: { userCode: string; verificationUri: string };
  info?: { message: string; links?: { url: string; label?: string }[] };
  prompt?: { requestId: string; prompt: AuthPrompt };
}

function PromptForm({ prompt, onSubmit }: { prompt: AuthPrompt; onSubmit: (value: string) => void }) {
  const t = useT();
  const [value, setValue] = useState('');
  if (prompt.type === 'select') {
    return (
      <div className="space-y-1.5">
        <p className="text-sm">{prompt.message}</p>
        {prompt.options?.map((option) => (
          <button
            key={option.id}
            onClick={() => onSubmit(option.id)}
            className="w-full rounded-lg border px-3 py-2 text-left hover:bg-accent"
          >
            <span className="block text-sm font-medium">{option.label}</span>
            {option.description && (
              <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
            )}
          </button>
        ))}
      </div>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <p className="text-sm">{prompt.message}</p>
      <div className="flex gap-2">
        <Input
          autoFocus
          type={prompt.type === 'secret' ? 'password' : 'text'}
          autoComplete="off"
          spellCheck={false}
          placeholder={prompt.placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" disabled={!value.trim()}>
          {t('login.continue')}
        </Button>
      </div>
    </form>
  );
}

/** Copy control that confirms on itself; used for URLs and device codes. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useT();
  const { copied, copy } = useCopy();
  return (
    <Button type="button" size="sm" variant="ghost" onClick={() => copy(text)} title={label}>
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      {copied ? t('login.copied') : label}
    </Button>
  );
}

export function LoginDialog({
  providerName,
  authType,
  state,
  onRespond,
  onCancel,
}: {
  providerName: string;
  authType: AuthType;
  state: AuthUiState;
  onRespond: (requestId: string, value: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  // Keep the latest progress line visible long enough to read on very fast flows.
  const [progress, setProgress] = useState<string | undefined>(state.progress);
  useEffect(() => {
    if (state.progress) setProgress(state.progress);
  }, [state.progress]);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
            {t('login.title', { name: providerName })}
          </DialogTitle>
          <DialogDescription>{t(authType === 'oauth' ? 'login.oauth' : 'login.apiKey')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {state.device && (
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">{t('login.enterCode')}</p>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-lg font-semibold tracking-widest">{state.device.userCode}</span>
                <CopyButton text={state.device.userCode} label={t('login.copyCode')} />
              </div>
              <button
                onClick={() => void call('app:openExternal', state.device!.verificationUri)}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                {state.device.verificationUri}
                <ExternalLinkIcon className="size-3" />
              </button>
            </div>
          )}

          {state.url && (
            <div className="space-y-1.5 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t('login.visit')}</p>
              <div className="flex items-start gap-1">
                <span className="min-w-0 flex-1 font-mono text-xs break-all">{state.url}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void call('app:openExternal', state.url!)}
                >
                  <ExternalLinkIcon className="size-3.5" />
                  {t('login.openBrowser')}
                </Button>
                <CopyButton text={state.url} label={t('login.copyLink')} />
              </div>
              {state.instructions && <p className="text-xs text-amber-600">{state.instructions}</p>}
            </div>
          )}

          {state.info && (
            <div className="rounded-lg border bg-muted/40 p-3 text-xs">
              <p>{state.info.message}</p>
              {state.info.links?.map((link) => (
                <button
                  key={link.url}
                  onClick={() => void call('app:openExternal', link.url)}
                  className="mt-1 flex items-center gap-1 text-primary hover:underline"
                >
                  {link.label ?? link.url}
                  <ExternalLinkIcon className="size-3" />
                </button>
              ))}
            </div>
          )}

          {state.prompt ? (
            <PromptForm
              key={state.prompt.requestId}
              prompt={state.prompt.prompt}
              onSubmit={(value) => onRespond(state.prompt!.requestId, value)}
            />
          ) : (
            !state.device &&
            !state.url &&
            !state.info && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-3.5 animate-spin" />
                {progress ?? t('models.preparingLogin')}
              </div>
            )
          )}
          {state.prompt && progress && <p className="text-xs text-muted-foreground">{progress}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('login.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
