// What a desktop plugin sends out while its pages are open (see `HostEvent`'s `plugin` branch): the
// page of that plugin forwards it into its iframe, and nothing else keeps a copy.
import type { PluginEvent } from '@shared/protocol';

type Listener = (event: PluginEvent) => void;

const listeners = new Map<string, Set<Listener>>();

/** Hear what one plugin says, until the returned function is called. */
export function subscribePluginEvent(pluginId: string, listener: Listener): () => void {
  const set = listeners.get(pluginId) ?? new Set<Listener>();
  listeners.set(pluginId, set);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(pluginId);
  };
}

export function notifyPluginEvent(pluginId: string, event: PluginEvent) {
  // A copy: a listener may unsubscribe while the notification runs (its page unmounted).
  for (const listener of [...(listeners.get(pluginId) ?? [])]) listener(event);
}
