// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_LIST,
  applyServer,
  dropMoved,
  isUnread,
  listSearch,
  markSeen,
  movedLabel,
  reconcileLive,
  registerTicketPrefetch,
  viewRefFromKey,
  type ListRow,
} from '../inbox/queries.js';
import { inboxViewFrom } from '../inbox/views.js';
import {
  JO,
  ME,
  FakeEventSource,
  apiTicket,
  fakeFetch,
  key,
  links,
  mountList,
  noIdle,
  page,
  pointerDown,
  row,
  rowElements,
  titles,
} from './support/inbox.js';
import { cleanupDocument, click } from './support/render.js';

const notify = vi.fn();
vi.mock('@itsm/ui', async (original) => ({
  ...(await original<typeof import('@itsm/ui')>()),
  notify: (...args: unknown[]) => notify(...args),
}));

/**
 * The inbox list (SPEC §6.2): how a row reads, the keyboard path through it,
 * what a click does, changing tickets from the list, and every state a view
 * can be in — plus the plain rules underneath (how a refresh folds in, what
 * counts as unread).
 */

const NOW = Date.parse('2026-09-30T10:00:00.000Z');
const minutes = (count: number) => new Date(NOW + count * 60_000).toISOString();

async function settle(times = 3): Promise<void> {
  for (let index = 0; index < times; index++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function toolbar(): HTMLElement | null {
  return document.querySelector('[role="toolbar"]');
}

function button(text: string, scope: ParentNode = document): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

let wire: ReturnType<typeof fakeFetch>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  FakeEventSource.opened = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  noIdle();
  notify.mockClear();
  wire = fakeFetch();
  vi.stubGlobal('fetch', wire.fetch);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a row', () => {
  it('reads as one name and one description, with its three controls side by side (X-62, X-67)', () => {
    mountList({
      rows: [row({ number: 'INC-000123', title: 'VPN keeps dropping', priority: 'P2', dueAt: minutes(130), updatedAt: minutes(-5) })],
      props: { renderedAt: NOW },
    });
    const [item] = rowElements();
    const link = item!.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/tickets/INC-000123');
    expect(link.getAttribute('aria-label')).toBe('VPN keeps dropping, INC-000123');
    expect(document.getElementById(link.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Priority 2, In progress, due in 2 h 10 min, updated 5 min ago',
    );
    // Checkbox, link and ⋯ are siblings; nothing interactive sits inside the link.
    expect(item!.querySelector('input[type="checkbox"]')?.getAttribute('aria-label') ?? item!.querySelector('label')?.textContent).toContain('Select INC-000123');
    expect(item!.querySelector('button[aria-label="More actions for INC-000123"]')).not.toBeNull();
    expect(link.querySelector('a, button, input, select, textarea')).toBeNull();
    // Line two: number · requester · state · P2.
    expect(item!.querySelector('.app-TicketRow__meta')?.textContent).toBe('INC-000123Ada LovelaceIn progressP2');
  });

  it('shows the deadline only when it is within the hour or passed, and the priority only for P1 and P2', () => {
    mountList({
      rows: [
        row({ number: 'INC-1', priority: 'P1', dueAt: minutes(30) }),
        row({ number: 'INC-2', dueAt: minutes(-20) }),
        row({ number: 'INC-3', dueAt: minutes(300) }),
        row({ number: 'INC-4', status: 'pending_requester', statusCategory: 'paused', dueAt: minutes(-90) }),
      ],
      props: { renderedAt: NOW },
    });
    const [soon, breached, later, waiting] = rowElements();
    expect(soon!.querySelector('.app-TicketRow__due')?.textContent).toBe('Due in 30 min');
    expect(soon!.querySelector('.app-TicketRow__due')?.getAttribute('data-urgency')).toBe('soon');
    expect(soon!.querySelector('.app-TicketRow__priority')?.textContent).toBe('P1');
    expect(breached!.querySelector('.app-TicketRow__due')?.textContent).toBe('Overdue by 20 min');
    expect(breached!.getAttribute('data-urgency')).toBe('breached');
    // Not close: the updated time, and no priority glyph for P3.
    expect(later!.querySelector('.app-TicketRow__due')).toBeNull();
    expect(later!.querySelector('time')).not.toBeNull();
    expect(later!.querySelector('.app-TicketRow__priority')).toBeNull();
    // Waiting: the clock is paused, so no deadline; the state is a pill.
    expect(waiting!.querySelector('.app-TicketRow__due')).toBeNull();
    expect(waiting!.querySelector('.app-TicketRow__pill')?.textContent).toContain('Waiting on requester');
  });

  it('marks the ticket open beside the list as current', () => {
    mountList({ rows: [row({ number: 'INC-1' }), row({ number: 'INC-2' })], props: { selected: 'INC-2' } });
    expect(links().map((link) => link.getAttribute('aria-current'))).toEqual([null, 'true']);
    expect(rowElements()[1]!.hasAttribute('data-current')).toBe(true);
  });

  it('leaves the assignee off in My work, and names the team where tickets span teams', () => {
    mountList({ view: 'mine', rows: [row({ number: 'INC-1', assigneeId: ME, groupId: 'team-a' })], props: { teamNames: { 'team-a': 'Network' } } });
    expect(document.querySelector('.app-TicketRow__avatar')).toBeNull();
    expect(document.querySelector('.app-TicketRow__team')).toBeNull();
    cleanupDocument();
    mountList({ view: 'all', rows: [row({ number: 'INC-2', assigneeId: JO, groupId: 'team-a' })], props: { teamNames: { 'team-a': 'Network' } } });
    expect(document.querySelector('.app-TicketRow__avatar')?.textContent).toBe('J');
    expect(document.querySelector('.app-TicketRow__team')?.textContent).toBe('Network');
  });
});

describe('the keyboard (SPEC §5.6)', () => {
  const three = () => [row({ number: 'INC-1' }), row({ number: 'INC-2' }), row({ number: 'INC-3' })];

  it('is one tab stop; j and k move it, and the ticket beside the list follows', () => {
    const { onFollow } = mountList({ rows: three() });
    const focusable = [...document.querySelectorAll('.app-TicketRow [tabindex="0"]')];
    expect(focusable).toEqual([links()[0]]);
    act(() => links()[0]!.focus());
    key(links()[0]!, 'j');
    expect(document.activeElement).toBe(links()[1]);
    expect(onFollow).toHaveBeenLastCalledWith(expect.objectContaining({ number: 'INC-2' }));
    key(links()[1]!, 'ArrowDown');
    key(links()[2]!, 'k');
    expect(document.activeElement).toBe(links()[1]);
    expect(onFollow).toHaveBeenCalledTimes(3);
  });

  it('warms the tickets either side of the current row, and one the pointer rests on', async () => {
    const warmed: string[] = [];
    const stop = registerTicketPrefetch((_client, number) => warmed.push(number));
    try {
      mountList({ rows: [...three(), row({ number: 'INC-4' })] });
      act(() => links()[0]!.focus());
      key(links()[0]!, 'j');
      expect(warmed).toEqual(['INC-1', 'INC-3']);
      // React hears enter and leave through pointerover and pointerout.
      act(() => void rowElements()[3]!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
      expect(warmed).toHaveLength(2);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      expect(warmed.at(-1)).toBe('INC-4');
      // A pointer passing over is not intent.
      act(() => void rowElements()[2]!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: rowElements()[3]! })));
      act(() => void rowElements()[2]!.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      expect(warmed.at(-1)).toBe('INC-4');
    } finally {
      stop();
    }
  });

  it('opens beside the list with Enter, as a page with o, in a new tab with mod+Enter', () => {
    const { onOpen } = mountList({ rows: three() });
    act(() => links()[0]!.focus());
    key(links()[0]!, 'Enter');
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ number: 'INC-1' }), 'pane');
    key(links()[0]!, 'o');
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ number: 'INC-1' }), 'page');
    key(links()[0]!, 'Enter', { ctrlKey: true });
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ number: 'INC-1' }), 'newTab');
  });

  it('selects with x, says how many in the bulk bar, and clears with Escape', () => {
    mountList({ rows: three() });
    act(() => links()[0]!.focus());
    key(links()[0]!, 'x');
    expect(toolbar()?.getAttribute('aria-label')).toBe('Bulk actions for 1 selected ticket');
    expect(document.querySelector('.app-TicketList')?.hasAttribute('data-selecting')).toBe(true);
    key(links()[0]!, 'j', { shiftKey: true });
    expect(toolbar()?.getAttribute('aria-label')).toBe('Bulk actions for 2 selected tickets');
    key(document.activeElement!, 'Escape');
    expect(toolbar()).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it('selects everything loaded with mod+A, and offers Undo when Escape clears more than three', () => {
    mountList({ rows: [...three(), row({ number: 'INC-4' }), row({ number: 'INC-5' })] });
    act(() => links()[0]!.focus());
    key(links()[0]!, 'a', { ctrlKey: true });
    expect(toolbar()?.getAttribute('aria-label')).toBe('Bulk actions for 5 selected tickets');
    key(links()[0]!, 'Escape');
    expect(toolbar()).toBeNull();
    expect(notify).toHaveBeenCalledWith('Selection cleared', expect.objectContaining({ undo: expect.any(Function) }));
  });

  it('opens the row’s menu with ".", and gives focus back to the row when it closes (X-63)', async () => {
    mountList({ rows: three() });
    act(() => links()[1]!.focus());
    key(links()[1]!, '.');
    await settle();
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu.getAttribute('aria-label')).toBe('Actions for INC-2');
    const labels = [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent ?? '');
    for (const label of ['Open', 'Open full page', 'Open in new tab', 'Copy link', 'Assign to me', 'Status', 'Priority']) {
      expect(labels.some((text) => text.startsWith(label))).toBe(true);
    }
    key(document.activeElement ?? menu, 'Escape');
    await settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(links()[1]);
  });

  it('assigns the focused ticket to you with i, carrying the version it was read at', async () => {
    const first = row({ number: 'INC-1', version: 7 });
    wire = fakeFetch(
      (call) => (call.url.endsWith('/tickets/INC-1/assign') ? { body: apiTicket(first, { assigneeId: ME, version: 8 }) } : undefined),
      (call) => (call.url.startsWith('/api/desk/list') ? { body: page([{ ...first, assigneeId: ME, version: 8 }]) } : undefined),
    );
    vi.stubGlobal('fetch', wire.fetch);
    mountList({ rows: [first] });
    act(() => links()[0]!.focus());
    key(links()[0]!, 'i');
    await settle();
    const assign = wire.calls.find((call) => call.url === '/api/proxy/api/v1/tickets/INC-1/assign')!;
    expect(assign.method).toBe('POST');
    expect(assign.body).toEqual({ assigneeId: ME, method: 'manual' });
    expect(assign.headers['if-match']).toBe('"7"');
    expect(notify).toHaveBeenCalledWith('INC-1 assigned to you', expect.objectContaining({ tone: 'success' }));
  });
});

describe('a click', () => {
  it('opens beside the list when there is room, and leaves a modified click to the browser', () => {
    const { onOpen } = mountList({ rows: [row({ number: 'INC-1' })], props: { paneVisible: () => true } });
    const link = links()[0]!;
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => void link.dispatchEvent(plain));
    expect(plain.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ number: 'INC-1' }), 'select');

    onOpen.mockClear();
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true });
    act(() => void link.dispatchEvent(modified));
    expect(modified.defaultPrevented).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('follows the link when the list is alone on screen (a phone)', () => {
    const { onOpen } = mountList({ rows: [row({ number: 'INC-1' })], props: { paneVisible: () => false } });
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => void links()[0]!.dispatchEvent(plain));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('changing tickets from the list', () => {
  it('moves the selection four at a time, with each version, and reports what happened', async () => {
    const rows = Array.from({ length: 6 }, (_, index) => row({ number: `INC-${index + 1}`, status: 'in_progress', version: index + 1 }));
    wire = fakeFetch(
      (call) => {
        const match = /\/tickets\/(INC-\d+)\/transitions$/.exec(call.url);
        if (!match) return undefined;
        if (match[1] === 'INC-4') return { status: 409, body: { type: 'about:blank', title: 'Conflict', status: 409 } };
        const source = rows.find((candidate) => candidate.number === match[1])!;
        return { body: apiTicket(source, { status: 'resolved', statusCategory: 'resolved' }) };
      },
      (call) => (call.url.startsWith('/api/desk/list') ? { body: page(rows) } : undefined),
    );
    vi.stubGlobal('fetch', wire.fetch);
    mountList({ rows });
    act(() => links()[0]!.focus());
    key(links()[0]!, 'a', { ctrlKey: true });

    pointerDown(button('Status', toolbar()!));
    await settle();
    const resolved = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === 'Resolved')!;
    click(resolved);
    await settle(6);

    const writes = wire.calls.filter((call) => call.url.endsWith('/transitions'));
    expect(writes.map((call) => call.url.split('/').at(-2))).toEqual(['INC-1', 'INC-2', 'INC-3', 'INC-4', 'INC-5', 'INC-6']);
    expect(writes.map((call) => call.headers['if-match'])).toEqual(['"1"', '"2"', '"3"', '"4"', '"5"', '"6"']);
    expect(writes.every((call) => (call.body as { to: string }).to === 'resolved')).toBe(true);
    expect(notify).toHaveBeenCalledWith('Updated 5 of 6 · 1 failed', expect.objectContaining({ tone: 'danger', action: expect.objectContaining({ label: 'Details' }) }));
    // The lists refresh: tickets move between views after a change.
    expect(wire.calls.some((call) => call.url.startsWith('/api/desk/list'))).toBe(true);
    // What failed stays selected, ready for another go.
    expect(toolbar()?.getAttribute('aria-label')).toBe('Bulk actions for 1 selected ticket');

    // Details: what did not go through and why, with Retry.
    const details = notify.mock.calls.at(-1)![1] as { action: { onClick(): void } };
    act(() => details.action.onClick());
    await settle();
    const sheet = document.querySelector('[role="dialog"]')!;
    expect(sheet.textContent).toContain('Didn’t go through');
    expect(sheet.textContent).toContain('INC-4');
    expect(sheet.textContent).toContain('Someone changed it since it loaded');
    click(button('Retry the failed ticket', sheet));
    await settle(6);
    expect(wire.calls.filter((call) => call.url.endsWith('/INC-4/transitions'))).toHaveLength(2);
  });

  it('offers only the moves every selected ticket can make, and none it cannot', async () => {
    mountList({ rows: [row({ number: 'INC-1', status: 'resolved', statusCategory: 'resolved' }), row({ number: 'INC-2', status: 'new' })] });
    act(() => links()[0]!.focus());
    key(links()[0]!, 'a', { ctrlKey: true });
    const status = button('Status', toolbar()!);
    expect(status.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(status.getAttribute('aria-describedby')!.split(' ')[0]!)?.textContent).toContain(
      'No status change suits all 2 selected tickets',
    );
  });

  it('hides the checkboxes and the bar from someone who can change nothing', () => {
    mountList({ rows: [row()], props: { can: { read: true, assign: false, transition: false, update: false, readPeople: false } } });
    expect(document.querySelector('.app-TicketRow input[type="checkbox"]')).toBeNull();
    act(() => links()[0]!.focus());
    key(links()[0]!, 'x');
    expect(toolbar()).toBeNull();
  });
});

describe('the states of a view (SPEC §6.2)', () => {
  it('My work, empty: says so and offers Unassigned', () => {
    mountList({ view: 'mine', rows: [] });
    expect(document.querySelector('.app-TicketList h2, .app-TicketList h3')?.textContent).toBe('Nothing assigned to you');
    expect(document.querySelector('a[href="/inbox/unassigned"]')?.textContent).toContain('Pick up from Unassigned');
  });

  it('Unassigned, empty: good news, with when it was checked', () => {
    mountList({ view: 'unassigned', rows: [] });
    const state = document.querySelector('.app-TicketList .itsm-EmptyState')!;
    expect(state.textContent).toContain('Every ticket has an owner');
    expect(state.textContent).toContain('Checked');
  });

  it('filtered and empty: "No tickets match", with Clear filters', () => {
    const { onClearFilters } = mountList({ view: 'all', params: { priority: 'P1' }, rows: [] });
    expect(document.querySelector('.app-TicketList')?.textContent).toContain('No tickets match');
    click(button('Clear filters'));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it('refused: says what is missing instead of an empty list', () => {
    mountList({ rows: [], unseeded: true, props: { problem: { status: 403 } } });
    expect(document.querySelector('.app-TicketList')?.textContent).toContain('Your account can’t read tickets');
    expect(wire.calls).toHaveLength(0);
  });

  it('failed on the server: explains, and Retry loads the list here', async () => {
    wire = fakeFetch((call) => (call.url.startsWith('/api/desk/list') ? { body: page([row({ number: 'INC-9' })]) } : undefined));
    vi.stubGlobal('fetch', wire.fetch);
    mountList({ rows: [], unseeded: true, props: { problem: { status: 503, retryable: true } } });
    expect(wire.calls).toHaveLength(0);
    click(button('Try again'));
    await settle();
    expect(wire.calls[0]!.url).toBe('/api/desk/list?view=all');
    expect(titles()).toEqual(['Ticket INC-9']);
  });

  it('loads the next page with the cursor, and says there is more without a total', async () => {
    const more = [row({ number: 'INC-3' }), row({ number: 'INC-4' })];
    wire = fakeFetch((call) => (call.url.includes('cursor=c2') ? { body: page(more) } : undefined));
    vi.stubGlobal('fetch', wire.fetch);
    mountList({ rows: [row({ number: 'INC-1' }), row({ number: 'INC-2' })], nextCursor: 'c2' });
    expect(document.querySelector('.itsm-LoadMore__status')?.textContent).toBe('Showing 2 · more available');
    click(button('Load 50 more'));
    await settle();
    expect(wire.calls[0]!.url).toBe('/api/desk/list?view=all&cursor=c2');
    expect(titles()).toEqual(['Ticket INC-1', 'Ticket INC-2', 'Ticket INC-3', 'Ticket INC-4']);
    expect(document.querySelector('.itsm-LoadMore__status')?.textContent).toBe('4 tickets');
  });

  it('keeps the list context for the ticket page’s ‹ › and way back', () => {
    mountList({ view: 'all', params: { priority: 'P2' }, rows: [row({ number: 'INC-1' }), row({ number: 'INC-2' })] });
    expect(JSON.parse(sessionStorage.getItem('itsm-wb-list-context')!)).toEqual({
      href: '/inbox/all?priority=P2',
      title: 'All open',
      numbers: ['INC-1', 'INC-2'],
    });
  });
});

/* ------------------------------------------------------------- The rules */

describe('folding a refresh into the list', () => {
  const a = row({ number: 'INC-A' });
  const b = row({ number: 'INC-B' });
  const c = row({ number: 'INC-C' });
  const shown = applyServer(EMPTY_LIST, [a, b, c]);

  it('updates a changed row where it is, and flashes it', () => {
    const next = reconcileLive(shown, [a, { ...b, title: 'Renamed', version: 2 }, c], false);
    expect(next.rows.map((entry) => entry.row.title)).toEqual([a.title, 'Renamed', c.title]);
    expect(next.changed).toEqual([b.id]);
    expect(next.held).toEqual([]);
  });

  it('keeps a row that left, still, and marked', () => {
    const next = reconcileLive(shown, [a, c], false);
    expect(next.rows.map((entry) => [entry.row.number, entry.moved === true])).toEqual([
      ['INC-A', false],
      ['INC-B', true],
      ['INC-C', false],
    ]);
    expect(dropMoved(next, b.id).rows.map((entry) => entry.row.number)).toEqual(['INC-A', 'INC-C']);
  });

  it('holds new rows back, and lets a page boundary spill quietly onto the end', () => {
    const d = row({ number: 'INC-D' });
    const e = row({ number: 'INC-E' });
    expect(reconcileLive(shown, [d, a, b, c], false).held).toEqual([d]);
    // With more to load, a row after the last one shown is the next page nudged up, not news.
    const spilled = reconcileLive(shown, [d, a, c, e], true);
    expect(spilled.held).toEqual([d]);
    expect(spilled.rows.map((entry) => entry.row.number)).toEqual(['INC-A', 'INC-B', 'INC-C', 'INC-E']);
  });

  it('shows the server’s order after an action, keeping only the rows that must not vanish', () => {
    const moved = reconcileLive(shown, [a, c], false);
    expect(applyServer(moved, [c, a]).rows.map((entry) => entry.row.number)).toEqual(['INC-C', 'INC-A']);
    expect(applyServer(moved, [c, a], new Set([b.id])).rows.map((entry) => [entry.row.number, entry.moved === true])).toEqual([
      ['INC-C', false],
      ['INC-B', true],
      ['INC-A', false],
    ]);
  });

  it('says why a row left, from what the ticket is now', () => {
    const before = row({ number: 'INC-1', assigneeId: null });
    const people = { [JO]: { name: 'Jo Bloggs', initials: 'JB' } };
    expect(movedLabel(before, apiTicket(before, { assigneeId: JO }), people, ME)).toBe('Now assigned to Jo Bloggs');
    expect(movedLabel(before, apiTicket(before, { assigneeId: ME }), people, ME)).toBe('Now assigned to you');
    expect(movedLabel(before, apiTicket(before, { status: 'resolved' }), people, ME)).toBe('Now resolved');
    expect(movedLabel(before, null, people, ME)).toBe('No longer available to you');
  });
});

describe('unread', () => {
  const record = { since: '2026-09-30T09:30:00.000Z', seen: {} };

  it('is work that is yours or unclaimed, changed since you last had it open here', () => {
    const changed = (overrides: Partial<ListRow>) => row({ updatedAt: '2026-09-30T09:45:00.000Z', ...overrides });
    expect(isUnread(changed({ assigneeId: ME }), record, ME)).toBe(true);
    expect(isUnread(changed({ assigneeId: null }), record, ME)).toBe(true);
    expect(isUnread(changed({ assigneeId: JO }), record, ME)).toBe(false);
    expect(isUnread(changed({ assigneeId: ME, statusCategory: 'resolved' }), record, ME)).toBe(false);
    expect(isUnread(row({ assigneeId: ME, updatedAt: '2026-09-30T09:00:00.000Z' }), record, ME)).toBe(false);
    // Nothing is unread before there is a record: the first visit is not a flood.
    expect(isUnread(changed({ assigneeId: ME }), null, ME)).toBe(false);
  });

  it('clears once seen, and comes back when the ticket changes again', () => {
    const ticket = row({ assigneeId: ME, updatedAt: '2026-09-30T09:45:00.000Z' });
    const seen = markSeen(record, [ticket]);
    expect(isUnread(ticket, seen, ME)).toBe(false);
    expect(markSeen(seen, [ticket])).toBe(seen);
    expect(isUnread({ ...ticket, updatedAt: '2026-09-30T09:50:00.000Z' }, seen, ME)).toBe(true);
  });
});

describe('a view’s query', () => {
  it('spells each filter one way, so one filter never caches twice', () => {
    const view = inboxViewFrom({ kind: 'view', id: 'all' }, { priority: 'P1', q: 'vpn', sort: '-createdAt', t: 'INC-000001', cursor: 'zz' });
    // The default sort, the selection and the cursor are not part of what the list is.
    expect(listSearch(view)).toBe('view=all&q=vpn&priority=P1');
    const team = inboxViewFrom({ kind: 'team', teamId: 'B6C7D8E9-0000-4000-8000-000000000001' }, { sort: 'createdAt' });
    expect(listSearch(team)).toBe('view=team%3Ab6c7d8e9-0000-4000-8000-000000000001&sort=createdAt');
  });

  it('reads a view back from its key, refusing anything else', () => {
    expect(viewRefFromKey('mine')).toEqual({ kind: 'view', id: 'mine' });
    expect(viewRefFromKey('team:b6c7d8e9-0000-4000-8000-000000000001')).toEqual({ kind: 'team', teamId: 'b6c7d8e9-0000-4000-8000-000000000001' });
    expect(viewRefFromKey('team:../../etc')).toBeNull();
    expect(viewRefFromKey('everything')).toBeNull();
    expect(viewRefFromKey(null)).toBeNull();
  });
});
