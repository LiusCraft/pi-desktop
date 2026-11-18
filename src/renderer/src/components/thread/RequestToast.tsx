import { useEffect } from 'react';
import { toast } from 'sonner';
import type { UiRequest, UiResponse } from '@shared/protocol';
import { Button } from '@/components/ui/button';
import { t, useT } from '@/lib/i18n';
import { useApp } from '@/store/app';
import { pendingRequest } from '@/store/transcript';

interface Actions {
  answer(response: UiResponse, label: string): void;
  open(): void;
}

function RequestActions({
  sid,
  request,
  toastId,
  actions,
}: {
  sid: string;
  request: UiRequest;
  toastId: string;
  actions: Actions;
}) {
  const t = useT();
  const pending = useApp((st) => !!pendingRequest(st.sessions[sid], request.id));
  useEffect(() => {
    if (!pending) toast.dismiss(toastId);
  }, [pending, toastId]);
  if (!pending) return null;

  const prompt =
    request.kind === 'confirm' ? [request.title, request.message].filter(Boolean).join('\n') : request.title;
  // Never offer one-click approval for a prompt shown only in part.
  const compact = prompt.trim() !== '' && prompt.length <= 180 && prompt.split('\n').length <= 3;
  const permission = request.kind === 'permission';
  const confirm = request.kind === 'confirm';
  const answer = (yes: boolean) => {
    const value = yes ? 'Allow' : 'Deny';
    if (permission) actions.answer({ value }, value);
    else actions.answer({ confirmed: yes }, yes ? 'Yes' : 'No');
  };
  return (
    <>
      <div className={`wrap-anywhere whitespace-pre-wrap ${compact ? '' : 'line-clamp-3'}`}>{prompt}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {compact && (permission || confirm) && (
          <>
            <Button size="xs" onClick={() => answer(true)}>
              {t(permission ? 'perm.allow' : 'dialog.yes')}
            </Button>
            <Button size="xs" variant="outline" onClick={() => answer(false)}>
              {t(permission ? 'perm.deny' : 'dialog.no')}
            </Button>
          </>
        )}
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            toast.dismiss(toastId);
            actions.open();
          }}
        >
          {t(request.kind === 'plan' ? 'plan.open' : permission || confirm ? 'ref.openSession' : 'act.replyInSession')}
        </Button>
      </div>
    </>
  );
}

/** In-window shortcuts only: native notifications still open the session. */
export function showRequestToast(sid: string, title: string, request: UiRequest, actions: Actions) {
  const id = `ui-request:${sid}:${request.id}`;
  const decision = request.kind === 'permission' || request.kind === 'confirm' || request.kind === 'plan';
  toast.warning(t(decision ? 'act.needsApproval' : 'act.needsReply', { title }), {
    id,
    description: <RequestActions sid={sid} request={request} toastId={id} actions={actions} />,
    classNames: { content: 'min-w-0', title: 'line-clamp-2 wrap-anywhere' },
    duration: 12_000,
    closeButton: true,
  });
}
