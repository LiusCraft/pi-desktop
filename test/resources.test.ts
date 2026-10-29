// The renderer's side of the host's `changed` events: a view of host-owned data reads it again when the
// host says it changed, and only while the view is mounted.
import { describe, expect, it } from 'vitest';
import { notifyResource, subscribeResource } from '../src/renderer/src/store/resources';

describe('host resource subscriptions', () => {
  it('tells every view of a resource, and leaves the other resources alone', () => {
    const seen: string[] = [];
    const offList = subscribeResource('artifacts', () => seen.push('list'));
    const offRecent = subscribeResource('artifacts', () => seen.push('recent'));
    const offModels = subscribeResource('models', () => seen.push('models'));

    notifyResource('artifacts');
    expect(seen).toEqual(['list', 'recent']);

    notifyResource('models');
    expect(seen).toEqual(['list', 'recent', 'models']);

    for (const off of [offList, offRecent, offModels]) off();
  });

  it('stops telling a view once it unsubscribes', () => {
    let calls = 0;
    const off = subscribeResource('customize', () => void (calls += 1));
    notifyResource('customize');
    off();
    notifyResource('customize');
    expect(calls).toBe(1);
  });

  it('lets a view unsubscribe while the notification runs, without skipping the others', () => {
    const seen: string[] = [];
    const offFirst = subscribeResource('activity', () => {
      seen.push('first');
      offFirst();
    });
    const offSecond = subscribeResource('activity', () => seen.push('second'));
    notifyResource('activity');
    expect(seen).toEqual(['first', 'second']);
    offSecond();
  });

  it('does nothing when no view shows the resource', () => {
    expect(() => notifyResource('tasks')).not.toThrow();
  });
});
