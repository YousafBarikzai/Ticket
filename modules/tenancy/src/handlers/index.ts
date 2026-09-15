import { defineHandler, type TenantContext, type Tx } from '@itsm/platform';
import { measure, set } from '../service/usage-service.js';
import type { Meter } from '../domain/meters.js';

/**
 * MOD-21 watches what it charges for, by counting rather than by adding up.
 *
 * Every handler here re-measures its meter from the rows that define it.
 * None of them adds one. That is ADR-0031's rule, and it was reintroduced
 * and caught here the same way MOD-12's comment count was: delivery is at
 * least once, so an accumulating handler counts the same ticket again on
 * every redelivery, and a figure nobody can rebuild is a figure nobody can
 * defend. The event says look again; the rows say at what.
 *
 * This is a count per event, which the request path is forbidden from doing
 * (ADR-0038) — and a handler is not the request path. It runs in the
 * worker, over an indexed range, after the work is already done.
 *
 * The only thing in this module that accumulates is the API-call buffer,
 * which is drained exactly once because it is a counter and not an event.
 */

async function remeasure(ctx: TenantContext, tx: Tx, meter: Meter): Promise<void> {
  const measured = await measure(ctx, tx, meter);
  if (measured !== null) await set(ctx, tx, meter, measured);
}

defineHandler({
  consumer: 'tenancy',
  moduleId: 'MOD-21',
  eventType: 'ticket.created',
  required: false,
  async handle(ctx, event, tx) {
    const { channel } = event.payload as { channel: string };
    // A migration's history is not this month's work (ADR-0038), and
    // `measure` excludes the import channel from the count it makes. This
    // early return only saves the query.
    if (channel === 'import') return;
    await remeasure(ctx, tx, 'tickets');
  },
});

for (const eventType of ['user.provisioned', 'user.deactivated', 'role.assignment.changed']) {
  defineHandler({
    consumer: 'tenancy',
    moduleId: 'MOD-21',
    eventType,
    required: false,
    async handle(ctx, _event, tx) {
      await remeasure(ctx, tx, 'agents');
    },
  });
}

defineHandler({
  consumer: 'tenancy',
  moduleId: 'MOD-21',
  eventType: 'ticket.attachment.added',
  required: false,
  async handle(ctx, _event, tx) {
    await remeasure(ctx, tx, 'storage');
  },
});
