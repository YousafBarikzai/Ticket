import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { ticketService } from '@itsm/module-ticket';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * R2: date and SLA filters on the ticket grammar (A8 §10.4).
 *
 * `GET /tickets` and `GET /tickets/count` gained half-open date windows
 * (`…After` inclusive, `…Before` exclusive), `filter[sla]=breached|due_soon`
 * on the server clock, and an `applied` echo naming the filters the server
 * honoured. The Service Desk's KPIs ("Breached", "Due today") and
 * Administration's "At risk now" are these counts, so each bound is pinned at
 * its exact instant, and every case is asked of the list and the count and
 * compared: the WA1 property, a badge never promising a row the list will not
 * show.
 *
 * Every query carries `q=Filterfix`, the fixtures' title marker, so the
 * harness's own tickets (which an SLA policy may give a due time) never change
 * an expected set.
 */

const MARK = 'Filterfix';
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-03-01T09:00:00.000Z');
const T1 = new Date('2026-03-08T09:00:00.000Z');
const R0 = new Date('2026-03-05T17:30:00.000Z');
const FAR_PAST = '2000-01-01T00:00:00.000Z';
const FAR_FUTURE = '2100-01-01T00:00:00.000Z';

let tenant: TestTenant;
/** When the fixtures were written; the SLA due times are relative to it. */
let now: Date;
/** Ticket B's stored due time, for pinning the due bounds at an exact instant. */
let dueB: Date;

const ctx = () => contextFor(tenant.id);

interface Fixture {
  title: string;
  status: string;
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  group: 'primary' | 'other';
  requester: 'requester' | 'otherRequester';
  createdAt: Date;
  resolvedAt?: Date;
  dueAt?: Date | null;
}

/**
 * Writes a ticket as the import path does, which is the one door that sets
 * `createdAt` and `resolvedAt` (A8 §10.5 asks for exactly this), then gives it
 * the due time an SLA policy would have.
 */
async function fixture(input: Fixture): Promise<{ id: string; number: string }> {
  const ticket = await withContext(ctx(), () =>
    ticketService.importTicket(ctx(), {
      title: `${MARK} ${input.title}`,
      status: input.status,
      priority: input.priority,
      groupId: input.group === 'primary' ? tenant.teamId : tenant.otherTeamId,
      requesterId: tenant.people[input.requester]!.id,
      orgId: tenant.orgId,
      externalRef: `filters-${input.title}`,
      createdAt: input.createdAt,
      ...(input.resolvedAt ? { resolvedAt: input.resolvedAt } : {}),
    }),
  );
  if (input.dueAt) {
    const dueAt = input.dueAt;
    await withContext(ctx(), () => transaction(ctx(), (tx) => tx.ticket.update({ where: { id: ticket.id }, data: { dueAt } })));
  }
  return { id: ticket.id, number: ticket.number };
}

beforeAll(async () => {
  tenant = await createTestTenant('ticket-filters');
  now = new Date();
  const hour = 60 * 60 * 1000;

  await fixture({ title: 'A breached', status: 'in_progress', priority: 'P1', group: 'primary', requester: 'requester', createdAt: new Date(T0.getTime() - 2 * DAY), dueAt: new Date(now.getTime() - hour) });
  await fixture({ title: 'B due soon', status: 'new', priority: 'P2', group: 'primary', requester: 'otherRequester', createdAt: T0, dueAt: new Date(now.getTime() + 30 * 60 * 1000) });
  await fixture({ title: 'C due later', status: 'in_progress', priority: 'P3', group: 'other', requester: 'requester', createdAt: new Date(T0.getTime() + DAY), dueAt: new Date(now.getTime() + 2 * hour) });
  await fixture({ title: 'D no target', status: 'new', priority: 'P3', group: 'primary', requester: 'requester', createdAt: T1 });
  // Resolved past its due time: late, but no longer open, so never "breached".
  await fixture({ title: 'E resolved', status: 'resolved', priority: 'P2', group: 'primary', requester: 'otherRequester', createdAt: new Date(T0.getTime() - 5 * DAY), resolvedAt: R0, dueAt: new Date(now.getTime() - 3 * hour) });
  await fixture({ title: 'F paused', status: 'pending_requester', priority: 'P4', group: 'primary', requester: 'requester', createdAt: new Date(T0.getTime() + 2 * DAY) });

  const stored = await withContext(ctx(), () =>
    transaction(ctx(), (tx) => tx.ticket.findFirst({ where: { title: `${MARK} B due soon` }, select: { dueAt: true } })),
  );
  dueB = stored!.dueAt!;
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('ticket-filters');
  await closeHarness();
});

type Persona = 'requester' | 'otherRequester' | 'agent' | 'otherAgent' | 'lead' | 'admin';

interface Both {
  /** The fixture letters the list returned, sorted. */
  letters: string[];
  count: number;
  capped: boolean;
  applied: string[];
}

/** Asks the list and the count the same question and checks they agree. */
async function both(persona: Persona, query: string): Promise<Both> {
  const token = tenant.people[persona]!.token;
  const qs = `q=${MARK}${query ? `&${query}` : ''}`;
  const list = await request<{ data: { title: string }[]; nextCursor: string | null; applied: string[] }>(`/api/v1/tickets?limit=200&${qs}`, { token });
  expect(list.status, JSON.stringify(list.body)).toBe(200);
  expect(list.body.nextCursor).toBeNull();

  const counted = await request<{ count: number; capped: boolean; applied: string[] }>(`/api/v1/tickets/count?${qs}`, { token });
  expect(counted.status, JSON.stringify(counted.body)).toBe(200);
  expect(counted.body.count, `count = list for ${persona}: ${query}`).toBe(list.body.data.length);
  expect(counted.body.applied).toEqual(list.body.applied);

  return {
    letters: list.body.data.map((row) => row.title.replace(`${MARK} `, '').charAt(0)).sort(),
    count: counted.body.count,
    capped: counted.body.capped,
    applied: counted.body.applied,
  };
}

const at = (date: Date | number) => new Date(date).toISOString();

describe('filter[sla]', () => {
  it('breached is open work whose due time has passed', async () => {
    // E is past due too, but resolved; F is paused with no due time.
    expect((await both('admin', 'filter[sla]=breached')).letters).toEqual(['A']);
  });

  it('due_soon is open work due within the hour', async () => {
    expect((await both('admin', 'filter[sla]=due_soon')).letters).toEqual(['B']);
  });

  it('intersects an explicit status category instead of replacing it', async () => {
    expect((await both('admin', 'filter[sla]=breached&filter[statusCategory]=paused')).letters).toEqual([]);
    expect((await both('admin', 'filter[sla]=breached&filter[statusCategory]=open,paused')).letters).toEqual(['A']);
  });

  it('intersects a due window instead of replacing it', async () => {
    expect((await both('admin', `filter[sla]=due_soon&filter[dueBefore]=${at(now.getTime() + 10 * 60 * 1000)}`)).letters).toEqual([]);
    expect((await both('admin', `filter[sla]=due_soon&filter[dueAfter]=${at(now)}`)).letters).toEqual(['B']);
  });

  it('accepts only the R6 vocabulary', async () => {
    // A7 spelled it `at_risk`; the grammar is `due_soon` (A8 §10.4).
    const response = await request('/api/v1/tickets/count?filter[sla]=at_risk', { token: tenant.people.admin!.token });
    expect(response.status).toBe(422);
  });

  describe('at the exact instants', () => {
    // Judged against a fixed `now` through the service, the same function the
    // route calls, so the edges are exact rather than a race with the clock.
    const N = new Date('2026-09-01T12:00:00.000Z');
    const SLA_MARK = 'Slafix';

    beforeAll(async () => {
      const edges: [string, string, number][] = [
        ['due now', 'in_progress', 0],
        ['due a millisecond after now', 'in_progress', 1],
        ['due in exactly an hour', 'new', 60 * 60 * 1000],
        ['due an hour and a millisecond from now', 'new', 60 * 60 * 1000 + 1],
        ['paused and past due', 'pending_third_party', -60 * 60 * 1000],
      ];
      for (const [title, status, offset] of edges) {
        const ticket = await withContext(ctx(), () =>
          ticketService.importTicket(ctx(), {
            title: `${SLA_MARK} ${title}`,
            status,
            groupId: tenant.teamId,
            orgId: tenant.orgId,
            externalRef: `filters-sla-${title}`,
            createdAt: new Date(N.getTime() - DAY),
          }),
        );
        const dueAt = new Date(N.getTime() + offset);
        await withContext(ctx(), () => transaction(ctx(), (tx) => tx.ticket.update({ where: { id: ticket.id }, data: { dueAt } })));
      }
    });

    const titles = async (sla: 'breached' | 'due_soon') => {
      const listed = await withContext(ctx(), () => ticketService.listTickets(ctx(), { search: SLA_MARK, sla, now: N }, { limit: 50 }));
      const counted = await withContext(ctx(), () => ticketService.countTickets(ctx(), { search: SLA_MARK, sla, now: N }));
      expect(counted).toBe(listed.data.length);
      return listed.data.map((row) => row.title.replace(`${SLA_MARK} `, '')).sort();
    };

    it('counts a ticket due exactly now as breached', async () => {
      expect(await titles('breached')).toEqual(['due now']);
    });

    it('counts due soon after now, up to and including an hour from now', async () => {
      expect(await titles('due_soon')).toEqual(['due a millisecond after now', 'due in exactly an hour']);
    });
  });
});

describe('date windows are half-open', () => {
  it('createdAfter is inclusive at the exact instant', async () => {
    expect((await both('admin', `filter[createdAfter]=${at(T0)}`)).letters).toEqual(['B', 'C', 'D', 'F']);
  });

  it('createdBefore is exclusive at the exact instant (it was inclusive before v3)', async () => {
    expect((await both('admin', `filter[createdBefore]=${at(T0)}`)).letters).toEqual(['A', 'E']);
    expect((await both('admin', `filter[createdBefore]=${at(T0.getTime() + 1)}`)).letters).toEqual(['A', 'B', 'E']);
  });

  it('lets consecutive windows share a boundary without counting a ticket twice', async () => {
    const week = (await both('admin', `filter[createdAfter]=${at(T0)}&filter[createdBefore]=${at(T1)}`)).letters;
    const next = (await both('admin', `filter[createdAfter]=${at(T1)}&filter[createdBefore]=${at(T1.getTime() + 7 * DAY)}`)).letters;
    expect(week).toEqual(['B', 'C', 'F']);
    expect(next).toEqual(['D']);
  });

  it('answers an empty window with nothing, not an error', async () => {
    expect((await both('admin', `filter[createdAfter]=${at(T0)}&filter[createdBefore]=${at(T0)}`)).count).toBe(0);
  });

  it('bounds resolvedAt the same way', async () => {
    expect((await both('admin', `filter[resolvedAfter]=${at(R0)}`)).letters).toEqual(['E']);
    expect((await both('admin', `filter[resolvedBefore]=${at(R0)}`)).letters).toEqual([]);
    expect((await both('admin', `filter[resolvedBefore]=${at(R0.getTime() + 1)}`)).letters).toEqual(['E']);
  });

  it('bounds dueAt the same way', async () => {
    expect((await both('admin', `filter[dueAfter]=${at(dueB)}`)).letters).toEqual(['B', 'C']);
    expect((await both('admin', `filter[dueBefore]=${at(dueB)}`)).letters).toEqual(['A', 'E']);
  });

  it('reads any due bound as "has a due time"', async () => {
    // D and F have none, whatever the window.
    expect((await both('admin', `filter[dueBefore]=${FAR_FUTURE}`)).letters).toEqual(['A', 'B', 'C', 'E']);
    expect((await both('admin', `filter[dueAfter]=${FAR_PAST}`)).letters).toEqual(['A', 'B', 'C', 'E']);
  });

  it('reads an offset as the instant it names', async () => {
    // 10:00 at +01:00 is T0. The `+` is sent encoded, as URLSearchParams does.
    expect((await both('admin', 'filter[createdAfter]=2026-03-01T10:00:00%2B01:00')).letters).toEqual(['B', 'C', 'D', 'F']);
    expect((await both('admin', 'filter[createdBefore]=2026-03-01T10:00:00%2B01:00')).letters).toEqual(['A', 'E']);
  });

  it('is exclusive in the service too, which the drift check counts through', async () => {
    // `checkTicketDrift` asks `countTickets` for `[from, to)`; its fact count
    // must use the same bounds for the comparison to mean anything.
    const counted = await withContext(ctx(), () => ticketService.countTickets(ctx(), { search: MARK, createdAfter: T0, createdBefore: T1 }));
    expect(counted).toBe(3);
  });
});

describe('the applied echo', () => {
  it('names exactly the filters honoured, sorted', async () => {
    const { applied } = await both('admin', `filter[statusCategory]=open&filter[sla]=breached&filter[dueBefore]=${FAR_FUTURE}`);
    expect(applied).toEqual(['dueBefore', 'sla', 'statusCategory']);
  });

  it('names every key of the grammar when each is used', async () => {
    const query = [
      'filter[status]=new,in_progress',
      'filter[statusCategory]=open',
      'filter[type]=incident',
      'filter[priority]=P1,P2',
      'filter[assignee]=none',
      `filter[group]=${tenant.teamId}`,
      `filter[requester]=${tenant.people.requester!.id}`,
      `filter[service]=${tenant.teamId}`,
      `filter[createdAfter]=${FAR_PAST}`,
      `filter[createdBefore]=${FAR_FUTURE}`,
      `filter[dueAfter]=${FAR_PAST}`,
      `filter[dueBefore]=${FAR_FUTURE}`,
      `filter[resolvedAfter]=${FAR_PAST}`,
      `filter[resolvedBefore]=${FAR_FUTURE}`,
      'filter[sla]=breached',
    ].join('&');
    expect((await both('admin', query)).applied).toEqual([
      'assignee',
      'createdAfter',
      'createdBefore',
      'dueAfter',
      'dueBefore',
      'group',
      'priority',
      'requester',
      'resolvedAfter',
      'resolvedBefore',
      'service',
      'sla',
      'status',
      'statusCategory',
      'type',
    ]);
  });

  it('is empty without filters; the search is not a filter', async () => {
    expect((await both('admin', '')).applied).toEqual([]);
  });

  it('leaves out keys it does not know and values that say nothing', async () => {
    const { applied, letters } = await both('admin', 'filter[colour]=red&filter[status]=');
    expect(applied).toEqual([]);
    expect(letters).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });
});

describe('refusals', () => {
  const admin = () => tenant.people.admin!.token;

  it('refuses an instant it cannot read', async () => {
    for (const value of ['yesterday', '2026-03-01', '2026-03-01T09:00:00']) {
      const response = await request<{ errors?: { field: string }[] }>(`/api/v1/tickets?filter[createdAfter]=${value}`, { token: admin() });
      expect(response.status, value).toBe(422);
      expect(response.body.errors?.map((error) => error.field)).toContain('filter[createdAfter]');
    }
  });

  it.each([
    ['created', 'createdAfter', 'createdBefore'],
    ['due', 'dueAfter', 'dueBefore'],
    ['resolved', 'resolvedAfter', 'resolvedBefore'],
  ])('refuses a %s window that ends before it starts, on the list and the count', async (_name, after, before) => {
    const query = `filter[${after}]=${at(T1)}&filter[${before}]=${at(T0)}`;
    for (const path of ['/api/v1/tickets', '/api/v1/tickets/count']) {
      const response = await request<{ detail: string }>(`${path}?${query}`, { token: admin() });
      expect(response.status, path).toBe(422);
      expect(response.body.detail).toBe('the window ends before it starts');
    }
  });
});

describe('scope is unchanged', () => {
  it('a team-scoped agent counts only what their team may see', async () => {
    expect((await both('agent', 'filter[sla]=breached')).letters).toEqual(['A']);
    expect((await both('lead', 'filter[sla]=breached')).letters).toEqual(['A']);
    expect((await both('otherAgent', 'filter[sla]=breached')).letters).toEqual([]);
    expect((await both('otherAgent', `filter[dueBefore]=${FAR_FUTURE}`)).letters).toEqual(['C']);
  });

  it('a requester counts only their own', async () => {
    expect((await both('requester', 'filter[sla]=breached')).letters).toEqual(['A']);
    expect((await both('otherRequester', 'filter[sla]=breached')).letters).toEqual([]);
    expect((await both('otherRequester', 'filter[sla]=due_soon')).letters).toEqual(['B']);
  });
});

describe('the count matches the list', () => {
  const personas: Persona[] = ['requester', 'otherRequester', 'agent', 'otherAgent', 'lead', 'admin'];
  const queries = () => [
    'filter[sla]=breached',
    'filter[sla]=due_soon',
    `filter[createdAfter]=${at(T0)}`,
    `filter[createdBefore]=${at(T0)}`,
    `filter[createdAfter]=${at(T0)}&filter[createdBefore]=${at(T1)}`,
    `filter[resolvedAfter]=${at(R0)}`,
    `filter[dueAfter]=${at(dueB)}`,
    `filter[dueBefore]=${at(dueB)}`,
    `filter[dueBefore]=${FAR_FUTURE}&filter[statusCategory]=open,paused`,
    `filter[sla]=breached&filter[group]=${tenant.teamId}`,
  ];

  it.each(personas)('for %s, on every R2 query', async (persona) => {
    // `both` asserts count = list for each query; this walks the grid.
    for (const query of queries()) {
      const { capped } = await both(persona, query);
      expect(capped).toBe(false);
    }
  });
});
