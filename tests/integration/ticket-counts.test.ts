import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { ticketService } from '@itsm/module-ticket';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * R2g: `GET /tickets/counts?groupBy=` (A8 §10.5).
 *
 * The distributions on the Service Desk Overview and Administration's
 * breakdowns are one call each instead of one `/tickets/count` per key. What
 * must hold: the groups sum to `total`; `total` is what `/tickets/count`
 * answers for the same filter and reader (so a breakdown never disagrees with
 * the KPI beside it); scope applies as it does to the list; and the guard
 * refuses a whole-history scan with 422.
 *
 * It also holds the row "grouped counts never cross tenants" (SPEC §9.5):
 * the isolation suite is another package's this wave, and two tenants with
 * identical fixtures are how a leak would show.
 *
 * Every query carries `q=Countfix`, the fixtures' title marker, so the
 * harness's own tickets never change an expected figure.
 */

const MARK = 'Countfix';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let tenant: TestTenant;
let twin: TestTenant;
let now: Date;
const services = { a: randomUUID(), b: randomUUID(), twinA: randomUUID() };

interface Fixture {
  title: string;
  type: 'incident' | 'request' | 'problem';
  status: string;
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  group: 'primary' | 'other' | null;
  assignee?: 'agent' | 'otherAgent';
  requester: 'requester' | 'otherRequester';
  service?: string;
  createdAgo: number;
  resolvedAgo?: number;
  closedAgo?: number;
  dueIn?: number;
}

/**
 * The same seven tickets in each tenant. Open and paused (1–5) are one of
 * every SLA bucket and every age bucket; 6 is resolved yesterday, 7 is history
 * older than the 400-day window.
 */
const FIXTURES = (serviceA: string, serviceB: string): Fixture[] => [
  { title: '1 breached', type: 'incident', status: 'in_progress', priority: 'P1', group: 'primary', assignee: 'agent', requester: 'requester', service: serviceA, createdAgo: 12 * HOUR, dueIn: -HOUR },
  { title: '2 due soon', type: 'request', status: 'new', priority: 'P2', group: 'primary', requester: 'otherRequester', service: serviceA, createdAgo: 2 * DAY, dueIn: 30 * 60 * 1000 },
  { title: '3 due later', type: 'incident', status: 'in_progress', priority: 'P2', group: 'other', assignee: 'otherAgent', requester: 'requester', service: serviceB, createdAgo: 5 * DAY, dueIn: 5 * HOUR },
  { title: '4 no target', type: 'incident', status: 'new', priority: 'P3', group: null, requester: 'requester', createdAgo: 10 * DAY },
  { title: '5 paused', type: 'request', status: 'pending_requester', priority: 'P4', group: 'primary', requester: 'otherRequester', createdAgo: 60 * DAY },
  { title: '6 resolved', type: 'incident', status: 'resolved', priority: 'P3', group: 'primary', requester: 'requester', createdAgo: 20 * DAY, resolvedAgo: DAY },
  { title: '7 history', type: 'problem', status: 'closed', priority: 'P1', group: 'other', requester: 'requester', createdAgo: 500 * DAY, resolvedAgo: 450 * DAY, closedAgo: 449 * DAY },
];

async function seed(into: TestTenant, fixtures: Fixture[], at: Date): Promise<void> {
  const ctx = contextFor(into.id);
  const ago = (ms: number) => new Date(at.getTime() - ms);
  for (const item of fixtures) {
    const ticket = await withContext(ctx, () =>
      ticketService.importTicket(ctx, {
        title: `${MARK} ${item.title}`,
        type: item.type,
        status: item.status,
        priority: item.priority,
        groupId: item.group === 'primary' ? into.teamId : item.group === 'other' ? into.otherTeamId : null,
        assigneeId: item.assignee ? into.people[item.assignee]!.id : null,
        requesterId: into.people[item.requester]!.id,
        serviceId: item.service ?? null,
        orgId: into.orgId,
        externalRef: `counts-${item.title}`,
        createdAt: ago(item.createdAgo),
        ...(item.resolvedAgo !== undefined ? { resolvedAt: ago(item.resolvedAgo) } : {}),
        ...(item.closedAgo !== undefined ? { closedAt: ago(item.closedAgo) } : {}),
      }),
    );
    if (item.dueIn !== undefined) {
      const dueAt = new Date(at.getTime() + item.dueIn);
      await withContext(ctx, () => transaction(ctx, (tx) => tx.ticket.update({ where: { id: ticket.id }, data: { dueAt } })));
    }
  }
}

beforeAll(async () => {
  tenant = await createTestTenant('ticket-counts');
  twin = await createTestTenant('ticket-counts-twin');
  now = new Date();
  await seed(tenant, FIXTURES(services.a, services.b), now);
  // The twin has the same tickets, titles and shape, with a service of its own.
  await seed(twin, FIXTURES(services.twinA, services.twinA), now);
}, 180_000);

afterAll(async () => {
  await deleteTestTenant('ticket-counts');
  await deleteTestTenant('ticket-counts-twin');
  await closeHarness();
});

type Persona = 'requester' | 'otherRequester' | 'agent' | 'otherAgent' | 'lead' | 'admin';
type Group = { key: string | null; count: number };
interface Counts {
  groupBy: string;
  groups: Group[];
  total: number;
  applied: string[];
}

const LIVE = 'filter[statusCategory]=open,paused';

async function counts(persona: Persona, query: string, on: TestTenant = tenant): Promise<Counts> {
  const response = await request<Counts>(`/api/v1/tickets/counts?q=${MARK}&${query}`, { token: on.people[persona]!.token });
  expect(response.status, `${persona}: ${query} → ${JSON.stringify(response.body)}`).toBe(200);
  return response.body;
}

async function countOf(persona: Persona, query: string, on: TestTenant = tenant): Promise<number> {
  const response = await request<{ count: number; capped: boolean }>(`/api/v1/tickets/count?q=${MARK}&${query}`, { token: on.people[persona]!.token });
  expect(response.status).toBe(200);
  expect(response.body.capped).toBe(false);
  return response.body.count;
}

const asMap = (groups: Group[]) => Object.fromEntries(groups.map((group) => [String(group.key), group.count]));
const sum = (groups: Group[]) => groups.reduce((total, group) => total + group.count, 0);

describe('totals agree with the count', () => {
  const personas: Persona[] = ['requester', 'otherRequester', 'agent', 'otherAgent', 'lead', 'admin'];
  const dimensions = ticketService.COUNT_DIMENSIONS;

  it.each(personas)('for %s, on every dimension', async (persona) => {
    const live = await countOf(persona, LIVE);
    for (const groupBy of dimensions) {
      const answer = await counts(persona, `groupBy=${groupBy}&${LIVE}`);
      expect(answer.groupBy).toBe(groupBy);
      expect(sum(answer.groups), groupBy).toBe(answer.total);
      expect(answer.total, groupBy).toBe(live);
    }
  });

  it('for a date window, on every dimension that takes one', async () => {
    const window = `filter[createdAfter]=${new Date(now.getTime() - 400 * DAY).toISOString()}`;
    const counted = await countOf('admin', window);
    expect(counted).toBe(6);
    for (const groupBy of dimensions.filter((dimension) => dimension !== 'sla' && dimension !== 'age')) {
      const answer = await counts('admin', `groupBy=${groupBy}&${window}`);
      expect(sum(answer.groups), groupBy).toBe(answer.total);
      expect(answer.total, groupBy).toBe(counted);
    }
  });

  it('for the age and SLA breakdowns, which read open and paused work unless told otherwise', async () => {
    const live = await countOf('admin', LIVE);
    expect(live).toBe(5);
    expect((await counts('admin', 'groupBy=age')).total).toBe(live);
    expect((await counts('admin', 'groupBy=sla')).total).toBe(live);
  });
});

describe('the groups', () => {
  it('come in canonical order for fixed vocabularies', async () => {
    const priority = await counts('admin', `groupBy=priority&${LIVE}`);
    expect(priority.groups).toEqual([
      { key: 'P1', count: 1 },
      { key: 'P2', count: 2 },
      { key: 'P3', count: 1 },
      { key: 'P4', count: 1 },
    ]);

    const status = await counts('admin', `groupBy=status&${LIVE}`);
    expect(status.groups).toEqual([
      { key: 'new', count: 2 },
      { key: 'in_progress', count: 2 },
      { key: 'pending_requester', count: 1 },
    ]);

    const category = await counts('admin', `groupBy=statusCategory&filter[createdAfter]=${new Date(now.getTime() - 400 * DAY).toISOString()}`);
    expect(category.groups).toEqual([
      { key: 'open', count: 4 },
      { key: 'paused', count: 1 },
      { key: 'resolved', count: 1 },
    ]);

    const type = await counts('admin', `groupBy=type&${LIVE}`);
    expect(type.groups).toEqual([
      { key: 'incident', count: 3 },
      { key: 'request', count: 2 },
    ]);
  });

  it('come largest first for teams, with "none" as a null key after its equals', async () => {
    const group = await counts('admin', `groupBy=group&${LIVE}`);
    expect(group.groups).toEqual([
      { key: tenant.teamId, count: 3 },
      { key: tenant.otherTeamId, count: 1 },
      { key: null, count: 1 },
    ]);
  });

  it('give unassigned work a null key', async () => {
    const assignee = await counts('admin', `groupBy=assignee&${LIVE}`);
    expect(assignee.groups[0]).toEqual({ key: null, count: 3 });
    expect(asMap(assignee.groups)).toEqual({
      null: 3,
      [tenant.people.agent!.id]: 1,
      [tenant.people.otherAgent!.id]: 1,
    });
  });

  it('give work with no service a null key', async () => {
    const service = await counts('admin', `groupBy=service&${LIVE}`);
    expect(service.groups).toEqual([
      { key: services.a, count: 2 },
      { key: null, count: 2 },
      { key: services.b, count: 1 },
    ]);
  });

  it('bucket age by when the work was raised', async () => {
    const age = await counts('admin', 'groupBy=age');
    expect(age.groups).toEqual([
      { key: 'under_1d', count: 1 },
      { key: '1d_3d', count: 1 },
      { key: '3d_7d', count: 1 },
      { key: '7d_30d', count: 1 },
      { key: 'over_30d', count: 1 },
    ]);
  });

  it('bucket SLA by due time, with paused work apart', async () => {
    const sla = await counts('admin', 'groupBy=sla');
    expect(sla.groups).toEqual([
      { key: 'breached', count: 1 },
      { key: 'due_soon', count: 1 },
      { key: 'due_later', count: 1 },
      { key: 'no_target', count: 1 },
      { key: 'paused', count: 1 },
    ]);
  });

  it('agree with filter[sla], so a chip and the breakdown beside it match', async () => {
    const sla = asMap((await counts('admin', 'groupBy=sla')).groups);
    expect(sla.breached).toBe(await countOf('admin', 'filter[sla]=breached'));
    expect(sla.due_soon).toBe(await countOf('admin', 'filter[sla]=due_soon'));
  });

  it('keep every age and SLA bucket, empty ones included', async () => {
    const age = await counts('admin', 'groupBy=age&filter[statusCategory]=paused');
    expect(age.groups.map((group) => group.key)).toEqual(['under_1d', '1d_3d', '3d_7d', '7d_30d', 'over_30d']);
    expect(asMap(age.groups)).toMatchObject({ over_30d: 1, under_1d: 0 });

    const sla = await counts('admin', 'groupBy=sla&filter[statusCategory]=open');
    expect(asMap(sla.groups)).toEqual({ breached: 1, due_soon: 1, due_later: 1, no_target: 1, paused: 0 });
  });

  it('take the rest of the grammar', async () => {
    const resolvedLately = await counts('admin', `groupBy=priority&filter[resolvedAfter]=${new Date(now.getTime() - 2 * DAY).toISOString()}`);
    expect(resolvedLately.groups).toEqual([{ key: 'P3', count: 1 }]);

    const breachedByTeam = await counts('admin', 'groupBy=group&filter[sla]=breached');
    expect(breachedByTeam.groups).toEqual([{ key: tenant.teamId, count: 1 }]);
  });
});

describe('the age buckets at their edges', () => {
  // A fixed `now` through the service, the function the route calls, so each
  // edge is pinned exactly rather than raced against the clock.
  const N = new Date('2026-09-15T12:00:00.000Z');
  const EDGE = 'Agefix';

  beforeAll(async () => {
    const ctx = contextFor(tenant.id);
    const edges: [string, number][] = [
      ['a day less a millisecond', DAY - 1],
      ['exactly a day', DAY],
      ['exactly three days', 3 * DAY],
      ['exactly a week', 7 * DAY],
      ['thirty days less a millisecond', 30 * DAY - 1],
      ['exactly thirty days', 30 * DAY],
    ];
    for (const [title, age] of edges) {
      await withContext(ctx, () =>
        ticketService.importTicket(ctx, {
          title: `${EDGE} ${title}`,
          status: 'new',
          orgId: tenant.orgId,
          externalRef: `counts-age-${title}`,
          createdAt: new Date(N.getTime() - age),
        }),
      );
    }
  });

  it('puts each ticket in the bucket whose lower edge it has reached', async () => {
    const ctx = contextFor(tenant.id);
    const answer = await withContext(ctx, () => ticketService.countTicketsBy(ctx, { search: EDGE }, 'age', N));
    expect(answer.groups).toEqual([
      { key: 'under_1d', count: 1 },
      { key: '1d_3d', count: 1 },
      { key: '3d_7d', count: 1 },
      { key: '7d_30d', count: 2 },
      { key: 'over_30d', count: 1 },
    ]);
    expect(answer.total).toBe(6);
  });
});

describe('the guard', () => {
  const refused = async (query: string, detail = 'a grouped count needs open work or a date window') => {
    const response = await request<{ detail: string }>(`/api/v1/tickets/counts?q=${MARK}&${query}`, { token: tenant.people.admin!.token });
    expect(response.status, query).toBe(422);
    expect(response.body.detail, query).toBe(detail);
  };
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY).toISOString();

  it('refuses a count over the whole history', async () => {
    await refused('groupBy=priority');
    await refused('groupBy=assignee&filter[statusCategory]=open,resolved');
    await refused('groupBy=type&filter[statusCategory]=closed');
  });

  it('refuses a window longer than 400 days, or open at the start', async () => {
    await refused(`groupBy=priority&filter[createdAfter]=${daysAgo(401)}`);
    await refused(`groupBy=priority&filter[createdAfter]=${daysAgo(800)}&filter[createdBefore]=${daysAgo(399)}`);
    await refused(`groupBy=priority&filter[createdBefore]=${daysAgo(1)}`);
    await refused(`groupBy=priority&filter[resolvedAfter]=${daysAgo(500)}`);
  });

  it('does not count a due window as a date window', async () => {
    await refused(`groupBy=priority&filter[dueAfter]=${daysAgo(1)}&filter[dueBefore]=${daysAgo(0)}`);
  });

  it('accepts open work, a window of up to 400 days, or an SLA filter', async () => {
    await counts('admin', 'groupBy=priority&filter[statusCategory]=open');
    await counts('admin', 'groupBy=priority&filter[statusCategory]=paused');
    await counts('admin', `groupBy=priority&filter[createdAfter]=${daysAgo(400)}&filter[createdBefore]=${daysAgo(0)}`);
    await counts('admin', `groupBy=priority&filter[resolvedAfter]=${daysAgo(30)}`);
    await counts('admin', 'groupBy=priority&filter[sla]=due_soon');
  });

  it('refuses age over closed work without a window', async () => {
    await refused('groupBy=age&filter[statusCategory]=resolved');
  });

  it('refuses an SLA breakdown of work that has no SLA bucket', async () => {
    await refused(
      `groupBy=sla&filter[statusCategory]=open,resolved&filter[createdAfter]=${daysAgo(30)}`,
      'an SLA breakdown counts open and paused work only',
    );
  });

  it('refuses a dimension it does not know, or none', async () => {
    for (const query of ['groupBy=colour&filter[statusCategory]=open', 'filter[statusCategory]=open']) {
      const response = await request(`/api/v1/tickets/counts?${query}`, { token: tenant.people.admin!.token });
      expect(response.status, query).toBe(422);
    }
  });

  it('checks windows as the list does', async () => {
    await refused(`groupBy=priority&filter[createdAfter]=${daysAgo(1)}&filter[createdBefore]=${daysAgo(2)}`, 'the window ends before it starts');
  });
});

describe('the route', () => {
  it('answers with the grouped shape, not a ticket called "counts"', async () => {
    const response = await request<Record<string, unknown>>(`/api/v1/tickets/counts?groupBy=priority&${LIVE}`, { token: tenant.people.agent!.token });
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['applied', 'groupBy', 'groups', 'total']);
  });

  it('echoes the filters it honoured, and not the ones it implied', async () => {
    expect((await counts('admin', `groupBy=priority&${LIVE}&filter[sla]=breached`)).applied).toEqual(['sla', 'statusCategory']);
    expect((await counts('admin', 'groupBy=age')).applied).toEqual([]);
  });

  it('needs a signed-in caller', async () => {
    expect((await request(`/api/v1/tickets/counts?groupBy=priority&${LIVE}`)).status).toBe(401);
  });
});

describe('scope', () => {
  it('a team-scoped agent counts only what their team may see', async () => {
    const mine = await counts('agent', `groupBy=group&${LIVE}`);
    expect(mine.groups.map((group) => group.key)).not.toContain(tenant.otherTeamId);
    expect(asMap(mine.groups)[tenant.teamId]).toBe(3);

    const theirs = await counts('otherAgent', `groupBy=group&${LIVE}`);
    expect(theirs.groups.map((group) => group.key)).not.toContain(tenant.teamId);
    expect(asMap(theirs.groups)[tenant.otherTeamId]).toBe(1);
  });

  it('a requester counts only their own', async () => {
    const own = await counts('requester', `groupBy=priority&${LIVE}`);
    expect(own.groups).toEqual([
      { key: 'P1', count: 1 },
      { key: 'P2', count: 1 },
      { key: 'P3', count: 1 },
    ]);
    const other = await counts('otherRequester', `groupBy=priority&${LIVE}`);
    expect(other.groups).toEqual([
      { key: 'P2', count: 1 },
      { key: 'P4', count: 1 },
    ]);
  });
});

describe('tenant isolation', () => {
  it('grouped counts never cross tenants', async () => {
    // Identical fixtures in both tenants: a leak would double every figure.
    for (const groupBy of ticketService.COUNT_DIMENSIONS) {
      const mine = await counts('admin', `groupBy=${groupBy}&${LIVE}`);
      const theirs = await counts('admin', `groupBy=${groupBy}&${LIVE}`, twin);
      expect(mine.total, groupBy).toBe(5);
      expect(theirs.total, groupBy).toBe(5);
    }

    const teams = (await counts('admin', `groupBy=group&${LIVE}`)).groups.map((group) => group.key);
    expect(teams).not.toContain(twin.teamId);
    expect(teams).not.toContain(twin.otherTeamId);

    const serviceKeys = (await counts('admin', `groupBy=service&${LIVE}`)).groups.map((group) => group.key);
    expect(serviceKeys).not.toContain(services.twinA);
    const twinServiceKeys = (await counts('admin', `groupBy=service&${LIVE}`, twin)).groups.map((group) => group.key);
    expect(twinServiceKeys).toEqual([services.twinA, null]);

    const people = (await counts('admin', `groupBy=assignee&${LIVE}`)).groups.map((group) => group.key);
    expect(people).not.toContain(twin.people.agent!.id);
    expect(people).not.toContain(twin.people.otherAgent!.id);
  });

  it('a token for one tenant counts nothing of the other, whatever it asks', async () => {
    const asked = await counts('admin', `groupBy=group&${LIVE}&filter[group]=${twin.teamId}`);
    expect(asked.total).toBe(0);
    expect(asked.groups).toEqual([]);
  });
});
