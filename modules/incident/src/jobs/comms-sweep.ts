import { defineJob, logger, metrics, publish, transaction, type TenantContext } from '@itsm/platform';
import { events } from '@itsm/contracts';

/**
 * Notices when a promised update has not been posted.
 *
 * The promise is the product. An organisation told "we will update you every
 * thirty minutes" reorganises its morning around that, and the damage of
 * missing it is not the missing information — it is that every future promise
 * is discounted. People start ringing the service desk instead, which takes the
 * responders off the incident.
 *
 * The sweep reports; it does not write an update. A platform that posted
 * "we are still working on it" on somebody's behalf would keep the cadence and
 * destroy the thing the cadence is for.
 */
defineJob<Record<string, never>>('notify', 'incident.comms.sweep', async (_payload, { ctx }) => {
  await sweepOverdueComms(ctx);
});

/**
 * The sweep itself, callable without a queue.
 *
 * Separated from the job registration so a test can prove the behaviour rather
 * than prove that a job was registered. The two are not the same assertion, and
 * only one of them would have caught a due time that never moved.
 */
export async function sweepOverdueComms(ctx: TenantContext, now: Date = new Date()): Promise<number> {

  const overdue = await transaction(ctx, (tx) =>
    tx.majorIncident.findMany({
      where: {
        status: { notIn: ['resolved', 'closed', 'stood_down'] },
        nextUpdateDueAt: { lte: now },
      },
      orderBy: { nextUpdateDueAt: 'asc' },
      take: 200,
    }),
  );

  metrics.observe('incident_comms_overdue', overdue.length, {});
  if (overdue.length === 0) return 0;

  for (const incident of overdue) {
    const dueAt = incident.nextUpdateDueAt!;
    const overdueMinutes = Math.max(0, Math.round((now.getTime() - dueAt.getTime()) / 60_000));

    await transaction(ctx, async (tx) => {
      // The due time moves on by one interval rather than to "now + interval".
      // Moving it to now would let a long silence be reported once and then
      // forgotten; stepping it keeps the alarm ringing every interval it stays
      // unanswered, which is the behaviour somebody ignoring it deserves.
      await tx.majorIncident.update({
        where: { id: incident.id },
        data: { nextUpdateDueAt: new Date(dueAt.getTime() + incident.updateIntervalMinutes * 60_000) },
      });
      await publish(tx, ctx, {
        definition: events.incidentMajorUpdateOverdue,
        aggregateId: incident.id,
        payload: {
          incidentId: incident.id,
          number: incident.number,
          severity: incident.severity,
          dueAt: dueAt.toISOString(),
          overdueMinutes,
          commanderId: incident.commanderId,
        },
      });
    });
  }

  logger.warn('promised major incident updates are overdue', {
    tenantId: ctx.tenantId,
    count: overdue.length,
    numbers: overdue.slice(0, 20).map((incident) => incident.number),
  });
  return overdue.length;
}
