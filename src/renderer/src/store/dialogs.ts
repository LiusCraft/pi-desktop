// Promise-based dialogs: `await dialogs.prompt(...)` from anywhere, rendered by <DialogHost/>.
import { create } from 'zustand';

export type DialogSpec =
  | { kind: 'prompt'; title: string; value: string; placeholder?: string; action?: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; body: string; action: string; destructive?: boolean; resolve: (v: boolean) => void }
  | { kind: 'choose'; title: string; options: { label: string; hint?: string }[]; resolve: (v: number | null) => void }
  | { kind: 'keys'; resolve: (v: boolean) => void };

export const useDialogs = create<{ current: DialogSpec | null }>(() => ({ current: null }));

function open<T>(spec: (resolve: (v: T) => void) => DialogSpec) {
  return new Promise<T>((resolve) => {
    useDialogs.setState({
      current: spec((v) => {
        useDialogs.setState({ current: null });
        resolve(v);
      }),
    });
  });
}

export const dialogs = {
  prompt: (title: string, value = '', opts: { placeholder?: string; action?: string } = {}) =>
    open<string | null>((resolve) => ({ kind: 'prompt', title, value, ...opts, resolve })),
  confirm: (title: string, body: string, action = 'OK', destructive = false) =>
    open<boolean>((resolve) => ({ kind: 'confirm', title, body, action, destructive, resolve })),
  choose: (title: string, options: { label: string; hint?: string }[]) =>
    open<number | null>((resolve) => ({ kind: 'choose', title, options, resolve })),
  keys: () => open<boolean>((resolve) => ({ kind: 'keys', resolve })),
};
