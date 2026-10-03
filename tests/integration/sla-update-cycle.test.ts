import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addBusinessMs } from '@itsm/business-time';
import { transaction, withContext, type TenantContext, type Tx } from '@itsm/platform';
import { tickPartition, timerService } from '@itsm/module-sla';
import { ticketService } from '@itsm/module-ticket';
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
 * The SLA update cycle (F1, ADR-0057), R2a, and attainment counting only the
 * targets a policy defines.
 *
 * Before F1 nothing ever met or restarted an `update` timer: it stopped only
 * at resolution, so it behaved as a second, shorter resolution clock, every P3
 * open longer than a working day breached it, and attainment read 55–65 % on
 * realistic data. The promise an update target makes is "you will hear from
 * us at least this often", and these cases are that promise, kept and broken:
 * an agent's reply keeps it and starts the next cycle; a requester's reply, an
 * internal note or an automated message does not; a missed cycle breaches once
 * however many cycles are missed; and a cancelled timer counts for nothing.
 *
 * Time is moved the honest way: a timer's due time is put in the past and the
 * real tick (`tickPartition`) runs, so the breach goes through the same code
 * as production's minute scheduler.
 *
 * Cases 1–12 are A4 §5.1's list; the R2a rows follow them.
 */

const MINUTE = 60_000;

let tenant: TestTenant;
let attainment: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('sla-update-cycle');
  attainment = await createTestTenant('sla-attainment');
}, 180_000);

afterAll(async () => {
  await deleteTestTenant('sla-update-cycle');
  await deleteTestTenant('sla-attainment');
  await closeHarness();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctxOf(t: TestTenant = tenant): TenantContext {
  return { ...contextFor(t.id), organisationIds: [t.orgId] };
}

async function read<T>(fn: (tx: Tx) => Promise<T>, t: TestTenant = tenant): Promise<T> {
  const context = ctxOf(t);
  return withContext(context, () => transaction(context, fn));
}

/** A P3 incident from the requester, in the agent's team, under the default policy. */
async function raise(title: string, t: TestTenant = tenant): Promise<string> {
  const response = await request<{ id: string }>('/api/v1/tickets', {
    method: 'POST',
    token: t.people.admin!.token,
    body: { type: 'incident', title, priority: 'P3', requesterId: t.people.requester!.id, groupId: t.teamId },
  });
  expect(response.status).toBe(201);
  return response.body.id;
}

async function comment(
  ticketId: string,
  who: 'agent' | 'requester',
  visibility: 'public' | 'internal' = 'public',
  t: TestTenant = tenant,
): Promise<void> {
  const response = await request(`/api/v1/tickets/${ticketId}/comments`, {
    method: 'POST',
    token: t.people[who]!.token,
    body: { body: `${who} writes (${visibility})`, visibility },
  });
  expect(response.status).toBe(201);
}

async function move(ticketId: string, to: string, t: TestTenant = tenant): Promise<void> {
  const response = await request(`/api/v1/tickets/${ticketId}/transitions`, {
    method: 'POST',
    token: t.people.agent!.token,
    body: { to, reason: 'update-cycle test' },
  });
  expect(response.status).toBe(200);
}

async function timerOf(ticketId: string, targetType: string, t: TestTenant = tenant) {
  const timer = await read((tx) => tx.slaTimer.findFirst({ where: { ticketId, targetType } }), t);
  expect(timer, `${targetType} timer for ${ticketId}`).not.toBeNull();
  return timer!;
}

async function ticketDueAt(ticketId: string): Promise<Date | null> {
  const ticket = await read((tx) => tx.ticket.findFirst({ where: { id: ticketId }, select: { dueAt: true } }));
  return ticket!.dueAt;
}

async function eventsFor(timerId: string, type: string, t: TestTenant = tenant) {
  return read((tx) => tx.outboxEvent.findMany({ where: { aggregateId: timerId, type }, orderBy: { createdAt: 'asc' } }), t);
}

/** Puts a timer's due time a second in the past and runs the real tick over its partition. */
async function missDeadline(ticketId: string, targetType: string, t: TestTenant = tenant): Promise<void> {
  const timer = await timerOf(ticketId, targetType, t);
  await read((tx) => tx.slaTimer.update({ where: { id: timer.id }, data: { dueAt: new Date(Date.now() - 1000) } }), t);
  const context = ctxOf(t);
  await withContext(context, () => tickPartition(context, timer.partition));
}

async function expectedDue(timer: { calendarId: string | null; targetMs: number }, from: Date): Promise<Date> {
  const calendar = await read((tx) => timerService.loadCalendar(tx, timer.calendarId));
  return addBusinessMs(from, timer.targetMs, calendar);
}

// ---------------------------------------------------------------------------
// Cases 1–12
// ---------------------------------------------------------------------------

describe('an agent reply', () => {
  let ticketId: string;

  it('(1) meets the current cycle and starts the next on the same row', async () => {
    ticketId = await raise('Update cycle: an agent reply keeps the promise');
    await drainEvents(tenant.id);

    const before = await timerOf(ticketId, 'update');
    expect(before).toMatchObject({ cycle: 1, cycleStartedAt: null, state: 'running' });
    expect(before.targetMs).toBe(480 * MINUTE);
    // As if the 50 % warning had fired before the agent got to it.
    await read((tx) => tx.slaTimer.update({ where: { id: before.id }, data: { warningsFired: [50] } }));

    await comment(ticketId, 'agent');
    await drainEvents(tenant.id);

    const after = await timerOf(ticketId, 'update');
    expect(after.id).toBe(before.id);
    expect(after.state).toBe('running');
    expect(after.cycle).toBe(2);
    expect(after.cycleStartedAt).not.toBeNull();
    expect(after.warningsFired).toEqual([]);
    expect(after.remainingMs).toBe(480 * MINUTE);
    expect(after.dueAt).toEqual(await expectedDue(after, after.cycleStartedAt!));
    expect(after.breachedAt).toBeNull();
    // Still one row per ticket and target.
    expect(await read((tx) => tx.slaTimer.count({ where: { ticketId, targetType: 'update' } }))).toBe(1);

    const restarted = await eventsFor(after.id, 'sla.timer.restarted');
    expect(restarted).toHaveLength(1);
    expect((restarted[0]!.envelope as { payload: unknown }).payload).toEqual({
      timerId: after.id,
      ticketId,
      targetType: 'update',
      cycle: 2,
      dueAt: after.dueAt!.toISOString(),
      previous: 'met',
    });

    // The response target is met by the same reply, exactly as before F1.
    expect((await timerOf(ticketId, 'response')).state).toBe('met');
  });

  it('(12) shows the cycle on GET /tickets/:id/sla', async () => {
    const response = await request<{ timers: { targetType: string; cycle: number; cycleStartedAt: string | null }[] }>(
      `/api/v1/tickets/${ticketId}/sla`,
      { token: tenant.people.agent!.token },
    );
    expect(response.status).toBe(200);
    const update = response.body.timers.find((timer) => timer.targetType === 'update')!;
    expect(update.cycle).toBe(2);
    expect(update.cycleStartedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    const resolution = response.body.timers.find((timer) => timer.targetType === 'resolution')!;
    expect(resolution).toMatchObject({ cycle: 1, cycleStartedAt: null });
  });
});

describe('what does not count as an update', () => {
  it('(2) a reply from the requester changes nothing', async () => {
    const ticketId = await raise('Update cycle: the requester writes in');
    await drainEvents(tenant.id);
    await comment(ticketId, 'requester');
    await drainEvents(tenant.id);

    const timer = await timerOf(ticketId, 'update');
    expect(timer).toMatchObject({ cycle: 1, cycleStartedAt: null, state: 'running' });
    expect(await eventsFor(timer.id, 'sla.timer.restarted')).toEqual([]);
  });

  it('(3) an internal note changes nothing', async () => {
    const ticketId = await raise('Update cycle: an internal note');
    await drainEvents(tenant.id);
    await comment(ticketId, 'agent', 'internal');
    await drainEvents(tenant.id);

    const timer = await timerOf(ticketId, 'update');
    expect(timer).toMatchObject({ cycle: 1, state: 'running' });
    expect(await eventsFor(timer.id, 'sla.timer.restarted')).toEqual([]);
    // Nor is it a response.
    expect((await timerOf(ticketId, 'response')).state).toBe('running');
  });

  it('(4) a public comment with no author changes nothing', async () => {
    // An automated acknowledgement tells the requester nothing new.
    const ticketId = await raise('Update cycle: an automated comment');
    await drainEvents(tenant.id);
    const context = ctxOf();
    await withContext(context, () =>
      ticketService.addComment(context, ticketId, { body: 'We have received your request.', visibility: 'public' }),
    );
    await drainEvents(tenant.id);

    const timer = await timerOf(ticketId, 'update');
    expect(timer).toMatchObject({ cycle: 1, state: 'running' });
    expect(await eventsFor(timer.id, 'sla.timer.restarted')).toEqual([]);
  });
});

describe('a reply while the ticket waits on the requester', () => {
  it('(5) starts the next cycle paused, then resumes it with the whole target', async () => {
    const ticketId = await raise('Update cycle: waiting on the requester');
    await drainEvents(tenant.id);
    await move(ticketId, 'pending_requester');
    await drainEvents(tenant.id);
    expect((await timerOf(ticketId, 'update')).state).toBe('paused');

    await comment(ticketId, 'agent');
    await drainEvents(tenant.id);

    const paused = await timerOf(ticketId, 'update');
    expect(paused).toMatchObject({ state: 'paused', cycle: 2, dueAt: null, nextWarningAt: null });
    expect(paused.remainingMs).toBe(paused.targetMs);
    const restarted = await eventsFor(paused.id, 'sla.timer.restarted');
    expect((restarted[0]!.envelope as { payload: { dueAt: unknown } }).payload.dueAt).toBeNull();

    await move(ticketId, 'in_progress');
    await drainEvents(tenant.id);

    const resumed = await timerOf(ticketId, 'update');
    expect(resumed.state).toBe('running');
    expect(resumed.cycle).toBe(2);
    expect(resumed.dueAt).toEqual(await expectedDue(resumed, resumed.lastResumedAt!));
  });
});

describe('a missed cycle', () => {
  let ticketId: string;

  it('(6) breaches once, carries on after the next reply, and never breaches twice', async () => {
    ticketId = await raise('Update cycle: the requester heard nothing');
    await drainEvents(tenant.id);

    await missDeadline(ticketId, 'update');
    const breached = await timerOf(ticketId, 'update');
    expect(breached.state).toBe('breached');
    expect(breached.breachedAt).not.toBeNull();
    expect(await read((tx) => tx.breachRecord.count({ where: { timerId: breached.id } }))).toBe(1);
    expect(await eventsFor(breached.id, 'sla.timer.breached')).toHaveLength(1);

    // The next reply starts the cadence again; the verdict stays breached.
    await drainEvents(tenant.id);
    await comment(ticketId, 'agent');
    await drainEvents(tenant.id);
    const running = await timerOf(ticketId, 'update');
    expect(running.state).toBe('running');
    expect(running.cycle).toBe(2);
    expect(running.breachedAt).toEqual(breached.breachedAt);
    const restarted = await eventsFor(running.id, 'sla.timer.restarted');
    expect((restarted[0]!.envelope as { payload: { previous: string } }).payload.previous).toBe('breached');

    // A second missed cycle: the row shows it, nothing else happens.
    await missDeadline(ticketId, 'update');
    const again = await timerOf(ticketId, 'update');
    expect(again.state).toBe('breached');
    expect(again.breachedAt).toEqual(breached.breachedAt);
    expect(await read((tx) => tx.breachRecord.count({ where: { timerId: again.id } }))).toBe(1);
    expect(await eventsFor(again.id, 'sla.timer.breached')).toHaveLength(1);
  });

  it('(7) ends breached at resolution, with no sla.timer.met', async () => {
    await comment(ticketId, 'agent');
    await drainEvents(tenant.id);
    expect((await timerOf(ticketId, 'update')).state).toBe('running');

    await move(ticketId, 'resolved');
    await drainEvents(tenant.id);

    const final = await timerOf(ticketId, 'update');
    expect(final.state).toBe('breached');
    expect(final.metAt).not.toBeNull();
    expect(final.dueAt).toBeNull();
    expect(await eventsFor(final.id, 'sla.timer.met')).toEqual([]);

    // And a reply after resolution does not reopen a promise already judged.
    await comment(ticketId, 'agent');
    await drainEvents(tenant.id);
    expect(await timerOf(ticketId, 'update')).toMatchObject({ state: 'breached', cycle: final.cycle });
  });
});

describe('resolution', () => {
  it('(8) with every cycle met, meets the update target', async () => {
    const ticketId = await raise('Update cycle: kept informed throughout');
    await drainEvents(tenant.id);
    await comment(ticketId, 'agent');
    await drainEvents(tenant.id);
    await move(ticketId, 'resolved');
    await drainEvents(tenant.id);

    const update = await timerOf(ticketId, 'update');
    expect(update).toMatchObject({ state: 'met', breachedAt: null, cycle: 2 });
    expect(await eventsFor(update.id, 'sla.timer.met')).toHaveLength(1);
  });
});

describe('cancelling', () => {
  it('(9) cancels every timer, says so, and the facts stop counting them', async () => {
    const ticketId = await raise('Update cycle: withdrawn by the requester');
    await drainEvents(tenant.id);
    await move(ticketId, 'cancelled');
    await drainEvents(tenant.id);

    const timers = await read((tx) => tx.slaTimer.findMany({ where: { ticketId } }));
    expect(timers.length).toBe(3);
    for (const timer of timers) {
      expect(timer.state).toBe('cancelled');
      expect(await eventsFor(timer.id, 'sla.timer.cancelled')).toHaveLength(1);
    }

    const facts = await read((tx) => tx.factSlaTimer.findMany({ where: { ticketId } }));
    expect(facts).toHaveLength(3);
    expect(facts.every((fact) => fact.outcome === 'cancelled')).toBe(true);
    expect(facts.every((fact) => fact.stoppedAt !== null)).toBe(true);
  });
});

describe('re-matching to a policy without an update target', () => {
  it('(10) cancels the update timer and keeps the ones the new policy defines', async () => {
    const title = 'Update cycle: re-matched to a policy that promises no updates';
    const ticketId = await raise(title);
    await drainEvents(tenant.id);
    expect((await timerOf(ticketId, 'update')).state).toBe('running');

    const policy = await request('/api/v1/sla-policies', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: {
        key: 'no-update-target',
        name: 'Response and resolution only',
        specificity: 900,
        match: { eq: [{ var: 'ticket.title' }, title] },
        targets: [
          { priority: 'P3', targetType: 'response', minutes: 240, warningThresholds: [50] },
          { priority: 'P3', targetType: 'resolution', minutes: 1440, warningThresholds: [75] },
        ],
      },
    });
    expect(policy.status).toBe(201);

    // What a classification after the ticket was raised does (ADR-0051).
    const context = ctxOf();
    const result = await withContext(context, () =>
      transaction(context, (tx) => timerService.rematchTimersForTicket(context, tx, ticketId)),
    );
    expect(result.cancelled).toBe(1);
    await drainEvents(tenant.id);

    const update = await timerOf(ticketId, 'update');
    expect(update.state).toBe('cancelled');
    expect(await eventsFor(update.id, 'sla.timer.cancelled')).toHaveLength(1);
    expect((await timerOf(ticketId, 'resolution')).state).toBe('running');
    const fact = await read((tx) => tx.factSlaTimer.findFirst({ where: { timerId: update.id } }));
    expect(fact?.outcome).toBe('cancelled');
  });
});

describe('attainment', () => {
  /**
   * (11) Twenty tickets whose verdicts are known in advance, in a tenant of
   * their own so nothing else is counted:
   *
   * | Tickets | Response | Update   | Resolution | Met | Breached |
   * |---------|----------|----------|------------|-----|----------|
   * | 10      | met      | met      | met        | 30  | 0        |
   * | 3       | met      | breached | met        | 6   | 3        |
   * | 3       | met      | met      | breached   | 6   | 3        |
   * | 4       | cancelled (all three)             | 0   | 0        |
   *
   * 42 met out of 48 judged = 87.5 %. The 12 cancelled timers are in neither
   * figure, and the 9 running timers of the harness's own tickets are not
   * judged yet.
   */
  it('(11) equals the expected rate exactly over a known fixture', async () => {
    const t = attainment;
    const raiseAll = async (label: string, count: number) => {
      const ids: string[] = [];
      for (let i = 0; i < count; i += 1) ids.push(await raise(`Attainment: ${label} ${i + 1}`, t));
      return ids;
    };
    const kept = await raiseAll('kept', 10);
    const updateMissed = await raiseAll('update missed', 3);
    const resolutionMissed = await raiseAll('resolution missed', 3);
    const cancelled = await raiseAll('cancelled', 4);
    await drainEvents(t.id, 10);

    for (const id of updateMissed) await missDeadline(id, 'update', t);
    for (const id of resolutionMissed) await missDeadline(id, 'resolution', t);
    await drainEvents(t.id, 10);

    for (const id of [...kept, ...updateMissed, ...resolutionMissed]) await comment(id, 'agent', 'public', t);
    await drainEvents(t.id, 10);
    for (const id of [...kept, ...updateMissed, ...resolutionMissed]) await move(id, 'resolved', t);
    for (const id of cancelled) await move(id, 'cancelled', t);
    await drainEvents(t.id, 10);

    const facts = await read((tx) => tx.factSlaTimer.findMany({}), t);
    const count = (outcome: string) => facts.filter((fact) => fact.outcome === outcome).length;
    expect({ met: count('met'), breached: count('breached'), cancelled: count('cancelled') }).toEqual({
      met: 42,
      breached: 6,
      cancelled: 12,
    });

    const response = await request<{ value: number }>('/api/v1/analytics/query', {
      method: 'POST',
      token: t.people.admin!.token,
      body: { metricKey: 'sla.attainment', range: '30d' },
    });
    expect(response.status).toBe(200);
    expect(response.body.value).toBe(87.5);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// R2a: the ticket's due time follows the resolution timer through a pause
// ---------------------------------------------------------------------------

describe("the ticket's due time through a pause (R2a)", () => {
  let ticketId: string;

  it('is cleared while the resolution clock is paused', async () => {
    ticketId = await raise('R2a: waiting on a supplier');
    await drainEvents(tenant.id);
    const resolution = await timerOf(ticketId, 'resolution');
    expect(await ticketDueAt(ticketId)).toEqual(resolution.dueAt);

    await move(ticketId, 'pending_third_party');
    await drainEvents(tenant.id);

    expect((await timerOf(ticketId, 'resolution')).state).toBe('paused');
    // A stale value would put a ticket that is waiting on someone else at the
    // top of "due soon".
    expect(await ticketDueAt(ticketId)).toBeNull();
  });

  it("comes back as the resolution timer's new due time when the clock resumes", async () => {
    await move(ticketId, 'in_progress');
    await drainEvents(tenant.id);

    const resolution = await timerOf(ticketId, 'resolution');
    expect(resolution.state).toBe('running');
    expect(resolution.dueAt).not.toBeNull();
    expect(await ticketDueAt(ticketId)).toEqual(resolution.dueAt);
  });

  it('is left alone when only other timers pause', async () => {
    // A ticket whose resolution target already breached keeps the due time it
    // missed: nothing paused the resolution clock, so nothing clears it.
    const id = await raise('R2a: resolution already missed');
    await drainEvents(tenant.id);
    await missDeadline(id, 'resolution');
    await drainEvents(tenant.id);
    const due = await ticketDueAt(id);
    expect(due).not.toBeNull();

    await move(id, 'pending_requester');
    await drainEvents(tenant.id);
    expect(await ticketDueAt(id)).toEqual(due);
  });
});
