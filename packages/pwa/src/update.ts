'use client';

import { useCallback, useEffect, useState } from 'react';
import { SKIP_WAITING } from './messages.js';

/**
 * "A new version is ready · Reload" — the page's half of the update flow.
 *
 * The worker no longer takes over the moment it installs (see `sw.ts`). It
 * waits, and the page offers the reload: the person finishes the sentence they
 * were typing, presses Reload, the page posts `SKIP_WAITING`, and reloads once
 * the new worker controls it. Nothing changes underneath an open reply.
 *
 * Written against the few members it uses rather than the DOM types, so the
 * rules can be tested with plain objects; a real registration and container
 * satisfy them as they are.
 */

export interface WorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: () => void): void;
  removeEventListener(type: 'statechange', listener: () => void): void;
}

export interface RegistrationLike {
  readonly waiting: WorkerLike | null;
  readonly installing: WorkerLike | null;
  addEventListener(type: 'updatefound', listener: () => void): void;
  removeEventListener(type: 'updatefound', listener: () => void): void;
}

export interface ContainerLike {
  readonly controller: unknown;
  addEventListener(type: 'controllerchange', listener: () => void): void;
  removeEventListener(type: 'controllerchange', listener: () => void): void;
}

/**
 * Calls `onReady` with the new worker once one has installed and is waiting.
 *
 * Only an *update* counts. With no worker controlling the page — the first
 * visit — the new one activates by itself and there is nothing to offer, so a
 * first-time visitor is never told to reload a page they have just opened.
 * Returns a function that stops watching.
 */
export function watchForUpdate(
  registration: RegistrationLike,
  container: ContainerLike,
  onReady: (worker: WorkerLike) => void,
): () => void {
  let stopped = false;
  const unwatch: (() => void)[] = [];

  const check = (): void => {
    if (!stopped && registration.waiting && container.controller) onReady(registration.waiting);
  };

  const onUpdateFound = (): void => {
    const installing = registration.installing;
    if (!installing) return;
    const onState = (): void => {
      if (installing.state !== 'installed') return;
      installing.removeEventListener('statechange', onState);
      check();
    };
    installing.addEventListener('statechange', onState);
    unwatch.push(() => installing.removeEventListener('statechange', onState));
  };

  registration.addEventListener('updatefound', onUpdateFound);
  // One may already be waiting: installed in an earlier visit, while another
  // tab kept the old one in charge.
  check();

  return () => {
    stopped = true;
    registration.removeEventListener('updatefound', onUpdateFound);
    for (const stop of unwatch) stop();
  };
}

/**
 * Hands the page to the waiting worker, then reloads.
 *
 * The reload waits for `controllerchange`: reloading first would fetch the
 * page through the *old* worker's rules, which is the one outcome the whole
 * flow exists to avoid. When another tab has already applied the update, the
 * worker is past waiting and no change will come, so it reloads at once.
 */
export function applyUpdate(
  worker: WorkerLike,
  container: ContainerLike,
  reload: () => void = () => window.location.reload(),
): void {
  if (worker.state === 'activating' || worker.state === 'activated' || container.controller === worker) {
    reload();
    return;
  }
  let done = false;
  const onChange = (): void => {
    if (done) return;
    done = true;
    container.removeEventListener('controllerchange', onChange);
    reload();
  };
  container.addEventListener('controllerchange', onChange);
  worker.postMessage({ type: SKIP_WAITING });
}

/**
 * The browser looks for a new worker when the page navigates. A workbench tab
 * left open all day does soft navigations only, so it would never hear of a
 * deploy; looking again when the person comes back to the tab — no more than
 * hourly — is what lets the prompt reach a desk that never closes it.
 */
const UPDATE_CHECK_MS = 60 * 60_000;

export interface ServiceWorkerUpdate {
  /** A new version has installed and is waiting for this page. */
  readonly ready: boolean;
  /** Switch to it and reload. For the toast's Reload button. */
  apply(): void;
}

export function useServiceWorkerUpdate(): ServiceWorkerUpdate {
  const [waiting, setWaiting] = useState<WorkerLike | null>(null);

  useEffect(() => {
    const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (!container) return;

    let cancelled = false;
    let stop: (() => void) | undefined;
    let registration: ServiceWorkerRegistration | undefined;
    let lastCheck = Date.now();

    void container
      .getRegistration()
      .then((found) => {
        if (cancelled || !found) return;
        registration = found;
        stop = watchForUpdate(found, container, (worker) => setWaiting(() => worker));
      })
      .catch(() => undefined);

    const onVisible = (): void => {
      if (document.visibilityState !== 'visible' || !registration) return;
      if (Date.now() - lastCheck < UPDATE_CHECK_MS) return;
      lastCheck = Date.now();
      void registration.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      stop?.();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const apply = useCallback(() => {
    const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (waiting && container) applyUpdate(waiting, container);
    else window.location.reload();
  }, [waiting]);

  return { ready: waiting !== null, apply };
}
