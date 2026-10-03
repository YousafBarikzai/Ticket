import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { checkTicketDrift, rebuildDay } from '@itsm/module-analytics';
import { tickPartition } from '@itsm/module-sla';
import { outboxPublisher } from '@itsm/module-integrations';
import {
  closeHarness,
  contextFor,
  createTestTenant,
  deleteTestTenant,
  drainEvents,
  request,
  type TestTenant,
} from '../support/harness.js';

/**
 * The analytics projection pipeline (MOD-12-E1a).
 *
 * The unit tests prove the arithmetic; this proves the part that only shows up
 * against a database — that the facts follow the tickets, that a redelivered
 * event does not count twice, and that the nightly rebuild and the incremental
 * path arrive at the same numbers. The last of those is the one that matters,
 * because if they disagree then drift detection is measuring the design rather
 * than any real problem.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('analytics');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('analytics');
  await closeHarness();
});

function ctx() {
  return contextFor(tenant.id);
}

async function read<T>(fn: (tx: Parameters<Parameters<typeof transaction>[1]>[0]) => Promise<T>): Promise<T> {
  const context = ctx();
  return withContext(context, () => transaction(context, fn));
}

function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function raiseTicket(title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const response = await request<{ id: string; number: string }>('/api/v1/tickets', {
    method: 'POST',
    token: tenant.people.admin!.token,
    body: { type: 'incident', title, priority: 'P2', ...extra },
  });
  expect(response.status).toBe(201);
  await drainEvents(tenant.id);
  return response.body.id;
}

describe('a ticket becomes a fact', () => {
  it('projects one row per ticket, with the ticket as it stands', async () => {
    const ticketId = await raiseTicket('Projector: a laptop will not charge');

    const fact = await read((tx) => tx.factTicket.findFirst({ where: { ticketId } }));
    expect(fact).not.toBeNull();
    expect(fact!.status).toBe('new');
    expect(fact!.priority).toBe('P2');
    expect(fact!.createdDate).toEqual(today());
    // Idempotency is carried on the row, not inferred.
    expect(fact!.lastEventId).toEqual(expect.any(String));
  });

  it('fills the date dimension, so a quiet day still has a row', async () => {
    const day = await read((tx) => tx.dimDate.findUnique({ where: { date: today() } }));
    expect(day).not.toBeNull();
    expect(day!.year).toBe(today().getUTCFullYear());
  });

  it('records the channel it arrived on', async () => {
    const channels = await read((tx) => tx.dimChannel.findMany({}));
    expect(channels.map((row) => row.key)).toContain('api');
  });

  it('counts the ticket in the headline rollup and in its own team', async () => {
    const rows = await read((tx) => tx.rollupTicketDaily.findMany({ where: { date: today() } }));
    const all = rows.find((row) => row.groupingKey === 'all');
    expect(all!.created).toBeGreaterThanOrEqual(1);
    // The same ticket, counted again under a narrower grouping — a breakdown,
    // not a second ticket.
    const byPriority = rows.find((row) => row.groupingKey === 'priority:P2');
    expect(byPriority!.created).toBeGreaterThanOrEqual(1);
    expect(byPriority!.created).toBeLessThanOrEqual(all!.created);
  });
});

describe('a redelivered event', () => {
  it('does not count the ticket twice', async () => {
    const ticketId = await raiseTicket('Projector: redelivery must be harmless');

    const before = await read((tx) => tx.rollupTicketDaily.findFirst({ where: { date: today(), groupingKey: 'all' } }));
    const envelope = await read((tx) =>
      tx.outboxEvent.findFirst({ where: { type: 'ticket.created', aggregateId: ticketId } }),
    );
    expect(envelope).not.toBeNull();

    // Exactly what a queue redelivery looks like from the consumer's side.
    const outcome = await outboxPublisher.dispatchToConsumer('analytics', envelope!.envelope as never);
    expect(outcome).toBe('duplicate');

    const after = await read((tx) => tx.rollupTicketDaily.findFirst({ where: { date: today(), groupingKey: 'all' } }));
    expect(after!.created).toBe(before!.created);

    const facts = await read((tx) => tx.factTicket.count({ where: { ticketId } }));
    expect(facts).toBe(1);
  });
});

describe('a ticket that moves', () => {
  it('takes its counts with it when it changes team', async () => {
    const ticketId = await raiseTicket('Projector: routing moves the numbers', { groupId: tenant.teamId });

    const before = await read((tx) =>
      tx.rollupTicketDaily.findFirst({ where: { date: today(), groupingKey: `team:${tenant.teamId}` } }),
    );
    expect(before!.created).toBeGreaterThanOrEqual(1);

    // Routing is an assignment, not an edit: the group moves through the
    // assign endpoint, which is also what a rule or a strategy calls.
    const moved = await request(`/api/v1/tickets/${ticketId}/assign`, {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { groupId: tenant.otherTeamId },
    });
    expect(moved.status).toBe(200);
    await drainEvents(tenant.id);

    const after = await read((tx) =>
      tx.rollupTicketDaily.findFirst({ where: { date: today(), groupingKey: `team:${tenant.teamId}` } }),
    );
    const destination = await read((tx) =>
      tx.rollupTicketDaily.findFirst({ where: { date: today(), groupingKey: `team:${tenant.otherTeamId}` } }),
    );

    // One out of the old team, one into the new one. A projection that only
    // added to the new team would leave the old team's chart permanently high.
    expect(after!.created).toBe(before!.created - 1);
    expect(destination!.created).toBeGreaterThanOrEqual(1);
  });
});

describe('resolving a ticket', () => {
  it('records when it resolved and how long it took', async () => {
    const ticketId = await raiseTicket('Projector: resolution fills the durations');

    for (const status of ['in_progress', 'resolved']) {
      const response = await request(`/api/v1/tickets/${ticketId}/transitions`, {
        method: 'POST',
        token: tenant.people.admin!.token,
        body: { to: status, reason: 'projection test' },
      });
      expect([200, 201]).toContain(response.status);
      await drainEvents(tenant.id);
    }

    const fact = await read((tx) => tx.factTicket.findFirst({ where: { ticketId } }));
    expect(fact!.status).toBe('resolved');
    expect(fact!.resolvedAt).not.toBeNull();
    // Both numbers, because both get asked for and they answer different things.
    expect(fact!.timeToResolveMinutes).not.toBeNull();
    expect(fact!.elapsedToResolveMinutes).not.toBeNull();
  });

  it('counts the first public reply as the response, and only the first', async () => {
    const ticketId = await raiseTicket('Projector: the response clock stops once');

    for (const body of ['We are looking into this now.', 'Still looking.']) {
      const response = await request(`/api/v1/tickets/${ticketId}/comments`, {
        method: 'POST',
        token: tenant.people.agent!.token,
        body: { body, visibility: 'public' },
      });
      expect(response.status).toBe(201);
      await drainEvents(tenant.id);
    }

    const fact = await read((tx) => tx.factTicket.findFirst({ where: { ticketId } }));
    expect(fact!.commentCount).toBe(2);
    expect(fact!.firstResponseAt).not.toBeNull();
    expect(fact!.timeToFirstResponseMinutes).not.toBeNull();

    // The second reply must not push the first response later.
    const again = await request(`/api/v1/tickets/${ticketId}/comments`, {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { body: 'And again.', visibility: 'public' },
    });
    expect(again.status).toBe(201);
    await drainEvents(tenant.id);

    const later = await read((tx) => tx.factTicket.findFirst({ where: { ticketId } }));
    expect(later!.firstResponseAt).toEqual(fact!.firstResponseAt);
  });
});

describe('the SLA projection', () => {
  it('has a row for every timer the ticket started', async () => {
    const ticketId = await raiseTicket('Projector: timers become facts');

    const timers = await read((tx) => tx.factSlaTimer.findMany({ where: { ticketId } }));
    expect(timers.length).toBeGreaterThan(0);
    // A timer with no outcome yet is still a row: "how many are at risk right
    // now" is a question about exactly those.
    expect(timers.every((timer) => ['running', 'met', 'breached'].includes(timer.outcome))).toBe(true);
    expect(timers.every((timer) => timer.startedDate !== null)).toBe(true);
  });

  it('says breached for a timer that breached and was then met, however it is projected', async () => {
    // F1 (ADR-0057): an update timer that missed a cycle keeps running for
    // the cadence and is stopped at resolution with `metAt` set and its state
    // left `breached`. Before F1 a timer could not carry both, and the
    // projector put met first; a replay would now turn that miss into a met.
    const started = new Date(Date.now() - 1000);
    const ticketId = await raiseTicket('Projector: an update that came too late');
    const update = await read((tx) => tx.slaTimer.findFirst({ where: { ticketId, targetType: 'update' } }));
    expect(update).not.toBeNull();

    await read((tx) => tx.slaTimer.update({ where: { id: update!.id }, data: { dueAt: new Date(Date.now() - 1000) } }));
    const context = ctx();
    await withContext(context, () => tickPartition(context, update!.partition));
    await drainEvents(tenant.id);

    // The late reply restarts the cadence; the resolution stops the timer.
    const reply = await request(`/api/v1/tickets/${ticketId}/comments`, {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { body: 'Sorry for the wait.' },
    });
    expect(reply.status).toBe(201);
    await drainEvents(tenant.id);
    const resolved = await request(`/api/v1/tickets/${ticketId}/transitions`, {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { to: 'resolved' },
    });
    expect(resolved.status).toBe(200);
    await drainEvents(tenant.id);

    const timer = await read((tx) => tx.slaTimer.findFirst({ where: { id: update!.id } }));
    expect(timer!.breachedAt).not.toBeNull();
    expect(timer!.metAt).not.toBeNull();

    // A replay recomputes every fact from the rows as they stand now.
    const replay = await request('/api/v1/analytics/replay', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { from: started.toISOString() },
    });
    expect(replay.status).toBe(200);

    const fact = await read((tx) => tx.factSlaTimer.findFirst({ where: { timerId: update!.id } }));
    expect(fact!.outcome).toBe('breached');
    // It stopped when the ticket resolved, not when the cycle was missed.
    expect(fact!.stoppedAt).toEqual(timer!.metAt);
  });

  it('says cancelled for the timers of a cancelled ticket, which attainment then ignores', async () => {
    const ticketId = await raiseTicket('Projector: withdrawn before anyone looked');
    const cancelled = await request(`/api/v1/tickets/${ticketId}/transitions`, {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { to: 'cancelled', reason: 'raised in error' },
    });
    expect(cancelled.status).toBe(200);
    await drainEvents(tenant.id);

    const facts = await read((tx) => tx.factSlaTimer.findMany({ where: { ticketId } }));
    expect(facts.length).toBeGreaterThan(0);
    // Before F1 these stayed `running` for ever, because a cancellation
    // published nothing.
    expect(facts.map((fact) => fact.outcome)).toEqual(facts.map(() => 'cancelled'));
  });
});

describe('the nightly rebuild', () => {
  it('arrives at the same numbers as the incremental path', async () => {
    // The property the whole design rests on. If these disagree then the drift
    // check below is measuring the difference between two implementations
    // rather than between the projection and the truth.
    const before = await read((tx) => tx.rollupTicketDaily.findMany({ where: { date: today() }, orderBy: { groupingKey: 'asc' } }));
    expect(before.length).toBeGreaterThan(0);

    const context = ctx();
    await withContext(context, () => rebuildDay(context, today()));

    const after = await read((tx) => tx.rollupTicketDaily.findMany({ where: { date: today() }, orderBy: { groupingKey: 'asc' } }));
    expect(after.map((row) => row.groupingKey)).toEqual(before.map((row) => row.groupingKey));

    for (const [index, row] of after.entries()) {
      const original = before[index]!;
      expect({ key: row.groupingKey, created: row.created, resolved: row.resolved, closed: row.closed }).toEqual({
        key: original.groupingKey,
        created: original.created,
        resolved: original.resolved,
        closed: original.closed,
      });
      expect(row.resolveMinutesSum).toBe(original.resolveMinutesSum);
      expect(row.firstResponseMinutesCount).toBe(original.firstResponseMinutesCount);
    }
  });

  it('removes rows that no fact justifies any more', async () => {
    const context = ctx();
    // A day nothing happened on rebuilds to nothing, rather than keeping
    // whatever an earlier incremental write left behind.
    const quiet = new Date(Date.UTC(2020, 0, 6));
    await withContext(context, () => rebuildDay(context, quiet));
    const rows = await read((tx) => tx.rollupTicketDaily.findMany({ where: { date: quiet } }));
    expect(rows).toEqual([]);
  });
});

describe('drift detection', () => {
  // The check's window deliberately ends an hour ago, so that an event
  // published a second ago is not counted as drift. The tickets in this suite
  // are seconds old, so the check is asked as if it were running in two hours.
  const later = () => new Date(Date.now() + 2 * 60 * 60 * 1000);

  it('finds no drift when every event has been projected', async () => {
    const context = ctx();
    const result = await withContext(context, () => checkTicketDrift(context, { now: later() }));

    expect(result.expected).toBe(result.actual);
    expect(result.driftRatio).toBe(0);
    expect(result.breached).toBe(false);
  });

  it('notices when facts go missing, and writes down what it found', async () => {
    const context = ctx();
    const before = await withContext(context, () => checkTicketDrift(context, { now: later() }));
    expect(before.expected).toBeGreaterThan(0);

    // Deleting facts is exactly what a half-applied replay looks like from the
    // outside: the tickets are there, the projection is not.
    await read((tx) => tx.factTicket.deleteMany({}));

    const after = await withContext(context, () => checkTicketDrift(context, { now: later() }));
    expect(after.actual).toBe(0);
    expect(after.driftRatio).toBe(1);
    expect(after.breached).toBe(true);

    const recorded = await read((tx) => tx.projectionDrift.findMany({ orderBy: { checkedAt: 'desc' } }));
    expect(recorded[0]!.expected).toBe(after.expected);
    expect(recorded[0]!.actual).toBe(0);

    // And published, so a rule can act on it rather than somebody noticing.
    const published = await read((tx) => tx.outboxEvent.findMany({ where: { type: 'analytics.drift.detected' } }));
    expect(published.length).toBeGreaterThan(0);
  });
});
