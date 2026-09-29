/**
 * The live layer's engine: one `EventSource` for the whole page.
 *
 * The API has published change notices on `GET /api/v1/events/stream` since
 * Phase 1 (ADR-0015). What the applications did with it was open one stream
 * per component that wanted one — a list, a suggestion panel — and let each
 * die quietly: an `EventSource` that meets a 401 or a 502 closes for good, and
 * nothing on the screen said the list had stopped being live. This is the
 * replacement, framework-free so its rules are testable without a renderer;
 * `LiveProvider` and the hooks are a thin React skin over it.
 *
 * **One stream, many listeners.** Everybody on the page subscribes here with
 * the topics they need; the hub asks for the union (at most twenty, which is
 * what the API will subscribe) and fans each notice out to whoever wants it.
 * A notice is a nudge, never data — `{entity, id, version, action}` — and
 * whatever a listener does with it, it does by refetching through the API,
 * which applies the same permissions it always did.
 *
 * **The connection says how it is.** `live`, `reconnecting`, `offline` or
 * `ended`, for the connection pill. A drop is retried with backoff (1, 2, 5,
 * 10, then every 30 seconds) while the machine is online; a stream the browser
 * closed is diagnosed with one plain request to the same URL, because
 * `EventSource` hides the status code — and a 401 there means the session has
 * ended, which no amount of retrying fixes. A brief blip does not flash the
 * pill: `reconnecting` is reported only once the stream has been down for a
 * couple of seconds.
 *
 * **A gap is a gap.** An `EventSource` cannot say what it missed while it was
 * away, so after any drop every listener's `onReconnect` fires and the screen
 * refetches. A screen that is stale and looks live is worse than one that
 * reloads a little more often than it needed to.
 *
 * **Joining is debounced.** A topic added or removed (the ticket in the
 * reading pane, while an AI job runs) reopens the stream once the set has
 * been stable for a second, so `j`/`k` through a list is one reconnect, not
 * one per row. Only the listeners whose topics joined are told to resync:
 * the reopen leaves a gap of one round trip for everybody else, and a whole
 * inbox refetching every time somebody opens a ticket is a worse trade than
 * a notice in that window arriving with the next one.
 */

export type LiveState = 'live' | 'reconnecting' | 'offline' | 'ended';

export interface ChangeNotice {
  readonly entity: string;
  readonly id: string;
  readonly version?: number;
  readonly action: string;
  readonly at: string;
}

export interface LiveSubscriber {
  /** `ticket:<id>`, `group:<id>`. The person's own `user:` topic is always included by the API. */
  readonly topics?: readonly string[];
  /** Which notices this listener wants; every one when absent. */
  readonly accepts?: (notice: ChangeNotice) => boolean;
  readonly onNotice: (notice: ChangeNotice) => void;
  /**
   * Notices may have been missed: the stream dropped and came back, or this
   * listener's topics have just joined a stream that was already open.
   */
  readonly onReconnect?: () => void;
}

/** The members of `EventSource` this uses; a fake in the tests. */
export interface EventSourceLike {
  readonly readyState: number;
  onerror: ((event: unknown) => void) | null;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  close(): void;
}

export type EventSourceConstructor = new (url: string) => EventSourceLike;

/**
 * The page around the stream: whether the machine reports a network, and the
 * moments worth trying again. `navigator.onLine` decides only *when* to try —
 * never whether the stream works; the stream saying `ready` is what does.
 */
export interface LiveEnvironment {
  online(): boolean;
  listen(handlers: { online(): void; offline(): void; visible(): void }): () => void;
}

export interface LiveHubOptions {
  /** The page's own topics — the person's groups, say. */
  readonly topics?: readonly string[];
  /** Defaults to the proxy's stream, `/api/proxy/api/v1/events/stream`. */
  readonly path?: string;
  readonly EventSource?: EventSourceConstructor;
  readonly fetch?: typeof fetch;
  readonly environment?: LiveEnvironment;
  /** How long the topic set must be stable before the stream reopens. Default 1 s. */
  readonly settleMs?: number;
  /** How long a drop may last before it is reported. Default 2 s. */
  readonly graceMs?: number;
  readonly random?: () => number;
}

export interface LiveHub {
  start(): void;
  stop(): void;
  /** Replaces the page's own topics. */
  setTopics(topics: readonly string[]): void;
  /** Adds a listener; returns the function that removes it. */
  subscribe(subscriber: LiveSubscriber): () => void;
  /** Tries again now: the pill's Retry, or after signing in elsewhere. */
  readonly retry: () => void;
  readonly getState: () => LiveState;
  /** For `useSyncExternalStore`: calls `listener` whenever the state changes. */
  readonly onState: (listener: () => void) => () => void;
  /** The topics the stream currently asks for, sorted. */
  topics(): readonly string[];
}

export const STREAM_PATH = '/api/proxy/api/v1/events/stream';

/** The API subscribes the first twenty topics it is sent and ignores the rest. */
export const MAX_TOPICS = 20;

/** Delays before each retry of a dropped stream; the last one repeats. */
export const BACKOFF_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000];

/** `EventSource.CLOSED`, spelled out so this module needs no DOM at load. */
const CLOSED = 2;

/** Answers that mean "not these topics", as opposed to "not now". */
const REFUSED = new Set([400, 403, 404]);

/**
 * The topics to ask for: the page's own first, then each listener's in the
 * order they subscribed, without duplicates or refused ones, capped at
 * twenty. Sorted, so the same set is the same URL — and the same stream.
 */
export function mergeTopics(
  own: readonly string[],
  others: readonly (readonly string[])[],
  refused: ReadonlySet<string> = new Set(),
  max = MAX_TOPICS,
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  const consider = (topic: string, refusable: boolean): void => {
    const trimmed = topic.trim();
    if (!trimmed || seen.has(trimmed) || merged.length >= max) return;
    if (refusable && refused.has(trimmed)) return;
    seen.add(trimmed);
    merged.push(trimmed);
  };
  for (const topic of own) consider(topic, false);
  for (const list of others) for (const topic of list) consider(topic, true);
  return merged.sort();
}

/** Through the proxy, like every other call: the browser holds a cookie and no token. */
export function streamUrl(topics: readonly string[], path = STREAM_PATH): string {
  return topics.length === 0 ? path : `${path}?topics=${encodeURIComponent(topics.join(','))}`;
}

/**
 * The wait before retry number `attempt` (from 0), give or take a fifth, so
 * that every open tab does not come back at the same instant after a deploy.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = BACKOFF_MS[Math.min(Math.max(0, attempt), BACKOFF_MS.length - 1)]!;
  return Math.round(base * (0.8 + 0.4 * random()));
}

function sameTopics(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((topic, index) => topic === b[index]);
}

/** A notice worth handing on: an object naming an entity and an id. */
function parseNotice(data: unknown): ChangeNotice | null {
  try {
    const parsed = JSON.parse(String(data)) as Partial<ChangeNotice> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.entity !== 'string' || typeof parsed.id !== 'string') return null;
    return parsed as ChangeNotice;
  } catch {
    // A notice nobody can read is not worth a broken page. The next one, or
    // the next refetch, carries the same truth.
    return null;
  }
}

/**
 * One listener's mistake is its own. It is reported (thrown on a fresh
 * microtask, where the browser logs it) without stopping the notice reaching
 * everybody after it.
 */
function safely(call: (() => void) | undefined): void {
  if (!call) return;
  try {
    call();
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
  }
}

export function browserEnvironment(): LiveEnvironment {
  return {
    online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    listen(handlers) {
      if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
      const onVisibility = (): void => {
        if (document.visibilityState === 'visible') handlers.visible();
      };
      const onOnline = (): void => handlers.online();
      const onOffline = (): void => handlers.offline();
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      document.addEventListener('visibilitychange', onVisibility);
      return () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
        document.removeEventListener('visibilitychange', onVisibility);
      };
    },
  };
}

type Timer = ReturnType<typeof setTimeout>;

interface Entry {
  readonly subscriber: LiveSubscriber;
  readonly topics: readonly string[];
}

export function createLiveHub(options: LiveHubOptions = {}): LiveHub {
  const path = options.path ?? STREAM_PATH;
  const settleMs = options.settleMs ?? 1_000;
  const graceMs = options.graceMs ?? 2_000;
  const random = options.random ?? Math.random;

  let own: readonly string[] = [...(options.topics ?? [])];
  const entries = new Map<number, Entry>();
  let nextEntry = 0;
  /** Listener topics a stream was refused with; left out until nobody asks for them. */
  const refused = new Set<string>();

  let state: LiveState = 'live';
  const stateListeners = new Set<() => void>();

  let running = false;
  let environment: LiveEnvironment | null = null;
  let detach: (() => void) | null = null;
  let Source: EventSourceConstructor | undefined;

  let source: EventSourceLike | null = null;
  /** What the current (or last) stream asked for. */
  let requested: readonly string[] = [];
  /** `ready`s on the current stream: a second one means the browser reconnected it. */
  let readies = 0;
  /** Receiving right now: between a `ready` and the next error. */
  let healthy = false;
  /** The topics of the last stream that said `ready`; null until one has. */
  let live: ReadonlySet<string> | null = null;
  /** Notices may have been missed since `live` was last true. */
  let dropped = false;
  let attempt = 0;
  let probe: AbortController | null = null;

  let retryTimer: Timer | null = null;
  let settleTimer: Timer | null = null;
  let graceTimer: Timer | null = null;

  const clear = (timer: Timer | null): null => {
    if (timer !== null) clearTimeout(timer);
    return null;
  };

  function setState(next: LiveState): void {
    if (state === next) return;
    state = next;
    for (const listener of [...stateListeners]) listener();
  }

  function isOnline(): boolean {
    return environment?.online() ?? true;
  }

  function wanted(): string[] {
    return mergeTopics(
      own,
      [...entries.values()].map((entry) => entry.topics),
      refused,
    );
  }

  function close(): void {
    const current = source;
    source = null;
    healthy = false;
    if (current) {
      current.onerror = null;
      current.close();
    }
    probe?.abort();
    probe = null;
  }

  function open(): void {
    retryTimer = clear(retryTimer);
    settleTimer = clear(settleTimer);
    close();
    if (!running || !Source) return;

    requested = wanted();
    readies = 0;
    const current = new Source(streamUrl(requested, path));
    source = current;
    current.addEventListener('ready', () => {
      if (source === current) onReady();
    });
    current.addEventListener('change', (event) => {
      if (source === current) deliver((event as { data?: unknown }).data);
    });
    current.onerror = () => {
      if (source === current) onError(current);
    };
  }

  function onReady(): void {
    const previous = live;
    // A second `ready` on one stream is the browser having reconnected it by
    // itself; a first `ready` after a drop is ours having done so. Either
    // way there was a gap nobody can see into.
    const gap = readies > 0 || (previous !== null && dropped);
    readies += 1;
    healthy = true;
    dropped = false;
    attempt = 0;
    graceTimer = clear(graceTimer);
    const now = new Set(requested);
    live = now;
    setState('live');

    for (const entry of [...entries.values()]) {
      if (gap) safely(entry.subscriber.onReconnect);
      // Reopened on purpose to add topics: only the listeners whose topics
      // have just joined missed anything, and only since they subscribed.
      else if (previous && entry.topics.some((topic) => now.has(topic) && !previous.has(topic))) {
        safely(entry.subscriber.onReconnect);
      }
    }
  }

  function deliver(data: unknown): void {
    const notice = parseNotice(data);
    if (!notice) return;
    for (const entry of [...entries.values()]) {
      const { accepts, onNotice } = entry.subscriber;
      if (accepts && !accepts(notice)) continue;
      safely(() => onNotice(notice));
    }
  }

  /** The stream is not delivering. Say so, after the grace period. */
  function down(): void {
    healthy = false;
    if (live !== null) dropped = true;
    if (state === 'ended') return;
    if (!isOnline()) {
      graceTimer = clear(graceTimer);
      setState('offline');
      return;
    }
    if (state !== 'live' || graceTimer !== null) return;
    graceTimer = setTimeout(() => {
      graceTimer = null;
      if (running && !healthy && state === 'live') setState('reconnecting');
    }, graceMs);
  }

  function onError(current: EventSourceLike): void {
    if (current.readyState !== CLOSED) {
      // Merely interrupted: the browser is reconnecting it by itself, and the
      // next `ready` will count as the gap it was.
      down();
      return;
    }
    // Closed for good — the browser gives up on any answer but a 200 stream.
    close();
    down();
    // Offline, there is nothing to learn and nothing to retry until `online`.
    if (!isOnline()) return;
    void diagnose(requested);
  }

  /**
   * Why the browser gave up. `EventSource` never says, so one plain request
   * to the same URL does: 401 is a session that has ended; 400, 403 or 404 is
   * a topic the API will not subscribe; anything else, or no answer, is
   * worth another try.
   */
  async function diagnose(topics: readonly string[]): Promise<void> {
    const doFetch = options.fetch ?? (typeof fetch === 'undefined' ? undefined : fetch);
    if (!doFetch) {
      scheduleRetry();
      return;
    }
    const controller = new AbortController();
    probe = controller;
    let status: number | null = null;
    try {
      const response = await doFetch(streamUrl(topics, path), {
        headers: { accept: 'text/event-stream' },
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      status = response.status;
      void response.body?.cancel().catch(() => undefined);
    } catch {
      status = null;
    } finally {
      // A 200 here is a live stream; it has answered the question and is
      // not wanted as a second connection.
      controller.abort();
    }
    // Stopped, retried or reopened while it was asking: the answer is stale.
    if (probe !== controller) return;
    probe = null;
    if (!running) return;

    if (status === 401) {
      end();
      return;
    }
    if (status !== null && REFUSED.has(status)) refuse(topics);
    if (status === null && !isOnline()) {
      setState('offline');
      return;
    }
    scheduleRetry();
  }

  /**
   * A refused stream refuses every topic in it, and the API does not say
   * which. The page's own topics came from the server that knows who this
   * is; the listeners' came from whatever was on screen, so those are the
   * ones left out. Each comes back when its last listener goes.
   */
  function refuse(topics: readonly string[]): void {
    const mine = new Set(own);
    for (const topic of topics) if (!mine.has(topic)) refused.add(topic);
  }

  function scheduleRetry(): void {
    retryTimer = clear(retryTimer);
    const delay = reconnectDelay(attempt, random);
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, delay);
  }

  /** The session has ended. Retrying cannot help; signing in can. */
  function end(): void {
    close();
    retryTimer = clear(retryTimer);
    settleTimer = clear(settleTimer);
    graceTimer = clear(graceTimer);
    setState('ended');
  }

  function topicsChanged(): void {
    if (!running) return;
    const next = wanted();
    if (sameTopics(next, requested)) {
      settleTimer = clear(settleTimer);
      return;
    }
    // No stream to reopen — a retry is waiting, or the session ended — and
    // the next one opened asks for the new set anyway.
    if (!source) return;
    settleTimer = clear(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (!sameTopics(wanted(), requested)) open();
    }, settleMs);
  }

  const handlers = {
    online(): void {
      if (!running || state === 'ended') return;
      if (healthy) {
        setState('live');
        return;
      }
      setState('reconnecting');
      attempt = 0;
      open();
    },
    offline(): void {
      if (!running || state === 'ended') return;
      // The stream is left to fail by itself: the machine is sometimes wrong
      // about being offline, and a stream that still works is worth keeping.
      retryTimer = clear(retryTimer);
      graceTimer = clear(graceTimer);
      setState('offline');
    },
    visible(): void {
      if (!running || healthy) return;
      // The person is looking. Waiting out a backoff — or a session that
      // may have been renewed in another tab — is not worth their time.
      if (state === 'ended' || retryTimer !== null || (state === 'offline' && isOnline())) open();
    },
  };

  const hub: LiveHub = {
    start() {
      if (running) return;
      running = true;
      environment = options.environment ?? browserEnvironment();
      Source = options.EventSource ?? (globalThis as { EventSource?: EventSourceConstructor }).EventSource;
      // Where `EventSource` does not exist the page works exactly as it did:
      // refetching on its own actions. Nothing here is load-bearing.
      if (!Source) return;
      detach = environment.listen(handlers);
      // Restarted after a stop: whatever happened in between was missed.
      if (live !== null) dropped = true;
      if (!isOnline()) setState('offline');
      open();
    },

    stop() {
      if (!running) return;
      running = false;
      close();
      retryTimer = clear(retryTimer);
      settleTimer = clear(settleTimer);
      graceTimer = clear(graceTimer);
      detach?.();
      detach = null;
    },

    setTopics(topics) {
      own = [...topics];
      for (const topic of own) refused.delete(topic);
      topicsChanged();
    },

    subscribe(subscriber) {
      const id = nextEntry++;
      entries.set(id, { subscriber, topics: [...(subscriber.topics ?? [])] });
      topicsChanged();
      return () => {
        if (!entries.delete(id)) return;
        const stillWanted = new Set([...entries.values()].flatMap((entry) => entry.topics));
        for (const topic of [...refused]) if (!stillWanted.has(topic)) refused.delete(topic);
        topicsChanged();
      };
    },

    retry: () => {
      if (!running || !Source) return;
      attempt = 0;
      refused.clear();
      if (state === 'ended') setState('reconnecting');
      open();
    },

    getState: () => state,

    onState: (listener) => {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },

    topics: () => (source ? requested : wanted()),
  };
  return hub;
}
