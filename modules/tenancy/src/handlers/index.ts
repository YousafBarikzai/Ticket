import { defineHandler, type TenantContext, type Tx } from '@itsm/platform';
import { measure, note, set } from '../service/usage-service.js';

/**
 * MOD-21 watches what it charges for.
 *
 * Two shapes, for the two kinds of meter. A **counted** one moves by a
 * delta as each event lands, because the thing being counted has just
 * happened and nothing else knows how many there have been. A **live** one
 * is re-measured from the source rows, because the question is "how many
 * are there now" and a delta would be an answer that drifts — a person
 * given two roles is not two agents, and an attachment deleted is space
 * returned that no event announces.
 *
 * Re-measuring on each event is a small query on a small table; the nightly
 * recompute exists for the cases no event reaches at all.
 */

async function remeasure(ctx: TenantContext, tx: Tx, meter: 'agents' | 'storage'): Promise<void> {
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
    // A migration's history is not this month's work (ADR-0038). MOD-24
    // publishes `ticket.imported`, which nothing here listens for; this is
    // the belt to that brace, for anything raised through the import
    // channel by another route.
    if (channel === 'import') return;
    await note(ctx, tx, 'tickets', 1);
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
