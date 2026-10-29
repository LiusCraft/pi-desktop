import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Clipboard write; a failure is the one thing worth a toast. Resolves to
 * whether the text landed, so callers can show their own confirmation.
 */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast.error(t('copy.failed'));
    return false;
  }
}

/**
 * Clipboard writes plus a short-lived "done" flag. Copying is confirmed on the
 * control itself (icon or label), never with a toast: the user already knows
 * what they clicked, and a toast would only cover the transcript.
 */
export function useCopy(resetMs = 1400) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback(
    (text: string) => {
      void copyText(text).then((ok) => {
        if (!ok) return;
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), resetMs);
      });
    },
    [resetMs],
  );
  return { copied, copy };
}

/** Copy/check glyph shared by every icon-sized copy control. */
export function CopyGlyph({ copied, className }: { copied: boolean; className?: string }) {
  return copied ? (
    <CheckIcon className={cn('size-3.5 text-success', className)} />
  ) : (
    <CopyIcon className={cn('size-3.5', className)} />
  );
}
