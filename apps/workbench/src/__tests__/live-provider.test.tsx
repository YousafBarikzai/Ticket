// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { LiveProvider, useChangeStream, useLive, useLiveState, type ChangeNotice } from '@itsm/pwa/live';
import { cleanupDocument, render } from './support/render.js';

/**
 * The live layer as the apps mount it: a `LiveProvider` in the frame and
 * listeners anywhere beneath it (SPEC D16, F18).
 *
 * Here rather than in `packages/pwa` because this is where a DOM renderer is
 * a dependency; the package's own tests cover the hub's rules without one.
 * What these add is the React half: that everything under one provider
 * shares one `EventSource`, that the original `useChangeStream` joins it
 * rather than opening its own, and that the connection's state reaches the
 * screen.
 */

class FakeEventSource {
  static readonly CLOSED = 2;
  static opened: FakeEventSource[] = [];
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  readyState = 0;
  onerror: ((event: unknown) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.opened.push(this);
  }

  addEventListener(name: string, handler: (event: unknown) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), handler]);
  }

  emit(name: string, data: unknown): void {
    for (const handler of this.listeners.get(name) ?? []) handler({ data: JSON.stringify(data) });
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  get topics(): string[] {
    return new URL(this.url, 'http://x.test').searchParams.get('topics')?.split(',') ?? [];
  }
}

const opened = () => FakeEventSource.opened;
const stillOpen = () => FakeEventSource.opened.filter((source) => !source.closed);

beforeEach(() => {
  FakeEventSource.opened = [];
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 502 })),
  );
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Listener({ entity, heard }: { entity: string; heard: ChangeNotice[] }) {
  useLive({ entity, onNotice: (notice) => heard.push(notice) });
  return null;
}

function Legacy({ topics, heard }: { topics: string[]; heard: ChangeNotice[] }) {
  useChangeStream({ topics, onNotice: (notice) => heard.push(notice) });
  return null;
}

function State() {
  const { state } = useLiveState();
  return <output data-state={state}>{state}</output>;
}

const stateShown = () => document.querySelector('output')?.getAttribute('data-state');

describe('one stream under one provider', () => {
  it('shares one EventSource between every listener, the original hook included', () => {
    const tickets: ChangeNotice[] = [];
    const bell: ChangeNotice[] = [];
    const legacy: ChangeNotice[] = [];
    render(
      <LiveProvider topics={['group:g-1']}>
        <Listener entity="ticket" heard={tickets} />
        <Listener entity="notification" heard={bell} />
        <Legacy topics={['ticket:t-9']} heard={legacy} />
      </LiveProvider>,
    );

    expect(opened()).toHaveLength(1);
    // The listeners subscribed before the provider opened it, so the first
    // stream already asks for their topics.
    expect(opened()[0]!.topics).toEqual(['group:g-1', 'ticket:t-9']);
  });

  it('hands each listener only what it asked for', () => {
    const tickets: ChangeNotice[] = [];
    const bell: ChangeNotice[] = [];
    render(
      <LiveProvider>
        <Listener entity="ticket" heard={tickets} />
        <Listener entity="notification" heard={bell} />
      </LiveProvider>,
    );

    act(() => {
      opened()[0]!.emit('change', { entity: 'ticket', id: 't-1', action: 'updated', at: 'now' });
      opened()[0]!.emit('change', { entity: 'notification', id: 'n-1', action: 'created', at: 'now' });
    });
    expect(tickets.map((notice) => notice.id)).toEqual(['t-1']);
    expect(bell.map((notice) => notice.id)).toEqual(['n-1']);
  });

  it('keeps the stream across a re-render with the same topics, and follows a real change', () => {
    const rendered = render(<LiveProvider topics={['group:g-1']} />);
    act(() => rendered.root.render(<LiveProvider topics={['group:g-1']} />));
    act(() => void vi.advanceTimersByTime(5_000));
    expect(opened()).toHaveLength(1);

    act(() => rendered.root.render(<LiveProvider topics={['group:g-1', 'group:g-2']} />));
    act(() => void vi.advanceTimersByTime(1_000));
    expect(opened()).toHaveLength(2);
    expect(opened()[1]!.topics).toEqual(['group:g-1', 'group:g-2']);
    expect(stillOpen()).toHaveLength(1);
  });

  it('closes the stream when the provider goes', () => {
    const rendered = render(<LiveProvider />);
    rendered.unmount();
    expect(stillOpen()).toHaveLength(0);
  });

  it('opens nothing when switched off', () => {
    render(<LiveProvider enabled={false} />);
    expect(opened()).toHaveLength(0);
  });
});

describe('the state the screen sees', () => {
  it('is live — nothing to show — outside a provider, with nothing opened', () => {
    render(<State />);
    expect(stateShown()).toBe('live');
    expect(opened()).toHaveLength(0);
  });

  it('reads “ended” once the stream is refused with a 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    render(
      <LiveProvider>
        <State />
      </LiveProvider>,
    );
    const source = opened()[0]!;
    act(() => source.emit('ready', { topics: 1 }));
    expect(stateShown()).toBe('live');

    await act(async () => {
      source.readyState = 2;
      source.onerror?.({});
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(stateShown()).toBe('ended');
  });

  it('reads “reconnecting” once a drop outlasts the grace period, and live again after', async () => {
    render(
      <LiveProvider>
        <State />
      </LiveProvider>,
    );
    const source = opened()[0]!;
    act(() => source.emit('ready', { topics: 1 }));

    await act(async () => {
      source.readyState = 2;
      source.onerror?.({});
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(stateShown()).toBe('reconnecting');

    // The retry opened a new stream; its `ready` is the connection back.
    const retried = opened().at(-1)!;
    expect(retried).not.toBe(source);
    act(() => retried.emit('ready', { topics: 1 }));
    expect(stateShown()).toBe('live');
  });
});
