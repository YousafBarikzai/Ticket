// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { Ticket } from '@itsm/sdk';
import { cleanupDocument, render } from './support/render.js';

/**
 * A queue that updates itself.
 *
 * The property that matters is not "it refreshes" — it is that a burst of
 * changes is one refresh. A rule that touches twenty tickets, a bulk update or
 * an import all arrive as twenty notices in a second, and a queue that
 * re-rendered twenty times would flicker under somebody's cursor while they
 * were trying to read row four.
 */

const refresh = vi.fn();
const sources: { emit(name: string, data: unknown): void }[] = [];

class FakeEventSource {
  static readonly CLOSED = 2;
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  readyState = 1;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    sources.push(this);
  }
  addEventListener(name: string, handler: (event: unknown) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), handler]);
  }
  emit(name: string, data: unknown): void {
    for (const handler of this.listeners.get(name) ?? []) handler({ data: JSON.stringify(data) });
  }
  close(): void {
    this.readyState = 2;
  }
}

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { QueueTable } = await import('../components/QueueTable.js');

const TICKET = {
  id: 't-1',
  number: 'INC-1',
  type: 'incident',
  title: 'VPN will not connect',
  status: 'new',
  statusCategory: 'open',
  priority: 'P3',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as Ticket;

beforeEach(() => {
  refresh.mockClear();
  sources.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanupDocument();
});

function mount(watch: string[]) {
  return render(
    <QueueTable
      tickets={[TICKET]}
      caption="All open — 1 ticket"
      emptyTitle="Nothing here"
      emptyDescription="No open ticket matches this view."
      watch={watch}
    />,
  );
}

describe('a queue that watches', () => {
  it('opens no stream when it was given no topics', () => {
    mount([]);
    expect(sources).toHaveLength(0);
  });

  it('refreshes when a ticket changes', () => {
    mount(['group:g-1']);
    act(() => sources[0]!.emit('change', { entity: 'ticket', id: 't-2', action: 'created' }));

    // Not yet: the refresh settles first.
    expect(refresh).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst into one refresh', () => {
    mount(['group:g-1']);
    act(() => {
      for (let i = 0; i < 20; i += 1) {
        sources[0]!.emit('change', { entity: 'ticket', id: `t-${i}`, action: 'updated' });
      }
    });
    act(() => void vi.advanceTimersByTime(1_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('ignores a notice about something that is not a ticket', () => {
    mount(['group:g-1']);
    act(() => sources[0]!.emit('change', { entity: 'ai_job', id: 'j-1', action: 'completed' }));
    act(() => void vi.advanceTimersByTime(2_000));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('says so out loud, politely, when it has refreshed', () => {
    mount(['group:g-1']);
    const status = document.querySelector('[role="status"]');
    // Present before it has anything to say: a live region added at the moment
    // of its first message is a message most screen readers never announce.
    expect(status).not.toBeNull();
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toBe('');

    act(() => sources[0]!.emit('change', { entity: 'ticket', id: 't-2', action: 'created' }));
    act(() => void vi.advanceTimersByTime(1_000));
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Queue updated at');
  });

  it('refreshes after a reconnection, because the gap may have held anything', () => {
    mount(['group:g-1']);
    act(() => sources[0]!.emit('ready', { topics: 2 }));
    act(() => sources[0]!.emit('ready', { topics: 2 }));
    act(() => void vi.advanceTimersByTime(1_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
