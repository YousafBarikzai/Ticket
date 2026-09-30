// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListRow } from '../inbox/queries.js';
import { listKey } from '../inbox/queries.js';
import { ANNOUNCE_INTERVAL_MS, FLASH_MS, LIVE_SETTLE_MS } from '../inbox/TicketList.js';
import { FakeEventSource, JO, apiTicket, fakeFetch, links, mountList, noIdle, page, row, rowElements, stream, titles } from './support/inbox.js';
import { cleanupDocument, click } from './support/render.js';

const notify = vi.fn();
vi.mock('@itsm/ui', async (original) => ({
  ...(await original<typeof import('@itsm/ui')>()),
  notify: (...args: unknown[]) => notify(...args),
}));

/**
 * A list that keeps itself current without moving under the person
 * (SPEC §4.10 "Live updates", §6.2) — the successor of `queue-live.test`.
 *
 * The list sits inside the frame's `LiveProvider` and a query cache, as on
 * the page. A notice about a ticket (debounced 1 s) invalidates the view's
 * query; what the refetch brings is folded in: changed rows update in place
 * and flash, rows that left stay still with a label, and new rows wait
 * behind "N new · Show". The live region `[data-live="inbox"]` says "N new
 * tickets" at most once in five seconds, and nothing when nothing changed.
 */

const NOW = Date.parse('2026-09-30T10:00:00.000Z');

function region(): string {
  return document.querySelector('[data-live="inbox"]')?.textContent ?? '';
}

function pill(): HTMLButtonElement | null {
  return document.querySelector('.app-TicketList__newButton');
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function notice(id: string, version?: number, entity = 'ticket'): void {
  act(() => stream().emit('change', { entity, id, action: 'updated', at: new Date().toISOString(), ...(version === undefined ? {} : { version }) }));
}

/** The server's answer to the next refresh of the list. */
let server: ListRow[] = [];
let wire: ReturnType<typeof fakeFetch>;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  FakeEventSource.opened = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  noIdle();
  notify.mockClear();
  wire = fakeFetch(
    (call) => (call.url.startsWith('/api/desk/list') ? { body: page(server) } : undefined),
    (call) => {
      const match = /\/api\/proxy\/api\/v1\/tickets\/(INC-\d+)$/.exec(call.url);
      return match ? { body: apiTicket(row({ number: match[1] }), { assigneeId: JO }) } : undefined;
    },
  );
  vi.stubGlobal('fetch', wire.fetch);
  localStorage.clear();
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const a = () => row({ number: 'INC-1', id: 'id-1', title: 'Printer jammed' });
const b = () => row({ number: 'INC-2', id: 'id-2', title: 'VPN keeps dropping' });
const c = () => row({ number: 'INC-3', id: 'id-3', title: 'New starter needs a laptop' });

describe('a list that watches', () => {
  it('invalidates the view query after a ticket notice — once for a burst', async () => {
    server = [a(), b()];
    const { client, view } = mountList({ rows: [a(), b()] });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    for (let index = 0; index < 20; index += 1) notice(`t-${index}`);
    await advance(LIVE_SETTLE_MS - 1);
    expect(invalidate).not.toHaveBeenCalled();
    await advance(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: listKey(view) });
  });

  it('ignores its own echo — a version it already shows — and notices about other things', async () => {
    const { client } = mountList({ rows: [row({ number: 'INC-1', id: 'id-1', version: 4 })] });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    notice('id-1', 4);
    notice('job-1', 1, 'ai_job');
    await advance(LIVE_SETTLE_MS * 2);
    expect(invalidate).not.toHaveBeenCalled();
    notice('id-1', 5);
    await advance(LIVE_SETTLE_MS);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('refetches after a reconnection, because the gap may have held anything', async () => {
    const { client } = mountList({ rows: [a()] });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    act(() => stream().emit('ready', { topics: 2 }));
    act(() => stream().emit('ready', { topics: 2 }));
    await advance(LIVE_SETTLE_MS);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

describe('new tickets', () => {
  it('wait behind "N new · Show", and the live region says "N new tickets"', async () => {
    mountList({ rows: [a(), b()] });
    expect(document.querySelector('[data-live="inbox"]')?.getAttribute('aria-live')).toBe('polite');
    expect(region()).toBe('');

    server = [c(), a(), b()];
    notice('id-3', 1);
    await advance(LIVE_SETTLE_MS);
    await advance(10);
    expect(titles()).toEqual(['Printer jammed', 'VPN keeps dropping']);
    expect(pill()?.textContent).toBe('1 new · Show');
    expect(region()).toBe('1 new ticket');

    click(pill()!);
    await advance(20);
    expect(titles()).toEqual(['New starter needs a laptop', 'Printer jammed', 'VPN keeps dropping']);
    expect(pill()).toBeNull();
    expect(document.activeElement).toBe(links()[0]);
  });

  it('says nothing when a refresh changed nothing', async () => {
    server = [a(), b()];
    const { client } = mountList({ rows: [a(), b()] });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    notice('id-9');
    await advance(LIVE_SETTLE_MS);
    await advance(10);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(wire.calls.filter((call) => call.url.startsWith('/api/desk/list'))).toHaveLength(1);
    expect(pill()).toBeNull();
    expect(region()).toBe('');
    expect(rowElements().some((element) => element.hasAttribute('data-flash'))).toBe(false);
  });

  it('announces at most once in five seconds, and the newest count when the window closes', async () => {
    const d = () => row({ number: 'INC-4', id: 'id-4', title: 'Monitor flickers' });
    mountList({ rows: [a()] });
    server = [b(), a()];
    notice('id-2', 1);
    await advance(LIVE_SETTLE_MS + 10);
    expect(region()).toBe('1 new ticket');

    server = [b(), c(), a()];
    notice('id-3', 1);
    await advance(LIVE_SETTLE_MS + 10);
    expect(pill()?.textContent).toBe('2 new · Show');
    expect(region()).toBe('1 new ticket');

    server = [d(), b(), c(), a()];
    notice('id-4', 1);
    await advance(LIVE_SETTLE_MS + 10);
    expect(region()).toBe('1 new ticket');

    await advance(ANNOUNCE_INTERVAL_MS);
    expect(region()).toBe('3 new tickets');
  });

  it('stays quiet when the person has turned live announcements off', async () => {
    localStorage.setItem('itsm-prefs', JSON.stringify({ announceLive: 'off' }));
    mountList({ rows: [a()] });
    server = [b(), a()];
    notice('id-2', 1);
    await advance(LIVE_SETTLE_MS + 10);
    expect(pill()?.textContent).toBe('1 new · Show');
    expect(region()).toBe('');
  });
});

describe('rows that change or leave', () => {
  it('update in place with a brief highlight, and nothing moves', async () => {
    mountList({ rows: [a(), b(), c()] });
    server = [a(), { ...b(), title: 'VPN drops every hour', version: 2 }, c()];
    notice('id-2', 2);
    await advance(LIVE_SETTLE_MS + 10);
    expect(titles()).toEqual(['Printer jammed', 'VPN drops every hour', 'New starter needs a laptop']);
    expect(rowElements().map((element) => element.hasAttribute('data-flash'))).toEqual([false, true, false]);
    await advance(FLASH_MS);
    expect(rowElements().some((element) => element.hasAttribute('data-flash'))).toBe(false);
  });

  it('stay where they were, still, saying what happened — never taken from under the focus', async () => {
    mountList({ rows: [a(), b(), c()] });
    act(() => links()[1]!.focus());
    server = [a(), c()];
    notice('id-2', 2);
    await advance(LIVE_SETTLE_MS + 10);
    await advance(10);
    expect(titles()).toEqual(['Printer jammed', 'VPN keeps dropping', 'New starter needs a laptop']);
    const left = rowElements()[1]!;
    expect(left.hasAttribute('data-moved')).toBe(true);
    // What it is now, from the ticket itself: assigned to someone else.
    expect(left.querySelector('.app-TicketRow__moved')?.textContent).toBe('Now assigned to Jo Bloggs');
    expect(document.activeElement).toBe(links()[1]);

    // The person acts (loads the new state by showing new rows): the focused row still stays.
    server = [row({ number: 'INC-5', id: 'id-5' }), a(), c()];
    notice('id-5', 1);
    await advance(LIVE_SETTLE_MS + 10);
    click(pill()!);
    await advance(20);
    expect(titles()).toContain('VPN keeps dropping');
  });

  it('leave on the person’s next action when they are not in the way', async () => {
    mountList({ rows: [a(), b(), c()] });
    server = [a(), c()];
    notice('id-2', 2);
    await advance(LIVE_SETTLE_MS + 10);
    expect(rowElements()[1]!.hasAttribute('data-moved')).toBe(true);

    server = [row({ number: 'INC-5', id: 'id-5', title: 'Wi-Fi down on floor 3' }), a(), c()];
    notice('id-5', 1);
    await advance(LIVE_SETTLE_MS + 10);
    click(pill()!);
    await advance(20);
    expect(titles()).toEqual(['Wi-Fi down on floor 3', 'Printer jammed', 'New starter needs a laptop']);
  });

  it('never drops the ticket open beside the list', async () => {
    mountList({ rows: [a(), b()], props: { selected: 'INC-2' } });
    server = [a()];
    notice('id-2', 2);
    await advance(LIVE_SETTLE_MS + 10);
    server = [row({ number: 'INC-6', id: 'id-6' }), a()];
    notice('id-6', 1);
    await advance(LIVE_SETTLE_MS + 10);
    click(pill()!);
    await advance(20);
    expect(titles()).toContain('VPN keeps dropping');
    expect(links().find((link) => link.getAttribute('aria-current') === 'true')?.getAttribute('href')).toBe('/tickets/INC-2');
  });
});
