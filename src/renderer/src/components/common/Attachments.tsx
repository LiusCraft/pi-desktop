import { useState } from 'react';
import { FileIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { imageSource, type Attachment, type DecodedAttachment } from '@shared/attachments';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { sizeLabel } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type AnyAttachment = Attachment | DecodedAttachment;

export function AttachmentTiles({ attachments, onRemove, disabled }: {
  attachments: AnyAttachment[];
  onRemove?: (index: number) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [preview, setPreview] = useState<AnyAttachment | null>(null);
  if (!attachments.length) return null;
  const open = (a: AnyAttachment) => {
    if (imageSource(a)) setPreview(a);
    else if (a.kind !== 'file') toast.warning(t('attach.unavailable'));
  };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {attachments.map((a, i) => {
          const src = imageSource(a);
          const missing = 'missing' in a && a.missing;
          return (
            <div key={a.id} className={cn('group relative flex h-14 max-w-56 items-center gap-2 overflow-hidden rounded-lg border bg-card pr-3 text-left', missing && 'opacity-60')}>
              <button type="button" onClick={() => open(a)} title={a.kind === 'file' ? t('attach.localRef', { path: a.path }) : a.name} className="flex h-full min-w-0 items-center gap-2">
                {src ? (
                  <img src={src} alt={a.name} className="h-full w-14 shrink-0 object-cover" />
                ) : (
                  <span className="flex h-full w-12 shrink-0 items-center justify-center bg-muted text-muted-foreground">
                    <FileIcon className="size-5" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{a.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {missing ? t('attach.unavailable') : a.kind === 'file' ? t('attach.localFile', { size: sizeLabel(a.size) }) : sizeLabel(a.size)}
                  </span>
                </span>
              </button>
              {onRemove && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(i)}
                  aria-label={`Remove ${a.name}`}
                  className="absolute top-1 right-1 hidden rounded-full bg-background/90 p-0.5 text-muted-foreground shadow group-hover:block hover:text-foreground"
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-[min(90vw,1100px)] p-3">
          <DialogTitle className="truncate pr-8 text-sm">{preview?.name}</DialogTitle>
          {preview && <img src={imageSource(preview)} alt={preview.name} className="max-h-[78vh] w-full rounded object-contain" />}
        </DialogContent>
      </Dialog>
    </>
  );
}
