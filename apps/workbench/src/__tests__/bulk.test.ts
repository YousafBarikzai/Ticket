import { describe, expect, it } from 'vitest';
import { ApiError } from '@itsm/sdk';
import {
  BULK_CONCURRENCY,
  bulkSummary,
  failureReason,
  planBulk,
  runBulk,
  statusChoices,
  tally,
  type ListRow,
} from '../inbox/queries.js';

/**
 * Bulk changes from the inbox list (SPEC §6.2): the engine and its words.
 *
 * What matters to the person at the desk: never more than four writes in
 * flight, Cancel stops sending (and says what was never sent), every ticket
 * is accounted for, a change that cannot apply is skipped with the reason
 * rather than sent to fail, and the toast tells the truth.
 */

const ME = 'me-0000';

function row(number: string, overrides: Partial<ListRow> = {}): ListRow {
  return {
    id: `id-${number}`,
    number,
    type: 'incident',
    title: number,
    status: 'in_progress',
    statusCategory: 'open',
    priority: 'P3',
    requesterId: null,
    assigneeId: null,
    groupId: null,
    dueAt: null,
    createdAt: '2026-09-30T08:00:00Z',
    updatedAt: '2026-09-30T09:00:00Z',
    version: 3,
    ...overrides,
  };
}

/** A write that finishes when told to, so a test can see what is in flight. */
function gate<T>() {
  const pending: { item: T; resolve(): void; reject(error: unknown): void }[] = [];
  let inFlight = 0;
  let most = 0;
  const work = (item: T) =>
    new Promise<string>((resolve, reject) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      pending.push({
        item,
        resolve: () => {
          inFlight -= 1;
          resolve(`done ${String(item)}`);
        },
        reject: (error) => {
          inFlight -= 1;
          reject(error);
        },
      });
    });
  return {
    work,
    pending,
    get inFlight() {
      return inFlight;
    },
    get most() {
      return most;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('runBulk', () => {
  it('keeps at most four writes in flight and reports every item in order', async () => {
    const items = Array.from({ length: 10 }, (_, index) => index);
    const writes = gate<number>();
    const settled: number[] = [];
    const running = runBulk(items, writes.work, { onSettled: (_outcome, count) => settled.push(count) });
    await tick();
    expect(BULK_CONCURRENCY).toBe(4);
    expect(writes.inFlight).toBe(4);

    // Finish them out of order: the results still come back in the items' order.
    while (writes.pending.length > 0) {
      const next = writes.pending.pop()!;
      next.resolve();
      await tick();
      expect(writes.inFlight).toBeLessThanOrEqual(4);
    }
    const results = await running;
    expect(writes.most).toBe(4);
    expect(results.map((result) => result.item)).toEqual(items);
    expect(results.every((result) => result.status === 'done')).toBe(true);
    expect(results[3]!.value).toBe('done 3');
    expect(settled).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('stops sending on Cancel: what was in flight finishes, the rest is never sent', async () => {
    const items = Array.from({ length: 10 }, (_, index) => index);
    const writes = gate<number>();
    const controller = new AbortController();
    const running = runBulk(items, writes.work, { signal: controller.signal });
    await tick();
    controller.abort();
    for (const entry of [...writes.pending]) entry.resolve();
    const results = await running;
    expect(results.filter((result) => result.status === 'done').map((result) => result.item)).toEqual([0, 1, 2, 3]);
    expect(results.filter((result) => result.status === 'cancelled').map((result) => result.item)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(writes.pending).toHaveLength(4);
  });

  it('carries on past a failure and keeps its error', async () => {
    const refused = new ApiError(409, null, 'changed');
    const results = await runBulk(['a', 'b', 'c'], async (item) => {
      if (item === 'b') throw refused;
      return item.toUpperCase();
    });
    expect(results.map((result) => result.status)).toEqual(['done', 'failed', 'done']);
    expect(results[1]!.error).toBe(refused);
  });

  it('does nothing, and says so, for an empty selection', async () => {
    expect(await runBulk([], async () => 'x')).toEqual([]);
    expect(bulkSummary(tally([], 0))).toEqual({ title: 'Nothing to update', tone: 'warning' });
  });
});

describe('planning a change', () => {
  it('skips tickets that already have it, with the reason, and sends the rest', () => {
    const rows = [row('INC-1', { assigneeId: ME }), row('INC-2'), row('INC-3', { assigneeId: 'jo' })];
    const plan = planBulk({ kind: 'assign', assigneeId: ME }, rows, ME);
    expect(plan.send.map((entry) => entry.number)).toEqual(['INC-2', 'INC-3']);
    expect(plan.skipped).toEqual([{ row: rows[0], reason: 'Already assigned to you' }]);
    expect(planBulk({ kind: 'assign', assigneeId: null }, rows, ME).skipped.map((skip) => skip.reason)).toEqual(['Already unassigned']);
  });

  it('skips a move the ticket’s state cannot make, rather than sending it to be refused', () => {
    const rows = [row('INC-1', { status: 'new' }), row('INC-2', { status: 'resolved', statusCategory: 'resolved' }), row('INC-3', { status: 'pending_requester' })];
    const plan = planBulk({ kind: 'status', to: 'in_progress' }, rows, ME);
    expect(plan.send.map((entry) => entry.number)).toEqual(['INC-1', 'INC-3']);
    expect(plan.skipped[0]!.reason).toBe('Can’t move from Resolved to In progress');
    expect(planBulk({ kind: 'status', to: 'new' }, [row('INC-4', { status: 'new' })], ME).skipped[0]!.reason).toBe('Already new');
  });

  it('skips a priority the ticket already has', () => {
    const plan = planBulk({ kind: 'priority', priority: 'P2' }, [row('INC-1', { priority: 'p2' }), row('INC-2')], ME);
    expect(plan.send.map((entry) => entry.number)).toEqual(['INC-2']);
    expect(plan.skipped[0]!.reason).toBe('Already P2');
  });

  it('offers only the moves every selected ticket can make', () => {
    expect(statusChoices([row('INC-1', { status: 'new' }), row('INC-2', { status: 'in_progress' })])).toEqual([
      'pending_requester',
      'pending_third_party',
      'pending_approval',
      'resolved',
      'cancelled',
    ]);
    expect(statusChoices([row('INC-1', { status: 'resolved' }), row('INC-2', { status: 'new' })])).toEqual([]);
    expect(statusChoices([row('INC-1', { status: 'somebody’s own state' })])).toEqual([]);
    expect(statusChoices([])).toEqual([]);
  });
});

describe('what the toast says', () => {
  it('counts what happened, never "done" when something was not', () => {
    expect(bulkSummary({ done: 3, failed: 0, skipped: 0, cancelled: 0 })).toEqual({ title: 'Updated 3 tickets', tone: 'success' });
    expect(bulkSummary({ done: 1, failed: 0, skipped: 0, cancelled: 0 }).title).toBe('Updated 1 ticket');
    expect(bulkSummary({ done: 11, failed: 0, skipped: 1, cancelled: 0 })).toEqual({ title: 'Updated 11 of 12 · 1 skipped', tone: 'warning' });
    expect(bulkSummary({ done: 9, failed: 2, skipped: 1, cancelled: 0 })).toEqual({ title: 'Updated 9 of 12 · 2 failed · 1 skipped', tone: 'danger' });
    expect(bulkSummary({ done: 4, failed: 0, skipped: 0, cancelled: 6 })).toEqual({ title: 'Updated 4 of 10 · 6 not started', tone: 'warning' });
    expect(bulkSummary({ done: 0, failed: 2, skipped: 0, cancelled: 0 })).toEqual({ title: 'Couldn’t update 2 tickets', tone: 'danger' });
    expect(bulkSummary({ done: 0, failed: 1, skipped: 0, cancelled: 0 }).title).toBe('Couldn’t update the ticket');
    expect(bulkSummary({ done: 0, failed: 0, skipped: 2, cancelled: 0 }).title).toBe('Nothing to change in 2 tickets');
  });

  it('gives each failure a reason a person can act on', () => {
    expect(failureReason(new ApiError(409, null, 'x'))).toBe('Someone changed it since it loaded');
    expect(failureReason(new ApiError(403, null, 'x'))).toBe('You can’t make this change');
    expect(failureReason(new ApiError(404, null, 'x'))).toBe('It no longer exists, or it’s outside your teams');
    expect(failureReason(new ApiError(0, null, 'x'))).toBe('No connection');
    expect(failureReason(new ApiError(503, null, 'x'))).toBe('The service had a problem');
    expect(failureReason(new ApiError(422, { type: 'about:blank', title: 'Invalid', status: 422, correlationId: 'c-1', detail: 'a reason is required' }, 'x'))).toBe(
      'a reason is required',
    );
    expect(failureReason(new Error('boom'))).toBe('Something went wrong');
  });
});
