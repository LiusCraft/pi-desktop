// The renderer's side of the host's `changed` events: one bus per host-owned resource, so every view showing
// that resource reads it again when the host changes it. Views subscribe where they already load their data;
// nothing keeps a second copy that the host would have to remember to update.
import type { HostResource } from '@shared/protocol';

type Load = () => void;

const loads = new Map<HostResource, Set<Load>>();

/** Read this resource again whenever the host says it changed; returns the unsubscribe. */
export function subscribeResource(resource: HostResource, load: Load): () => void {
  const set = loads.get(resource) ?? new Set<Load>();
  loads.set(resource, set);
  set.add(load);
  return () => {
    set.delete(load);
    if (!set.size) loads.delete(resource);
  };
}

/** The host changed this resource: every view of it reads it again. A view that is not mounted is not told. */
export function notifyResource(resource: HostResource) {
  // A copy: a load may unsubscribe (the view unmounted while the request was in flight).
  for (const load of [...(loads.get(resource) ?? [])]) load();
}
