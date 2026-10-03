import { describe, expect, it } from 'vitest';
import { TWENTY_FOUR_SEVEN, type BusinessCalendar } from '@itsm/business-time';
import { systemContext, type Tx } from '@itsm/platform';
import { OFFICE_HOURS } from '../seed/default-policy.js';
import { nextUpdateCycle, restartUpdateCycle, type CycleTimer } from '../service/timer-service.js';

/**
 * The SLA update cycle (F1, ADR-0057), without a database.
 *
 * The integration suite (`tests/integration/sla-update-cycle.test.ts`) proves
 * the cycle end to end through the API. What it cannot do cheaply is stand on
 * a Friday evening or on the morning the clocks go back, and those are where
 * a due time computed in the wrong zone or on the wrong calendar shows. So the
 * maths is a pure function and is pinned here at those instants.
 */

const MINUTE = 60_000;
/** The P3 update target in the default policy: eight business hours. */
const P3_UPDATE = 480 * MINUTE;

/** The UK office calendar every new tenant gets: Friday closes at 17:00. */
const UK_OFFICE: BusinessCalendar = { timeZone: 'Europe/London', hours: OFFICE_HOURS };
/** A round-the-clock calendar that keeps London time, so the clocks going back is a 25-hour day. */
const LONDON_ALL_DAY: BusinessCalendar = { ...TWENTY_FOUR_SEVEN, timeZone: 'Europe/London' };

function runningTimer(overrides: Partial<CycleTimer> = {}): CycleTimer {
  return {
    state: 'running',
    targetMs: P3_UPDATE,
    elapsedMs: 0,
    startedAt: new Date('2026-10-14T08:00:00.000Z'),
    lastResumedAt: new Date('2026-10-14T08:00:00.000Z'),
    pausedAt: null,
    cycle: 1,
    ...overrides,
  };
}

describe('the next cycle of a running update timer', () => {
  it('meets the cycle at half the target and starts the next with the whole target', () => {
    // Wednesday 14 October 2026, 09:00 to 13:00 BST: four of the eight hours.
    const at = new Date('2026-10-14T12:00:00.000Z');
    const next = nextUpdateCycle(runningTimer(), { at, calendar: UK_OFFICE, thresholds: [50, 75, 90], ticketPaused: false });

    expect(next.state).toBe('running');
    expect(next.previous).toBe('met');
    expect(next.cycle).toBe(2);
    expect(next.cycleStartedAt).toEqual(at);
    expect(next.elapsedMs).toBe(240 * MINUTE);
    expect(next.remainingMs).toBe(P3_UPDATE);
    expect(next.warningsFired).toEqual([]);
    expect(next.lastResumedAt).toEqual(at);
    // 13:00 + 8 business hours: 4h 30m to 17:30, then 3h 30m on Thursday.
    expect(next.dueAt).toEqual(new Date('2026-10-15T11:30:00.000Z'));
    // The first warning is half the new target into the new cycle.
    expect(next.nextWarningAt).toEqual(new Date('2026-10-14T16:00:00.000Z'));
    expect(next.opensPause).toBe(false);
  });

  it('carries on counting from the cycle it is in', () => {
    const at = new Date('2026-10-14T12:00:00.000Z');
    const next = nextUpdateCycle(runningTimer({ cycle: 4, elapsedMs: 900 * MINUTE }), {
      at,
      calendar: UK_OFFICE,
      thresholds: [],
      ticketPaused: false,
    });
    expect(next.cycle).toBe(5);
    expect(next.elapsedMs).toBe((900 + 240) * MINUTE);
    expect(next.nextWarningAt).toBeNull();
  });
});

describe('a reply at the edge of the working week', () => {
  it('a reply at 17:29 on a Friday is due by 17:00 on Monday', () => {
    // Friday 16 October 2026 closes at 17:00 BST, so nothing of the new cycle
    // can be spent on Friday: it starts at 09:00 on Monday and needs all eight
    // hours of it.
    const at = new Date('2026-10-16T16:29:00.000Z'); // 17:29 BST
    const next = nextUpdateCycle(runningTimer({ lastResumedAt: new Date('2026-10-16T12:00:00.000Z') }), {
      at,
      calendar: UK_OFFICE,
      thresholds: [50],
      ticketPaused: false,
    });

    // Only business time is banked: 13:00 to 17:00, not to 17:29.
    expect(next.elapsedMs).toBe(240 * MINUTE);
    expect(next.dueAt).toEqual(new Date('2026-10-19T16:00:00.000Z')); // Monday 17:00 BST
    expect(next.nextWarningAt).toEqual(new Date('2026-10-19T12:00:00.000Z')); // Monday 13:00 BST
  });

  it('a reply at 16:59 on a Friday spends its last minute and the remainder on Monday', () => {
    const at = new Date('2026-10-16T15:59:00.000Z'); // 16:59 BST
    const next = nextUpdateCycle(runningTimer({ lastResumedAt: at }), {
      at,
      calendar: UK_OFFICE,
      thresholds: [],
      ticketPaused: false,
    });
    // One minute on Friday, 479 from Monday 09:00: 16:59 on Monday.
    expect(next.dueAt).toEqual(new Date('2026-10-19T15:59:00.000Z'));
  });
});

describe('the day the clocks go back (Sunday 25 October 2026)', () => {
  it('lands a cycle that crosses the weekend on Monday in GMT', () => {
    // Friday 23 October, 15:00 BST: two hours on Friday, six on Monday. Monday
    // is in GMT, so 15:00 local is 15:00 UTC, not the 14:00 a fixed offset
    // would give.
    const at = new Date('2026-10-23T14:00:00.000Z');
    const next = nextUpdateCycle(runningTimer({ lastResumedAt: at }), {
      at,
      calendar: UK_OFFICE,
      thresholds: [],
      ticketPaused: false,
    });
    expect(next.dueAt).toEqual(new Date('2026-10-26T15:00:00.000Z'));
  });

  it('counts the repeated hour on a round-the-clock London calendar', () => {
    // 01:45 BST, fifteen minutes before 02:00 BST becomes 01:00 GMT. A 30-minute
    // P1 update cycle ends 30 real minutes later, inside the repeated hour.
    const at = new Date('2026-10-25T00:45:00.000Z');
    const next = nextUpdateCycle(runningTimer({ targetMs: 30 * MINUTE, lastResumedAt: at }), {
      at,
      calendar: LONDON_ALL_DAY,
      thresholds: [],
      ticketPaused: false,
    });
    expect(next.dueAt).toEqual(new Date('2026-10-25T01:15:00.000Z'));
  });

  it('gives a day-long cycle across the change 24 real hours', () => {
    // Saturday 12:00 BST to Sunday 11:00 GMT: 24 real hours, though the clock
    // face moved 23. A cycle is measured in time that passed.
    const at = new Date('2026-10-24T11:00:00.000Z');
    const next = nextUpdateCycle(runningTimer({ targetMs: 1440 * MINUTE, lastResumedAt: at }), {
      at,
      calendar: LONDON_ALL_DAY,
      thresholds: [],
      ticketPaused: false,
    });
    expect(next.dueAt).toEqual(new Date('2026-10-25T11:00:00.000Z'));
  });
});

describe('a reply while the ticket waits on someone', () => {
  it('starts the next cycle paused, with no due time until the clock resumes', () => {
    const pausedAt = new Date('2026-10-14T10:00:00.000Z');
    const at = new Date('2026-10-14T12:00:00.000Z');
    const next = nextUpdateCycle(
      runningTimer({ state: 'paused', pausedAt, elapsedMs: 120 * MINUTE }),
      { at, calendar: UK_OFFICE, thresholds: [50], ticketPaused: true },
    );
    expect(next.state).toBe('paused');
    expect(next.cycle).toBe(2);
    expect(next.dueAt).toBeNull();
    expect(next.nextWarningAt).toBeNull();
    // The whole target waits for the resume, and paused time is not banked.
    expect(next.remainingMs).toBe(P3_UPDATE);
    expect(next.elapsedMs).toBe(120 * MINUTE);
    // Still the same pause: no second pause row.
    expect(next.pausedAt).toEqual(pausedAt);
    expect(next.opensPause).toBe(false);
  });
});

describe('a reply after a missed cycle (U5)', () => {
  it('runs again, and says the cycle it closed was breached', () => {
    const at = new Date('2026-10-15T12:00:00.000Z');
    const next = nextUpdateCycle(runningTimer({ state: 'breached', lastResumedAt: new Date('2026-10-14T08:00:00.000Z') }), {
      at,
      calendar: UK_OFFICE,
      thresholds: [],
      ticketPaused: false,
    });
    expect(next.state).toBe('running');
    expect(next.previous).toBe('breached');
    expect(next.dueAt).toEqual(new Date('2026-10-16T11:30:00.000Z'));
  });

  it('pauses with the ticket, opening the pause a breached timer never had', () => {
    const at = new Date('2026-10-15T12:00:00.000Z');
    const next = nextUpdateCycle(runningTimer({ state: 'breached' }), {
      at,
      calendar: UK_OFFICE,
      thresholds: [],
      ticketPaused: true,
    });
    expect(next.state).toBe('paused');
    expect(next.pausedAt).toEqual(at);
    expect(next.dueAt).toBeNull();
    expect(next.opensPause).toBe(true);
    expect(next.previous).toBe('breached');
  });
});

// ---------------------------------------------------------------------------
// restartUpdateCycle against an in-memory transaction: which timers it
// touches, what it writes and what it publishes. The rows are the shapes the
// Prisma client returns; only the calls the function makes are implemented.
// ---------------------------------------------------------------------------

const TENANT = '00000000-0000-4000-8000-0000000000aa';
const TICKET = '00000000-0000-4000-8000-0000000000bb';
const TIMER = '00000000-0000-4000-8000-0000000000cc';
const POLICY = '00000000-0000-4000-8000-0000000000dd';

interface FakeTimer extends CycleTimer {
  id: string;
  ticketId: string;
  targetType: string;
  policyId: string;
  calendarId: string | null;
  metAt: Date | null;
  breachedAt: Date | null;
}

function fakeTx(options: { status: string; timer?: Partial<FakeTimer> | null }) {
  const timer: FakeTimer | null =
    options.timer === null
      ? null
      : {
          ...runningTimer(),
          id: TIMER,
          ticketId: TICKET,
          targetType: 'update',
          policyId: POLICY,
          calendarId: null,
          metAt: null,
          breachedAt: null,
          ...options.timer,
        };
  const writes = {
    updates: [] as Record<string, unknown>[],
    pauses: [] as Record<string, unknown>[],
    events: [] as { type: string; envelope: { payload: Record<string, unknown> } }[],
  };
  const tx = {
    slaTimer: {
      findFirst: async ({ where }: { where: { state: { in: string[] }; metAt: null } }) =>
        timer && where.state.in.includes(timer.state) && timer.metAt === null ? timer : null,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.updates.push(data);
        return timer;
      },
    },
    ticket: { findFirst: async () => ({ status: options.status }) },
    slaTarget: { findFirst: async () => ({ warningThresholds: [50, 75, 90] }) },
    businessCalendar: { findFirst: async () => null },
    slaPause: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.pauses.push(data);
        return data;
      },
    },
    outboxEvent: {
      create: async ({ data }: { data: { type: string; envelope: { payload: Record<string, unknown> } } }) => {
        writes.events.push(data);
        return data;
      },
    },
  };
  return { tx: tx as unknown as Tx, writes };
}

const ctx = systemContext(TENANT);

describe('restartUpdateCycle', () => {
  it('restarts a running update timer on an open ticket and publishes sla.timer.restarted', async () => {
    const { tx, writes } = fakeTx({ status: 'in_progress' });
    const at = new Date('2026-10-14T12:00:00.000Z');

    expect(await restartUpdateCycle(ctx, tx, TICKET, at)).toBe(true);

    expect(writes.updates).toHaveLength(1);
    expect(writes.updates[0]).toMatchObject({ state: 'running', cycle: 2, cycleStartedAt: at, warningsFired: [] });
    expect(writes.pauses).toEqual([]);
    expect(writes.events.map((event) => event.type)).toEqual(['sla.timer.restarted']);
    expect(writes.events[0]!.envelope.payload).toEqual({
      timerId: TIMER,
      ticketId: TICKET,
      targetType: 'update',
      cycle: 2,
      // No calendar on the timer: around the clock, eight hours later.
      dueAt: '2026-10-14T20:00:00.000Z',
      previous: 'met',
    });
  });

  it('pauses a breached timer with the ticket and opens its pause row with the ticket’s reason', async () => {
    const { tx, writes } = fakeTx({
      status: 'pending_third_party',
      timer: { state: 'breached', breachedAt: new Date('2026-10-14T16:00:00.000Z') },
    });
    const at = new Date('2026-10-15T09:00:00.000Z');

    expect(await restartUpdateCycle(ctx, tx, TICKET, at)).toBe(true);

    expect(writes.updates[0]).toMatchObject({ state: 'paused', dueAt: null, pausedAt: at });
    // `breachedAt` is not written, so the verdict stays breached.
    expect(writes.updates[0]).not.toHaveProperty('breachedAt');
    expect(writes.pauses).toEqual([
      expect.objectContaining({ tenantId: TENANT, timerId: TIMER, reason: 'pending_third_party', from: at }),
    ]);
    expect(writes.events[0]!.envelope.payload).toMatchObject({ dueAt: null, previous: 'breached', cycle: 2 });
  });

  it.each(['resolved', 'closed', 'cancelled'])('leaves a %s ticket’s verdict alone', async (status) => {
    const { tx, writes } = fakeTx({ status, timer: { state: 'breached', breachedAt: new Date('2026-10-14T16:00:00.000Z') } });
    expect(await restartUpdateCycle(ctx, tx, TICKET)).toBe(false);
    expect(writes.updates).toEqual([]);
    expect(writes.events).toEqual([]);
  });

  it('does nothing to a timer that was stopped at resolution after a breach', async () => {
    // U6 stops such a timer as `breached` with `metAt` set; it is final even
    // if the ticket is later reopened.
    const { tx, writes } = fakeTx({
      status: 'reopened',
      timer: { state: 'breached', breachedAt: new Date('2026-10-14T16:00:00.000Z'), metAt: new Date('2026-10-15T10:00:00.000Z') },
    });
    expect(await restartUpdateCycle(ctx, tx, TICKET)).toBe(false);
    expect(writes.updates).toEqual([]);
  });

  it.each(['met', 'cancelled'])('does nothing to a %s timer', async (state) => {
    const { tx, writes } = fakeTx({ status: 'in_progress', timer: { state } });
    expect(await restartUpdateCycle(ctx, tx, TICKET)).toBe(false);
    expect(writes.updates).toEqual([]);
  });

  it('does nothing when the policy has no update target', async () => {
    const { tx, writes } = fakeTx({ status: 'in_progress', timer: null });
    expect(await restartUpdateCycle(ctx, tx, TICKET)).toBe(false);
    expect(writes.events).toEqual([]);
  });
});
