import { describe, expect, it, vi } from 'vitest';
import { STATES } from '@itsm/module-ticket';
import { ApiError, type Page, type Ticket, type TicketCount, type TicketFilter } from '@itsm/sdk';
import { countViews, PROBE_LIMIT, teamIdsFrom } from '../inbox/counts.js';
import { ALLOWED_TRANSITIONS, transitionsFrom } from '../queue/transitions.js';
import * as legacyView from '../queue/view.js';
import {
  VIEWS,
  clearedHref,
  countBadge,
  deskNavModel,
  deskTopics,
  inboxHref,
  inboxLanding,
  inboxViewFrom,
  lastViewValue,
  queueRedirectTarget,
  viewRefFromLastView,
  viewRefFromPath,
  type SearchParams,
  type ViewId,
  type ViewRef,
} from '../inbox/views.js';

const PERSON = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const TEAM = '9b2c1a40-1111-4a2b-8c3d-0123456789ab';

const view = (id: ViewId, params: SearchParams = {}) => inboxViewFrom({ kind: 'view', id }, params);

describe('the views, as the registry defines them (SPEC §5.3)', () => {
  it('has the six views, in the sidebar’s order, each with its own g chord', () => {
    expect(VIEWS.map((entry) => entry.id)).toEqual(['mine', 'unassigned', 'due', 'waiting', 'all', 'resolved']);
    expect(VIEWS.map((entry) => entry.shortcut)).toEqual(['g m', 'g u', 'g d', 'g w', 'g a', 'g r']);
    expect(VIEWS.map((entry) => entry.label)).toEqual([
      'My work',
      'Unassigned',
      'Due soon',
      'Waiting on others',
      'All open',
      'Recently resolved',
    ]);
  });

  it('asks for open work by category, not by state (F1: `open,paused`, never `new,open,pending`)', () => {
    // Paused work (waiting on a customer or a supplier) is still work, and
    // `new`/`pending` are states, not categories: the old filter matched only
    // `open` and every ticket on hold fell out of the queue.
    expect(view('mine').filter).toMatchObject({ assignee: 'me', statusCategory: 'open,paused', sort: 'dueAt' });
    expect(view('all').filter).toMatchObject({ statusCategory: 'open,paused', sort: '-createdAt' });
    expect(view('all').filter.assignee).toBeUndefined();
    expect(view('unassigned').filter).toMatchObject({ assignee: 'none', statusCategory: 'open', sort: 'createdAt' });
    expect(view('due').filter).toMatchObject({ statusCategory: 'open', sort: 'dueAt' });
    expect(view('waiting').filter).toMatchObject({
      assignee: 'me',
      status: 'pending_requester,pending_third_party,pending_approval',
    });
    expect(view('waiting').filter.statusCategory).toBeUndefined();
    expect(view('resolved').filter).toMatchObject({ assignee: 'me', statusCategory: 'resolved' });
    for (const entry of VIEWS) expect(view(entry.id).filter.statusCategory ?? '').not.toMatch(/new|pending/);
  });

  it('gives a team its open work', () => {
    const team = inboxViewFrom({ kind: 'team', teamId: TEAM.toUpperCase(), name: 'Network' }, {});
    expect(team.filter).toMatchObject({ group: TEAM, statusCategory: 'open,paused', sort: '-createdAt' });
    expect(team.title).toBe('Network');
    expect(team.key).toBe(`team:${TEAM}`);
    expect(team.path).toBe(`/inbox/team/${TEAM}`);
    expect(inboxViewFrom({ kind: 'team', teamId: TEAM }, {}).title).toBe('Team');
  });

  it('pages at 50', () => {
    expect(view('mine').filter.limit).toBe(50);
  });
});

describe('a view, read from the URL', () => {
  it('leaves `me` and `none` for the API to resolve, so a link is shareable', () => {
    expect(view('all', { assignee: 'me' }).filter.assignee).toBe('me');
    expect(view('all', { assignee: 'none' }).filter.assignee).toBe('none');
  });

  it('accepts a user id and refuses anything else', () => {
    expect(view('all', { assignee: PERSON }).filter.assignee).toBe(PERSON);
    expect(view('all', { assignee: "'; drop table" }).filter.assignee).toBeUndefined();
    expect(view('all', { requester: PERSON }).filter.requester).toBe(PERSON);
    expect(view('all', { requester: 'ada' }).filter.requester).toBeUndefined();
    expect(view('all', { team: TEAM }).filter.group).toBe(TEAM);
    expect(view('all', { team: '../../etc' }).filter.group).toBeUndefined();
  });

  it('does not let the URL change who a personal view is about', () => {
    expect(view('mine', { assignee: PERSON }).filter.assignee).toBe('me');
    expect(view('unassigned', { assignee: 'me' }).filter.assignee).toBe('none');
    expect(view('waiting', { assignee: 'none' }).filter.assignee).toBe('me');
    // …nor which team a team view shows.
    expect(inboxViewFrom({ kind: 'team', teamId: TEAM }, { team: PERSON }).filter.group).toBe(TEAM);
  });

  it('takes the first value when a parameter is repeated', () => {
    expect(view('all', { assignee: ['me', 'none'] }).filter.assignee).toBe('me');
    expect(view('all', { q: ['vpn', 'printer'] }).filter.q).toBe('vpn');
  });

  it('falls back to the view’s own sort rather than passing an unknown one through', () => {
    // The API's `sort` is an enum; an unrecognised value is a 422 on a page
    // load, which reads as the inbox being broken.
    expect(view('all', { sort: 'dueAt' }).sort).toBe('dueAt');
    expect(view('all', { sort: 'DROP' }).sort).toBe('-createdAt');
    expect(view('mine', { sort: 'DROP' }).sort).toBe('dueAt');
  });

  it('keeps Due soon in due order whatever the URL says', () => {
    expect(view('due', { sort: '-createdAt' }).filter.sort).toBe('dueAt');
  });

  it('caps and cleans a status list', () => {
    expect(view('all', { status: 'new,in_progress' }).filter.status).toBe('new,in_progress');
    expect(view('all', { status: 'new, in_progress ,' }).filter.status).toBe('new,in_progress');
    expect(view('all', { status: '<script>' }).filter.status).toBeUndefined();
    expect(view('all', { status: Array.from({ length: 40 }, (_, i) => `s${i}`).join(',') }).filter.status).toBe(
      Array.from({ length: 10 }, (_, i) => `s${i}`).join(','),
    );
  });

  it('narrows a view by status rather than replacing what the view means', () => {
    // A category view keeps its category; the API ands the two.
    expect(view('all', { status: 'new' }).filter).toMatchObject({ statusCategory: 'open,paused', status: 'new' });
    // A view defined by states keeps only the states it already had.
    expect(view('waiting', { status: 'pending_requester,new' }).filter.status).toBe('pending_requester');
    expect(view('waiting', { status: 'new' }).filter.status).toBe('pending_requester,pending_third_party,pending_approval');
  });

  it('cleans priority and type lists', () => {
    expect(view('all', { priority: 'P1,P2,<b>' }).filter.priority).toBe('P1,P2');
    expect(view('all', { type: 'incident,request' }).filter.type).toBe('incident,request');
  });

  it('truncates a search and a cursor rather than sending an essay', () => {
    expect(view('all', { q: 'x'.repeat(500) }).filter.q).toHaveLength(200);
    expect(view('all', { cursor: 'c'.repeat(900) }).filter.cursor).toHaveLength(500);
  });

  it('reads the selected ticket, and only a ticket reference', () => {
    expect(view('mine', { t: 'inc-000123' }).selected).toBe('INC-000123');
    expect(view('mine', { t: 'javascript:alert(1)' }).selected).toBeNull();
  });

  it('knows when it is filtered', () => {
    expect(view('mine').filtered).toBe(false);
    expect(view('mine', { q: 'vpn' }).filtered).toBe(true);
    expect(view('mine', { sort: 'createdAt', cursor: 'abc' }).filtered).toBe(false);
  });
});

describe('links to a view', () => {
  it('builds the same view with one thing changed, never carrying the cursor', () => {
    const current = view('all', { assignee: 'me', q: 'vpn', cursor: 'abc' });
    expect(inboxHref(current, { assignee: 'none' })).toBe('/inbox/all?q=vpn&assignee=none');
    expect(inboxHref(current, { cursor: 'next' })).toBe('/inbox/all?q=vpn&assignee=me&cursor=next');
  });

  it('leaves the default sort out, so the plain URL stays plain', () => {
    expect(inboxHref(view('mine'))).toBe('/inbox/mine');
    expect(inboxHref(view('mine', { sort: 'dueAt' }))).toBe('/inbox/mine');
    expect(inboxHref(view('mine', { sort: '-createdAt' }))).toBe('/inbox/mine?sort=-createdAt');
  });

  it('keeps the selected ticket across a filter change', () => {
    expect(inboxHref(view('mine', { t: 'INC-000123' }), { q: 'vpn' })).toBe('/inbox/mine?q=vpn&t=INC-000123');
  });

  it('clears every added filter', () => {
    expect(clearedHref(view('all', { q: 'vpn', status: 'new', priority: 'P1', sort: 'dueAt' }))).toBe('/inbox/all');
  });
});

describe('/queue, redirected (SPEC §5.3)', () => {
  it('sends the old queue URLs to the matching view', () => {
    expect(queueRedirectTarget({ assignee: 'me' })).toBe('/inbox/mine');
    expect(queueRedirectTarget({ assignee: 'none' })).toBe('/inbox/unassigned');
    expect(queueRedirectTarget({})).toBe('/inbox/all');
    expect(queueRedirectTarget({ assignee: PERSON })).toBe(`/inbox/all?assignee=${PERSON}`);
  });

  it('carries the other parameters, cleaned, and drops the cursor', () => {
    expect(queueRedirectTarget({ assignee: 'me', q: 'vpn', status: 'new', cursor: 'abc' })).toBe('/inbox/mine?q=vpn&status=new');
    expect(queueRedirectTarget({ assignee: 'none', sort: 'dueAt' })).toBe('/inbox/unassigned?sort=dueAt');
    expect(queueRedirectTarget({ assignee: '<script>', status: '<b>' })).toBe('/inbox/all');
  });
});

describe('the last view', () => {
  it('round-trips through the cookie', () => {
    const refs: ViewRef[] = [{ kind: 'view', id: 'due' }, { kind: 'team', teamId: TEAM }];
    for (const ref of refs) expect(viewRefFromLastView(lastViewValue(ref))).toEqual(ref);
  });

  it('refuses a value this app did not write', () => {
    for (const value of ['', 'admin', 'team/not-a-uuid', '../mine', 'https://evil.example', undefined, null]) {
      expect(viewRefFromLastView(value)).toBeNull();
    }
  });

  it('opens /inbox on the remembered view, or My work', () => {
    expect(inboxLanding('waiting')).toBe('/inbox/waiting');
    expect(inboxLanding(`team/${TEAM}`)).toBe(`/inbox/team/${TEAM}`);
    expect(inboxLanding(undefined)).toBe('/inbox/mine');
    expect(inboxLanding('//evil.example')).toBe('/inbox/mine');
  });

  it('recognises the paths the proxy remembers, and only those', () => {
    expect(viewRefFromPath('/inbox/all')).toEqual({ kind: 'view', id: 'all' });
    expect(viewRefFromPath(`/inbox/team/${TEAM}`)).toEqual({ kind: 'team', teamId: TEAM });
    for (const path of ['/inbox', '/inbox/nope', '/inbox/team/x', '/tickets/INC-000001', '/queue']) {
      expect(viewRefFromPath(path)).toBeNull();
    }
  });
});

describe('the sidebar', () => {
  it('lists the views, then the teams, with pins and recents', () => {
    const nav = deskNavModel({ canReadTickets: true, teams: [{ id: TEAM, name: 'Network' }] });
    expect(nav.sections.map((section) => section.id)).toEqual(['views', 'teams']);
    expect(nav.sections[0]!.items.map((item) => item.href)).toEqual(VIEWS.map((entry) => `/inbox/${entry.id}`));
    expect(nav.sections[1]!.items[0]).toMatchObject({ label: 'Network', href: `/inbox/team/${TEAM}` });
    expect(nav.pinned?.enabled).toBe(true);
    expect(nav.recent).toEqual({ enabled: true, max: 8 });
  });

  it('has no team section without teams, and no views without ticket.read', () => {
    expect(deskNavModel({ canReadTickets: true, teams: [] }).sections.map((section) => section.id)).toEqual(['views']);
    expect(deskNavModel({ canReadTickets: false, teams: [{ id: TEAM, name: 'Network' }] }).sections).toEqual([]);
  });

  it('shows known counts only, capped at 99+ and spoken as tickets', () => {
    const nav = deskNavModel({
      canReadTickets: true,
      teams: [{ id: TEAM, name: 'Network' }],
      counts: { mine: { count: 12, capped: false }, unassigned: { count: 0, capped: false }, all: { count: 1000, capped: true }, [`team:${TEAM}`]: { count: 1, capped: false } },
    });
    const byId = Object.fromEntries(nav.sections.flatMap((section) => section.items).map((item) => [item.id, item.badge]));
    expect(byId.mine).toMatchObject({ value: 12, label: '12 tickets' });
    expect(byId.unassigned).toBeUndefined();
    expect(byId.due).toBeUndefined();
    expect(byId.all).toMatchObject({ value: 1000, capped: true, label: 'more than 99 tickets' });
    expect(byId[`team:${TEAM}`]).toMatchObject({ value: 1, label: '1 ticket' });
    expect(countBadge({ count: 40, capped: true })?.label).toBe('40 or more tickets');
  });

  it('follows the person’s teams on the live stream, at most 19 (the API adds their own topic)', () => {
    expect(deskTopics([TEAM, TEAM.toUpperCase()])).toEqual([`group:${TEAM}`]);
    const many = Array.from({ length: 25 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(deskTopics(many)).toHaveLength(19);
  });
});

describe('the sidebar counts', () => {
  function fakeApi({ count, tickets }: { count?: (filter: TicketFilter) => Promise<TicketCount>; tickets?: (filter: TicketFilter) => Promise<Page<Ticket>> }) {
    return {
      ticketCount: vi.fn(count ?? (async () => ({ count: 3, capped: false }))),
      tickets: vi.fn(tickets ?? (async () => ({ data: [], nextCursor: null }))),
    };
  }

  it('asks the count route for every counted view and team, with each view’s own filter', async () => {
    const api = fakeApi({ count: async (filter) => ({ count: filter.group ? 7 : filter.assignee === 'me' ? 2 : 5, capped: false }) });
    const result = await countViews(api, [TEAM]);
    expect(result.exact).toBe(true);
    expect(result.counts).toEqual({
      mine: { count: 2, capped: false },
      unassigned: { count: 5, capped: false },
      due: { count: 5, capped: false },
      all: { count: 5, capped: false },
      [`team:${TEAM}`]: { count: 7, capped: false },
    });
    expect(api.ticketCount).toHaveBeenCalledWith({ assignee: 'me', statusCategory: 'open,paused' });
    expect(api.tickets).not.toHaveBeenCalled();
  });

  it('leaves out a view whose count failed, rather than showing zero', async () => {
    const api = fakeApi({
      count: async (filter) => {
        if (filter.assignee === 'none') throw new ApiError(500, null, 'boom');
        return { count: 1, capped: false };
      },
    });
    const result = await countViews(api);
    expect(result.counts.unassigned).toBeUndefined();
    expect(result.counts.mine).toEqual({ count: 1, capped: false });
  });

  it('probes My work, Unassigned and Due soon when the API has no count route', async () => {
    const full: Page<Ticket> = { data: Array.from({ length: PROBE_LIMIT }, () => ({}) as Ticket), nextCursor: 'more' };
    const api = fakeApi({
      count: async () => {
        throw new ApiError(404, null, 'no route');
      },
      tickets: async (filter) => (filter.assignee === 'none' ? full : { data: [{} as Ticket, {} as Ticket], nextCursor: null }),
    });
    const result = await countViews(api, [TEAM]);
    expect(result.exact).toBe(false);
    expect(result.counts).toEqual({
      mine: { count: 2, capped: false },
      unassigned: { count: PROBE_LIMIT, capped: true },
      due: { count: 2, capped: false },
    });
    expect(api.tickets).toHaveBeenCalledTimes(3);
    for (const [filter] of api.tickets.mock.calls) expect(filter.limit).toBe(PROBE_LIMIT);
  });

  it('reports an ended session instead of an empty sidebar', async () => {
    const api = fakeApi({
      count: async () => {
        throw new ApiError(401, null, 'expired');
      },
    });
    await expect(countViews(api)).rejects.toMatchObject({ status: 401 });
  });

  it('takes team ids from the query string only when they are ids', () => {
    expect(teamIdsFrom(`${TEAM},${TEAM.toUpperCase()}, nope ,`)).toEqual([TEAM]);
    expect(teamIdsFrom(null)).toEqual([]);
  });
});

describe('the legacy path', () => {
  it('re-exports the registry, so old imports keep compiling until Stage 5', () => {
    expect(legacyView.inboxViewFrom).toBe(inboxViewFrom);
  });
});

describe('the transitions the workbench offers', () => {
  /**
   * The workbench cannot import `@itsm/module-ticket` at runtime — a module
   * package carries Prisma, and this app has no database. The table is
   * therefore a copy, and this is the check that keeps it one.
   */
  it('matches MOD-04’s state machine exactly', () => {
    const canonical = Object.fromEntries(
      Object.entries(STATES).map(([state, definition]) => [state, [...definition.allowed].sort()]),
    );
    const copied = Object.fromEntries(
      Object.entries(ALLOWED_TRANSITIONS).map(([state, allowed]) => [state, [...allowed].sort()]),
    );
    expect(copied).toEqual(canonical);
  });

  it('offers nothing from a state it does not recognise', () => {
    expect(transitionsFrom('awaiting_parts')).toEqual([]);
    expect(transitionsFrom('closed')).toEqual([]);
    expect(transitionsFrom('new')).toContain('in_progress');
  });
});
