import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKOFF_MS,
  createLiveHub,
  mergeTopics,
  reconnectDelay,
  streamUrl,
  type ChangeNotice,
  type EventSourceLike,
  type LiveEnvironment,
  type LiveHub,
  type LiveHubOptions,
} from '../live/hub.js';

/**
 * The live layer's rules, without a browser.
 *
 * Every test here is something that went wrong, or would have, with one
 * `EventSource` per component: two streams for one page, a list that stopped
 * being live after a deploy and said nothing, a session that ended and a
 * stream that kept knocking, a reading pane that reconnected on every `j`.
 */

class FakeSource implements EventSourceLike {
  static opened: FakeSource[] = [];
  readyState = 0;
  onerror: ((event: unknown) => void) | null = null;
  closed = false;
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(readonly url: string) {
    FakeSource.opened.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  ready(): void {
    this.readyState = 1;
    this.emit('ready', { topics: 1 });
  }

  /** Interrupted: the browser is reconnecting it by itself. */
  drop(): void {
    this.readyState = 0;
    this.onerror?.({});
  }

  /** Closed for good: any answer but a 200 stream. */
  fail(): void {
    this.readyState = 2;
    this.onerror?.({});
  }

  get topics(): string[] {
    return new URL(this.url, 'http://x.test').searchParams.get('topics')?.split(',') ?? [];
  }
}

function open(): FakeSource[] {
  return FakeSource.opened.filter((source) => !source.closed);
}

function last(): FakeSource {
  return FakeSource.opened.at(-1)!;
}

interface FakeEnvironment extends LiveEnvironment {
  connected: boolean;
  fire(event: 'online' | 'offline' | 'visible'): void;
}

function environment(connected = true): FakeEnvironment {
  let handlers: { online(): void; offline(): void; visible(): void } | null = null;
  const fake: FakeEnvironment = {
    connected,
    online: () => fake.connected,
    listen(given) {
      handlers = given;
      return () => {
        handlers = null;
      };
    },
    fire(event) {
      if (event === 'online') fake.connected = true;
      if (event === 'offline') fake.connected = false;
      handlers?.[event]();
    },
  };
  return fake;
}

function answering(status: number) {
  return vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

let env: FakeEnvironment;

function hubWith(options: LiveHubOptions = {}): LiveHub {
  return createLiveHub({
    EventSource: FakeSource,
    environment: env,
    fetch: answering(502),
    random: () => 0.5,
    ...options,
  });
}

/** Lets a probe's promise settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  FakeSource.opened = [];
  env = environment();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the topics a stream asks for', () => {
  it('merges the page’s and every listener’s, once each, sorted', () => {
    expect(mergeTopics(['group:b', 'group:a'], [['ticket:1', 'group:a'], ['ticket:1']])).toEqual([
      'group:a',
      'group:b',
      'ticket:1',
    ]);
  });

  it('stops at twenty, keeping the page’s own first', () => {
    // The API subscribes the first twenty and ignores the rest; asking for
    // more is a topic that silently is not watched.
    const own = Array.from({ length: 19 }, (_, index) => `group:g${String(index).padStart(2, '0')}`);
    const merged = mergeTopics(own, [['ticket:a', 'ticket:b']]);
    expect(merged).toHaveLength(20);
    expect(merged).toEqual(expect.arrayContaining([...own, 'ticket:a']));
    expect(merged).not.toContain('ticket:b');
  });

  it('leaves out a refused listener topic, but never one of the page’s', () => {
    expect(mergeTopics(['group:a'], [['ticket:1', 'group:a']], new Set(['ticket:1', 'group:a']))).toEqual(['group:a']);
  });

  it('goes through the proxy, with no parameter when there is nothing extra', () => {
    // The person's own topic is added by the API: a portal page with no
    // topics still has a stream worth opening.
    expect(streamUrl([])).toBe('/api/proxy/api/v1/events/stream');
    expect(decodeURIComponent(streamUrl(['group:a', 'ticket:1']))).toBe(
      '/api/proxy/api/v1/events/stream?topics=group:a,ticket:1',
    );
  });
});

describe('one stream per page', () => {
  it('opens one EventSource for every listener, asking for all their topics', () => {
    const hub = hubWith({ topics: ['group:g-1'] });
    hub.subscribe({ topics: ['ticket:t-1'], onNotice: () => undefined });
    hub.subscribe({ onNotice: () => undefined });
    hub.start();

    expect(FakeSource.opened).toHaveLength(1);
    expect(last().topics).toEqual(['group:g-1', 'ticket:t-1']);
  });

  it('opens even with no topics, because the API always adds the person’s own', () => {
    hubWith().start();
    expect(last().url).toBe('/api/proxy/api/v1/events/stream');
  });

  it('hands each notice to the listeners that want it', () => {
    const hub = hubWith();
    const tickets: ChangeNotice[] = [];
    const bell: ChangeNotice[] = [];
    hub.subscribe({ accepts: (notice) => notice.entity === 'ticket', onNotice: (notice) => tickets.push(notice) });
    hub.subscribe({ accepts: (notice) => notice.entity === 'notification', onNotice: (notice) => bell.push(notice) });
    hub.start();

    last().emit('change', { entity: 'ticket', id: 't-1', action: 'updated', at: 'now' });
    last().emit('change', { entity: 'notification', id: 'n-1', action: 'created', at: 'now' });
    expect(tickets.map((notice) => notice.id)).toEqual(['t-1']);
    expect(bell.map((notice) => notice.id)).toEqual(['n-1']);
  });

  it('ignores a notice it cannot read rather than breaking the page', () => {
    const hub = hubWith();
    const heard: unknown[] = [];
    hub.subscribe({ onNotice: (notice) => heard.push(notice) });
    hub.start();

    last().emit('change', 'not json');
    last().emit('change', { entity: 'ticket' });
    expect(heard).toEqual([]);
  });

  it('does not let one listener’s mistake stop the next one hearing', () => {
    const reported: (() => void)[] = [];
    vi.stubGlobal('queueMicrotask', (task: () => void) => reported.push(task));
    try {
      const hub = hubWith();
      const heard: string[] = [];
      hub.subscribe({
        onNotice: () => {
          throw new Error('a broken listener');
        },
      });
      hub.subscribe({ onNotice: (notice) => heard.push(notice.id) });
      hub.start();

      last().emit('change', { entity: 'ticket', id: 't-1', action: 'updated', at: 'now' });
      expect(heard).toEqual(['t-1']);
      // Reported, not swallowed.
      expect(reported).toHaveLength(1);
      expect(() => reported[0]!()).toThrow('a broken listener');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('closes the stream and stops trying when stopped', async () => {
    const hub = hubWith();
    hub.start();
    last().fail();
    hub.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSource.opened).toHaveLength(1);
    expect(open()).toHaveLength(0);
  });

  it('does nothing where EventSource does not exist', () => {
    const hub = createLiveHub({ environment: env });
    vi.stubGlobal('EventSource', undefined);
    try {
      hub.start();
      expect(hub.getState()).toBe('live');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('topics joining and leaving', () => {
  it('reopens once the set has been stable for a second, not on every change', () => {
    const hub = hubWith({ topics: ['group:g-1'] });
    hub.start();
    last().ready();

    // j, j, j through a list: three reading-pane topics in quick succession.
    let leave = hub.subscribe({ topics: ['ticket:1'], onNotice: () => undefined });
    vi.advanceTimersByTime(300);
    leave();
    leave = hub.subscribe({ topics: ['ticket:2'], onNotice: () => undefined });
    vi.advanceTimersByTime(300);
    leave();
    hub.subscribe({ topics: ['ticket:3'], onNotice: () => undefined });

    vi.advanceTimersByTime(999);
    expect(FakeSource.opened).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSource.opened).toHaveLength(2);
    expect(FakeSource.opened[0]!.closed).toBe(true);
    expect(last().topics).toEqual(['group:g-1', 'ticket:3']);
    expect(open()).toHaveLength(1);
  });

  it('does not reopen when the set ends up where it started', () => {
    const hub = hubWith({ topics: ['group:g-1'] });
    hub.start();
    const leave = hub.subscribe({ topics: ['ticket:1'], onNotice: () => undefined });
    leave();
    vi.advanceTimersByTime(5_000);
    expect(FakeSource.opened).toHaveLength(1);
  });

  it('follows the page’s own topics changing', () => {
    const hub = hubWith({ topics: ['group:g-1'] });
    hub.start();
    hub.setTopics(['group:g-1', 'group:g-2']);
    vi.advanceTimersByTime(1_000);
    expect(last().topics).toEqual(['group:g-1', 'group:g-2']);
  });

  it('tells only the listener that joined to resync', () => {
    const hub = hubWith({ topics: ['group:g-1'] });
    const inbox = vi.fn();
    const pane = vi.fn();
    hub.subscribe({ onNotice: () => undefined, onReconnect: inbox });
    hub.start();
    last().ready();

    hub.subscribe({ topics: ['ticket:1'], onNotice: () => undefined, onReconnect: pane });
    vi.advanceTimersByTime(1_000);
    last().ready();

    // Its topic was not being watched between its own fetch and now.
    expect(pane).toHaveBeenCalledTimes(1);
    // The inbox's topics never left; refetching it for a reading pane is waste.
    expect(inbox).not.toHaveBeenCalled();
  });
});

describe('a gap in the stream', () => {
  it('is not reported on the first ready', () => {
    const hub = hubWith();
    const resync = vi.fn();
    hub.subscribe({ onNotice: () => undefined, onReconnect: resync });
    hub.start();
    last().ready();
    expect(resync).not.toHaveBeenCalled();
  });

  it('is reported to every listener when the browser reconnects the stream', () => {
    const hub = hubWith();
    const one = vi.fn();
    const two = vi.fn();
    hub.subscribe({ onNotice: () => undefined, onReconnect: one });
    hub.subscribe({ onNotice: () => undefined, onReconnect: two });
    hub.start();
    last().ready();
    last().drop();
    last().ready();
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
  });

  it('is reported when a stream it had to reopen comes back', async () => {
    const hub = hubWith();
    const resync = vi.fn();
    hub.subscribe({ onNotice: () => undefined, onReconnect: resync });
    hub.start();
    last().ready();
    last().fail();
    await settle();
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]!);
    last().ready();
    expect(resync).toHaveBeenCalledTimes(1);
  });
});

describe('how the connection is', () => {
  it('stays quiet through a blip, and says so once the drop lasts', () => {
    const hub = hubWith();
    hub.start();
    last().ready();

    last().drop();
    vi.advanceTimersByTime(1_999);
    expect(hub.getState()).toBe('live');
    vi.advanceTimersByTime(1);
    expect(hub.getState()).toBe('reconnecting');

    last().ready();
    expect(hub.getState()).toBe('live');
  });

  it('never shows a blip that heals inside the grace period', () => {
    const hub = hubWith();
    const changes = vi.fn();
    hub.onState(changes);
    hub.start();
    last().ready();
    last().drop();
    vi.advanceTimersByTime(500);
    last().ready();
    vi.advanceTimersByTime(5_000);
    expect(changes).not.toHaveBeenCalled();
  });

  it('retries a closed stream with backoff: 1, 2, 5, 10, then every 30 seconds', async () => {
    const hub = hubWith();
    hub.start();
    expect(reconnectDelay(0, () => 0.5)).toBe(1_000);

    for (const wait of [1_000, 2_000, 5_000, 10_000, 30_000, 30_000]) {
      const before = FakeSource.opened.length;
      last().fail();
      await settle();
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(FakeSource.opened).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeSource.opened).toHaveLength(before + 1);
    }
    expect(hub.getState()).toBe('reconnecting');
    expect(open()).toHaveLength(1);
  });

  it('starts the backoff again after a stream that worked', async () => {
    const hub = hubWith();
    hub.start();
    last().fail();
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    last().fail();
    await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    last().ready();

    last().fail();
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSource.opened).toHaveLength(4);
  });

  it('spreads retries out, so every tab does not return at once after a deploy', () => {
    expect(reconnectDelay(0, () => 0)).toBe(800);
    expect(reconnectDelay(0, () => 1)).toBe(1_200);
    expect(reconnectDelay(99, () => 0.5)).toBe(30_000);
  });

  it('ends after a 401, and stops knocking', async () => {
    // EventSource hides the status; one plain request to the same URL is how
    // the hub learns the session has gone.
    const probe = answering(401);
    const hub = hubWith({ fetch: probe, topics: ['group:g-1'] });
    hub.start();
    last().ready();
    last().fail();
    await settle();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(String(probe.mock.calls[0]![0])).toBe(last().url);
    expect(hub.getState()).toBe('ended');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(FakeSource.opened).toHaveLength(1);
    expect(open()).toHaveLength(0);
  });

  it('tries again from ended when the person comes back to the tab', async () => {
    // They may have signed in again in another tab; the cookie is shared.
    const hub = hubWith({ fetch: answering(401) });
    hub.start();
    last().fail();
    await settle();
    expect(hub.getState()).toBe('ended');

    env.fire('visible');
    expect(FakeSource.opened).toHaveLength(2);
    // Still ended until the stream says otherwise: no flicker.
    expect(hub.getState()).toBe('ended');
    last().ready();
    expect(hub.getState()).toBe('live');
  });

  it('tries again from ended when asked to', async () => {
    const hub = hubWith({ fetch: answering(401) });
    hub.start();
    last().fail();
    await settle();
    hub.retry();
    expect(hub.getState()).toBe('reconnecting');
    expect(FakeSource.opened).toHaveLength(2);
  });

  it('is offline while the machine is, and does not retry into nothing', async () => {
    const probe = answering(502);
    const hub = hubWith({ fetch: probe });
    hub.start();
    last().ready();

    env.fire('offline');
    expect(hub.getState()).toBe('offline');
    last().fail();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probe).not.toHaveBeenCalled();
    expect(FakeSource.opened).toHaveLength(1);

    // Back: straight away, not after a backoff.
    env.fire('online');
    expect(hub.getState()).toBe('reconnecting');
    expect(FakeSource.opened).toHaveLength(2);
    last().ready();
    expect(hub.getState()).toBe('live');
  });

  it('keeps a stream that still works when the machine only thinks it is offline', () => {
    const hub = hubWith();
    hub.start();
    last().ready();
    env.fire('offline');
    env.fire('online');
    expect(hub.getState()).toBe('live');
    expect(FakeSource.opened).toHaveLength(1);
  });

  it('starts offline when the machine is, and lets the stream prove otherwise', () => {
    env = environment(false);
    const hub = hubWith();
    hub.start();
    expect(hub.getState()).toBe('offline');
    expect(FakeSource.opened).toHaveLength(1);
    last().ready();
    expect(hub.getState()).toBe('live');
  });

  it('leaves out a listener’s refused topics, and keeps the page’s', async () => {
    const hub = hubWith({ fetch: answering(403), topics: ['group:g-1'] });
    hub.subscribe({ topics: ['ticket:gone'], onNotice: () => undefined });
    hub.start();
    expect(last().topics).toEqual(['group:g-1', 'ticket:gone']);

    last().fail();
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(last().topics).toEqual(['group:g-1']);
  });

  it('asks for a refused topic again once its listener has gone and another asks', async () => {
    const hub = hubWith({ fetch: answering(404) });
    const leave = hub.subscribe({ topics: ['ticket:1'], onNotice: () => undefined });
    hub.start();
    last().fail();
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    last().ready();
    expect(last().topics).toEqual([]);

    leave();
    hub.subscribe({ topics: ['ticket:1'], onNotice: () => undefined });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(last().topics).toEqual(['ticket:1']);
  });

  it('tells a state listener about each change, and can stop', () => {
    const hub = hubWith();
    const heard = vi.fn();
    const stop = hub.onState(heard);
    hub.start();
    env.fire('offline');
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    env.fire('online');
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
