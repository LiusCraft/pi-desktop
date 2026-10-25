import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { KeyStatus } from '@shared/protocol';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { call, errText } from '@/lib/api';
import { loadModels } from '@/store/actions';
import { useDialogs, type DialogSpec } from '@/store/dialogs';

function PromptDialog({ spec }: { spec: Extract<DialogSpec, { kind: 'prompt' }> }) {
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
            <Button type="button" variant="outline" onClick={() => spec.resolve(null)}>Cancel</Button>
            <Button type="submit">{spec.action ?? 'OK'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function KeysDialog({ spec }: { spec: Extract<DialogSpec, { kind: 'keys' }> }) {
  const [status, setStatus] = useState<Record<string, KeyStatus>>({});
  const [provider, setProvider] = useState('anthropic');
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    call('keys:status').then(setStatus).catch(() => {});
  }, []);
  const save = async () => {
    setSaving(true);
    try {
      await call('keys:set', provider, key.trim());
      await loadModels();
      spec.resolve(true);
    } catch (err) {
      toast.error(errText(err));
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && spec.resolve(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>API keys</DialogTitle>
          <DialogDescription>
            密钥保存在本机（系统加密存储可用时会加密），只在 agent 进程里使用。也可以直接用环境变量或 <code>~/.pi/agent/auth.json</code>。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.keys(status).map((p) => <SelectItem key={p} value={p}>{p}{status[p].saved ? ' ✓' : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>API key</Label>
            <Input type="password" autoComplete="off" placeholder="留空则删除已保存的密钥" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => spec.resolve(false)}>Cancel</Button>
          <Button disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DialogHost() {
  const spec = useDialogs((s) => s.current);
  if (!spec) return null;
  switch (spec.kind) {
    case 'prompt':
      return <PromptDialog spec={spec} />;
    case 'keys':
      return <KeysDialog spec={spec} />;
    case 'confirm':
      return (
        <AlertDialog open onOpenChange={(o) => !o && spec.resolve(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{spec.title}</AlertDialogTitle>
              <AlertDialogDescription>{spec.body}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => spec.resolve(false)}>Cancel</AlertDialogCancel>
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
