// Inline badges inside a message: the @ tokens of attached context, @ paths typed by hand,
// and a leading /command. Clicking one shows what was attached (a file opens instead), so
// a badge is never a dead end.
import { CheckIcon, CopyIcon, GitCompareIcon, MessageSquareIcon, SquareTerminalIcon } from 'lucide-react';
import { messageSegments, type ContextReference, type MessageSegment } from '@shared/context-reference';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCopy } from './Copy';
import { useT } from '@/lib/i18n';
import { openDiffPanel, openFileRef, openSession } from '@/store/actions';

/** What a badge stands for: the captured snapshot, the session pointer, or the changed files. */
export function ReferencePreview({ reference }: { reference: ContextReference }) {
  const t = useT();
  const { copied, copy } = useCopy();
  const text = reference.text ?? '';
  const lineCount = text ? text.split('\n').length : 0;
  const Icon =
    reference.kind === 'diff' ? GitCompareIcon : reference.kind === 'session' ? MessageSquareIcon : SquareTerminalIcon;
  const title =
    reference.kind === 'session'
      ? reference.title || t('ref.session')
      : reference.kind === 'diff'
        ? t('ref.diff')
        : t('ref.terminal');
  return (
    <div className="w-96 max-w-[80vw] text-sm">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium" title={title}>
          {title}
        </span>
        {!!text && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title={t(copied ? 'ref.copied' : 'ref.copy')}
            aria-label={t('ref.copy')}
            onClick={() => copy(text)}
          >
            {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          </Button>
        )}
      </div>
      {reference.kind === 'session' ? (
        <div className="space-y-1.5 px-3 py-2 text-xs text-muted-foreground">
          <div className="font-mono break-all">{reference.sessionId}</div>
          <p>{t('ref.pointer')}</p>
        </div>
      ) : text ? (
        <pre
          data-selectable
          className="max-h-72 overflow-auto px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap"
        >
          {text}
        </pre>
      ) : (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t('ref.empty')}</p>
      )}
      <div className="flex items-center gap-2 border-t px-3 py-2">
        {reference.kind === 'diff' && (
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={openDiffPanel}>
            {t('ref.openDiff')}
          </Button>
        )}
        {reference.kind === 'session' && reference.sessionId && (
          <Button
            size="sm"
            variant="secondary"
            className="h-7 text-xs"
            onClick={() => void openSession(reference.sessionId!)}
          >
            {t('ref.openSession')}
          </Button>
        )}
        {reference.kind === 'terminal' && lineCount > 0 && (
          <span className="text-xs text-muted-foreground">{t('ref.lines', { n: lineCount })}</span>
        )}
      </div>
    </div>
  );
}

function ReferenceChip({ token, reference }: { token: string; reference: ContextReference | null }) {
  const t = useT();
  // A path typed by hand has no snapshot; its badge opens the file.
  if (!reference) {
    return (
      <button
        type="button"
        className="chip-inline"
        title={t('ctx.file')}
        onClick={() => void openFileRef(token.replace(/^@/, ''))}
      >
        {token}
      </button>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="chip-inline" title={t('ref.preview')}>
          {token}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-auto p-0">
        <ReferencePreview reference={reference} />
      </PopoverContent>
    </Popover>
  );
}

/** A message's text with its badges; the transcript and the preview window share this render. */
export function InlineMessage({ text, references }: { text: string; references: ContextReference[] }) {
  return (
    <>
      {messageSegments(text, references).map((segment: MessageSegment, i) =>
        segment.kind === 'text' ? (
          <span key={i}>{segment.text}</span>
        ) : segment.kind === 'command' ? (
          <span key={i} className="chip-inline">
            {segment.token}
          </span>
        ) : (
          <ReferenceChip key={i} token={segment.token} reference={segment.reference} />
        ),
      )}
    </>
  );
}
