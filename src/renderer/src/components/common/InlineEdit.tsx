// Editing a name where it is shown, instead of in a dialog: Enter or leaving the
// field saves, Escape throws the edit away.
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export function InlineEdit({
  value,
  onCommit,
  onCancel,
  className,
  ariaLabel,
  maxLength,
}: {
  value: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
  ariaLabel?: string;
  maxLength: number;
}) {
  const [text, setText] = useState(value);
  const finished = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  // A menu that started the edit hands focus back to its trigger as it closes: take it after that.
  useEffect(() => {
    const timer = setTimeout(() => {
      input.current?.focus();
      input.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const next = text.trim();
    if (save && next && next !== value) onCommit(next);
    else onCancel();
  };

  return (
    <input
      ref={input}
      value={text}
      maxLength={maxLength}
      aria-label={ariaLabel}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        // Enter and Escape belong to the field, not to the app's shortcuts.
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
      // The row or title button underneath would otherwise react to these too.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'min-w-0 rounded-md border border-ring/50 bg-background px-1.5 py-0.5 text-sm outline-none',
        className,
      )}
    />
  );
}
