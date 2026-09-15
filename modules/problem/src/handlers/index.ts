import { defineHandler, logger } from '@itsm/platform';
import { createProblemIn } from '../service/problem-service.js';

/**
 * A severe major incident raises a problem by itself.
 *
 * The one place in this module where something is created rather than
 * suggested, and the exception earns itself: there is exactly *one* problem per
 * major incident, and severe major incidents are rare. The objection to
 * automatic creation — a backlog of noise that buries the three somebody cares
 * about — does not apply to a handful of records a year, each of which
 * everybody already agrees needs looking into.
 *
 * What it does not do is guess at the cause or the workaround. It creates the
 * record, links the incident's ticket, and stops: the review named the actions,
 * and a problem is where the one that says "find out why" lives.
 */
const RAISES_A_PROBLEM = new Set(['SEV1', 'SEV2']);

defineHandler({
  consumer: 'problem',
  moduleId: 'MOD-08-E2',
  eventType: 'incident.major.review.published',
  required: false,
  async handle(ctx, event, tx) {
    const payload = event.payload as { incidentId: string; number: string; severity: string };
    if (!RAISES_A_PROBLEM.has(payload.severity)) return;

    // Idempotent on the incident, not on the event: a replay, a re-published
    // review and a second consumer pass must all leave one problem.
    const existing = await tx.problem.findFirst({ where: { majorIncidentId: payload.incidentId } });
    if (existing) return;

    const incident = await tx.majorIncident.findFirst({
      where: { id: payload.incidentId },
      select: { title: true, ticketId: true, affectedServiceIds: true },
    });
    if (!incident) {
      logger.warn('a review was published for a major incident that no longer exists', { incidentId: payload.incidentId });
      return;
    }

    // An incident that took out several services has no single one, and
    // guessing at the first would be worse than leaving it blank.
    const serviceId = incident.affectedServiceIds.length === 1 ? incident.affectedServiceIds[0]! : undefined;

    await createProblemIn(ctx, tx, {
      title: `Why did ${payload.number} happen? ${incident.title}`,
      description: `Raised automatically from the post-incident review of ${payload.number}.`,
      // A severe incident's cause outranks ordinary problem work by default;
      // somebody can lower it, which is a decision, where nobody raising it is
      // an omission.
      priority: payload.severity === 'SEV1' ? 'P1' : 'P2',
      raisedFrom: 'major_incident',
      majorIncidentId: payload.incidentId,
      ...(incident.ticketId ? { ticketIds: [incident.ticketId] } : {}),
      ...(serviceId ? { serviceId } : {}),
    });
  },
});
