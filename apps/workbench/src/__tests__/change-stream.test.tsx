// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanupDocument, render } from './support/render.js';

/**
 * Watching for change.
 *
 * `EventSource` does not exist in jsdom, so it is stood up here — which is
 * fortunate, because the properties worth testing are all about what the hook
 * does around the connection rather than what travels through it: that it
 * opens one stream and not one per render, that a reconnection is treated as a
 * gap rather than as a fresh start, and that a browser without `EventSource`
 * gets a page that works rather than a page that throws.
 */

interface Opened {
  readonly url: string;
  readonly listeners: Map<string, ((event: unknown) => void)[]>;
  closed: boolean;
  emit(name: string, data: unknown): void;
}

const opened: Opened[] = [];

class FakeEventSource {
  static readonly CLOSED = 2;
  static readonly OPEN = 1;
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  readyState = 1;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    opened.push(this as unknown as Opened);
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
}

let useChangeStream: typeof import('../client/useChangeStream.js').useChangeStream;

beforeEach(async () => {
  opened.length = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
  ({ useChangeStream } = await import('../client/useChangeStream.js'));
});

afterEach(() => {
  cleanupDocument();
  vi.unstubAllGlobals();
});

function Watcher({
  topics,
  onNotice,
  onReconnect,
}: {
  topics: string[];
  onNotice: (notice: unknown) => void;
  onReconnect?: () => void;
}) {
  useChangeStream({ topics, onNotice, ...(onReconnect ? { onReconnect } : {}) });
  return <p>watching</p>;
}

describe('opening the stream', () => {
  it('asks for the topics it was given, through the proxy', () => {
    render(<Watcher topics={['group:g-1', 'ticket:t-9']} onNotice={() => undefined} />);
    expect(opened).toHaveLength(1);
    // Through /api/proxy, never the API's own origin: the browser holds a
    // cookie and no token.
    expect(opened[0]!.url).toContain('/api/proxy/api/v1/events/stream?topics=');
    expect(decodeURIComponent(opened[0]!.url)).toContain('group:g-1,ticket:t-9');
  });

  it('sorts the topics, so the same set in another order is the same stream', () => {
    render(<Watcher topics={['ticket:t-9', 'group:g-1']} onNotice={() => undefined} />);
    expect(decodeURIComponent(opened[0]!.url)).toContain('group:g-1,ticket:t-9');
  });

  it('opens nothing at all when there is nothing to watch', () => {
    render(<Watcher topics={[]} onNotice={() => undefined} />);
    expect(opened).toHaveLength(0);
  });

  it('does nothing where EventSource does not exist, rather than throwing', () => {
    vi.stubGlobal('EventSource', undefined);
    // The page still renders. Nothing here is load-bearing for correctness:
    // every screen using it refetches on its own actions regardless.
    const { container } = render(<Watcher topics={['group:g-1']} onNotice={() => undefined} />);
    expect(container.textContent).toContain('watching');
    expect(opened).toHaveLength(0);
  });
});

describe('what arrives on it', () => {
  it('hands a change notice to the caller', () => {
    const notices: unknown[] = [];
    render(<Watcher topics={['ticket:t-9']} onNotice={(notice) => notices.push(notice)} />);

    act(() => opened[0]!.emit('change', { entity: 'ticket', id: 't-9', version: 4, action: 'updated' }));
    expect(notices).toEqual([{ entity: 'ticket', id: 't-9', version: 4, action: 'updated' }]);
  });

  it('ignores a notice it cannot parse rather than breaking the page', () => {
    const notices: unknown[] = [];
    render(<Watcher topics={['ticket:t-9']} onNotice={(notice) => notices.push(notice)} />);

    const source = opened[0]!;
    act(() => {
      for (const handler of source.listeners.get('change') ?? []) handler({ data: 'not json' });
    });
    expect(notices).toEqual([]);
  });

  it('treats the second ready as a reconnection, because the gap is invisible', () => {
    const reconnects: number[] = [];
    render(
      <Watcher topics={['ticket:t-9']} onNotice={() => undefined} onReconnect={() => reconnects.push(1)} />,
    );

    // The first `ready` is this connection opening.
    act(() => opened[0]!.emit('ready', { topics: 1 }));
    expect(reconnects).toHaveLength(0);

    // The second means it dropped and came back, and the page has missed
    // whatever happened in between.
    act(() => opened[0]!.emit('ready', { topics: 1 }));
    expect(reconnects).toHaveLength(1);
  });
});

describe('not churning the connection', () => {
  it('keeps one stream across a re-render with a new array of the same topics', () => {
    const rendered = render(<Watcher topics={['group:g-1']} onNotice={() => undefined} />);
    act(() => {
      rendered.root.render(<Watcher topics={['group:g-1']} onNotice={() => undefined} />);
    });
    // A new array each render would otherwise be a reconnect per keystroke on
    // any page with state.
    expect(opened).toHaveLength(1);
    expect(opened[0]!.closed).toBe(false);
  });

  it('opens a new stream when the topics genuinely change', () => {
    const rendered = render(<Watcher topics={['group:g-1']} onNotice={() => undefined} />);
    act(() => {
      rendered.root.render(<Watcher topics={['group:g-2']} onNotice={() => undefined} />);
    });
    expect(opened).toHaveLength(2);
    expect(opened[0]!.closed).toBe(true);
  });
});
