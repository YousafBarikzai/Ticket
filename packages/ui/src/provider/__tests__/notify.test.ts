import { describe, expect, it } from 'vitest';
import { notify, subscribeToNotifications, type NotifyEvent } from '../notify.js';

/*
 * The queue between `notify()` and the lazily mounted `Toaster`. The toaster
 * often arrives after the first toast is raised, so nothing may be lost in
 * between — and with no toaster at all, the queue must not grow without bound.
 */

function collect(): { events: NotifyEvent[]; stop: () => void } {
  const events: NotifyEvent[] = [];
  const stop = subscribeToNotifications((event) => events.push(event));
  return { events, stop };
}

describe('notify', () => {
  it('holds toasts raised before the toaster subscribes and replays them in order', () => {
    const first = notify('Rule published', { tone: 'success' });
    const second = notify('Draft saved');
    const { events, stop } = collect();
    stop();
    expect(events.map((event) => event.id)).toEqual([first, second]);
    expect(events[0]).toMatchObject({ type: 'show', message: 'Rule published', options: { tone: 'success' } });
  });

  it('keeps a caller’s id so a second toast replaces the first', () => {
    const { events, stop } = collect();
    expect(notify('Saving…', { id: 'save' })).toBe('save');
    notify.dismiss('save');
    stop();
    expect(events).toEqual([
      { type: 'show', id: 'save', message: 'Saving…', options: { id: 'save' } },
      { type: 'dismiss', id: 'save' },
    ]);
  });

  it('passes progress and promises through with their ids', async () => {
    const { events, stop } = collect();
    const id = notify.promise(Promise.resolve(3), { loading: 'Updating…', success: (n) => `${n} updated`, error: 'Failed' });
    notify.progress('bulk', { label: 'Updating tickets', done: 1, total: 4 });
    stop();
    expect(events.map((event) => [event.type, event.id])).toEqual([
      ['promise', id],
      ['progress', 'bulk'],
    ]);
  });

  it('bounds the queue while no toaster is mounted', () => {
    for (let index = 0; index < 50; index++) notify(`Toast ${index}`);
    const { events, stop } = collect();
    stop();
    expect(events.length).toBeLessThanOrEqual(20);
    // The newest survive: they are the ones still relevant when a toaster arrives.
    expect(events.at(-1)).toMatchObject({ message: 'Toast 49' });
  });

  it('stops delivering after unsubscribing', () => {
    const { events, stop } = collect();
    stop();
    notify('After');
    expect(events).toEqual([]);
    // Drain it, so later tests start from an empty queue.
    collect().stop();
  });
});
