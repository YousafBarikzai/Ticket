import { describe, expect, it, vi } from 'vitest';
import { applyUpdate, watchForUpdate, type ContainerLike, type RegistrationLike, type WorkerLike } from '../update.js';

/**
 * "A new version is ready · Reload" (SPEC §6.2, F19).
 *
 * The worker no longer takes over the moment it installs; the page offers the
 * reload and the person chooses when. These are the page's rules for that:
 * when to offer it, and how to switch without loading the page through the
 * old worker.
 */

class Emitter {
  readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
}

class FakeWorker extends Emitter implements WorkerLike {
  readonly messages: unknown[] = [];
  constructor(public state: string) {
    super();
  }
  postMessage(message: unknown): void {
    this.messages.push(message);
  }
  become(state: string): void {
    this.state = state;
    this.emit('statechange');
  }
}

class FakeRegistration extends Emitter implements RegistrationLike {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
}

class FakeContainer extends Emitter implements ContainerLike {
  constructor(public controller: unknown) {
    super();
  }
}

describe('when to offer the reload', () => {
  it('offers it for a worker already waiting from an earlier visit', () => {
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker('installed');
    const ready = vi.fn();
    watchForUpdate(registration, new FakeContainer({}), ready);
    expect(ready).toHaveBeenCalledWith(registration.waiting);
  });

  it('offers it once a new worker finishes installing', () => {
    const registration = new FakeRegistration();
    const ready = vi.fn();
    watchForUpdate(registration, new FakeContainer({}), ready);

    const next = new FakeWorker('installing');
    registration.installing = next;
    registration.emit('updatefound');
    expect(ready).not.toHaveBeenCalled();

    registration.waiting = next;
    next.become('installed');
    expect(ready).toHaveBeenCalledWith(next);
  });

  it('never offers it on a first visit, when there is nothing to replace', () => {
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker('installed');
    const ready = vi.fn();
    watchForUpdate(registration, new FakeContainer(null), ready);
    expect(ready).not.toHaveBeenCalled();
  });

  it('stops watching when asked', () => {
    const registration = new FakeRegistration();
    const ready = vi.fn();
    const stop = watchForUpdate(registration, new FakeContainer({}), ready);
    const next = new FakeWorker('installing');
    registration.installing = next;
    registration.emit('updatefound');
    stop();

    registration.waiting = next;
    next.become('installed');
    expect(ready).not.toHaveBeenCalled();
  });
});

describe('switching', () => {
  it('asks the waiting worker to take over, and reloads only once it has', () => {
    const worker = new FakeWorker('installed');
    const container = new FakeContainer({});
    const reload = vi.fn();

    applyUpdate(worker, container, reload);
    expect(worker.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    // Reloading now would load the page through the old worker's rules.
    expect(reload).not.toHaveBeenCalled();

    container.emit('controllerchange');
    container.emit('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads at once when another tab has already switched', () => {
    const worker = new FakeWorker('activated');
    const reload = vi.fn();
    applyUpdate(worker, new FakeContainer({}), reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(worker.messages).toEqual([]);
  });
});
