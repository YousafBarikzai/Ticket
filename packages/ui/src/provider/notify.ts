'use client';

/**
 * `notify()` — toasts for the results of a person's own actions.
 *
 * A module-level queue rather than a hook, so any event handler can call it
 * without a provider in reach, and so calling it never pulls the toast library
 * into a page: the `Toaster` (in `@itsm/ui/overlays`) is mounted lazily by
 * `ItsmProvider` — on the first `notify()` or when the browser is idle —
 * subscribes here, and replays whatever was queued before it arrived. Server
 * events never come through here; they belong to the notification centre.
 *
 * The contract with the `Toaster` is `subscribeToNotifications` and the
 * `NotifyEvent` union. Everything a toast needs is in the event, already
 * normalised: a `danger` toast is persistent unless the caller said otherwise
 * ("errors persist", SPEC §4.3), so the Toaster does not re-derive the rule.
 */

export type NotifyTone = 'neutral' | 'success' | 'info' | 'warning' | 'danger';

export interface NotifyOptions {
  readonly description?: string;
  readonly tone?: NotifyTone;
  readonly action?: { readonly label: string; onClick(): void };
  /** Adds "Undo" for 8 seconds, also reachable with mod+Z while the toast is showing. */
  readonly undo?: () => Promise<void>;
  /** Milliseconds, or `persistent`. A `danger` toast is persistent unless this says otherwise. */
  readonly duration?: number | 'persistent';
  /** Replaces a live toast with the same id instead of stacking a second one. */
  readonly id?: string;
  /** Epoch milliseconds before which Retry stays disabled, for a 429: "Try again in 20 s". */
  readonly retryAt?: number;
}

export interface NotifyPromiseMessages<T> {
  readonly loading: string;
  readonly success: string | ((value: T) => string);
  readonly error: string | ((error: unknown) => string);
}

/** A long bulk job's progress, shown in one toast with Cancel (X-51). */
export interface NotifyProgress {
  readonly label: string;
  readonly done: number;
  readonly total: number;
  readonly onCancel?: () => void;
}

export type NotifyEvent =
  | { readonly type: 'show'; readonly id: string; readonly message: string; readonly options: NotifyOptions }
  | {
      readonly type: 'promise';
      readonly id: string;
      readonly promise: Promise<unknown>;
      readonly messages: NotifyPromiseMessages<unknown>;
    }
  | { readonly type: 'progress'; readonly id: string; readonly progress: NotifyProgress }
  /** `id` absent: dismiss every toast. */
  | { readonly type: 'dismiss'; readonly id?: string };

export interface Notify {
  /** Shows a toast and returns its id. */
  (message: string, options?: NotifyOptions): string;
  promise<T>(promise: Promise<T>, messages: NotifyPromiseMessages<T>): string;
  progress(id: string, progress: NotifyProgress): string;
  /** Dismisses one toast, or every toast when called without an id. */
  dismiss(id?: string): void;
}

type Listener = (event: NotifyEvent) => void;

/** Held until a `Toaster` subscribes; a page's first toast often comes before the toaster has loaded. */
const pending: NotifyEvent[] = [];
const MAX_PENDING = 20;
let listener: Listener | null = null;
let counter = 0;
const demandWatchers = new Set<() => void>();

function emit(event: NotifyEvent): void {
  if (listener) {
    listener(event);
    return;
  }
  pending.push(event);
  // Bounded: with no toaster ever mounted (a test, a page without the
  // provider), the queue must not grow for the life of the tab.
  if (pending.length > MAX_PENDING) pending.shift();
  for (const watcher of [...demandWatchers]) watcher();
}

function nextId(): string {
  counter += 1;
  return `itsm-notify-${counter}`;
}

function show(message: string, options: NotifyOptions = {}): string {
  const id = options.id ?? nextId();
  const normalised: NotifyOptions =
    options.tone === 'danger' && options.duration === undefined ? { ...options, duration: 'persistent' } : options;
  emit({ type: 'show', id, message, options: normalised });
  return id;
}

export const notify: Notify = Object.assign(show, {
  promise<T>(promise: Promise<T>, messages: NotifyPromiseMessages<T>): string {
    const id = nextId();
    emit({ type: 'promise', id, promise, messages: messages as NotifyPromiseMessages<unknown> });
    return id;
  },
  progress(id: string, progress: NotifyProgress): string {
    emit({ type: 'progress', id, progress });
    return id;
  },
  dismiss(id?: string): void {
    // Nothing to dismiss before a toaster has shown anything: drop the queued
    // toast instead of replaying a show and its dismissal back to back.
    if (!listener) {
      for (let index = pending.length - 1; index >= 0; index--) {
        const event = pending[index]!;
        if (id === undefined || ('id' in event && event.id === id)) pending.splice(index, 1);
      }
      return;
    }
    emit(id === undefined ? { type: 'dismiss' } : { type: 'dismiss', id });
  },
});

/**
 * Connects the one `Toaster` to the queue and replays what was waiting.
 * Returns the unsubscribe. A second subscriber replaces the first: two
 * toasters would show every toast twice.
 */
export function subscribeToNotifications(next: Listener): () => void {
  listener = next;
  for (const event of pending.splice(0)) next(event);
  return () => {
    if (listener === next) listener = null;
  };
}

/**
 * Calls `watcher` whenever a toast is queued with no toaster to show it — at
 * once if one is already waiting. `ItsmProvider` uses it to mount the
 * `Toaster` the moment it is first needed rather than on every page load.
 */
export function watchNotificationDemand(watcher: () => void): () => void {
  demandWatchers.add(watcher);
  if (pending.length > 0 && !listener) watcher();
  return () => {
    demandWatchers.delete(watcher);
  };
}

/** Empties the queue and forgets the toaster. Tests use it between cases; applications never need it. */
export function resetNotifications(): void {
  pending.splice(0);
  listener = null;
  demandWatchers.clear();
}
