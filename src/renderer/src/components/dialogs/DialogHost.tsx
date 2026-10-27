import { useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import { useDialogs, type DialogSpec } from '@/store/dialogs';

function PromptDialog({ spec }: { spec: Extract<DialogSpec, { kind: 'prompt' }> }) {
  const t = useT();
  const [value, setValue] = useState(spec.value);
  return (
    <Dialog open onOpenChange={(o) => !o && spec.resolve(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{spec.title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            spec.resolve(value.trim());
          }}
          className="space-y-4"
        >
          <Input autoFocus value={value} placeholder={spec.placeholder} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => spec.resolve(null)}>{t('dialog.cancel')}</Button>
            <Button type="submit">{spec.action ?? t('dialog.ok')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DialogHost() {
  const t = useT();
  const spec = useDialogs((s) => s.current);
  if (!spec) return null;
  switch (spec.kind) {
    case 'prompt':
      return <PromptDialog spec={spec} />;
    case 'confirm':
      return (
        <AlertDialog open onOpenChange={(o) => !o && spec.resolve(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{spec.title}</AlertDialogTitle>
              <AlertDialogDescription className="break-words whitespace-pre-line">{spec.body}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => spec.resolve(false)}>{t('dialog.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => spec.resolve(true)}>{spec.action}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    case 'choose':
      return (
        <Dialog open onOpenChange={(o) => !o && spec.resolve(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{spec.title}</DialogTitle>
            </DialogHeader>
            <div className="max-h-[60vh] space-y-1 overflow-y-auto">
              {spec.options.map((o, i) => (
                <button key={i} onClick={() => spec.resolve(i)} className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left text-sm hover:bg-accent">
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      );
  }
}
