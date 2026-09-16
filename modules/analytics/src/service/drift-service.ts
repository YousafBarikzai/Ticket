import { events } from '@itsm/contracts';
import { type TenantContext, logger, metrics, publish, transaction } from '@itsm/platform';
import { ticketService } from '@itsm/module-ticket';
import * as facts from '../repo/fact-repo.js';

/**
 * Drift detection.
 *
 * A projection is a second copy of the truth, and every second copy eventually
 * disagrees with the first. The question is not whether that happens but
 * whether anybody finds out — a reporting module that has been quietly missing
 * one ticket in two hundred since March will be believed right up to the moment
 * somebody counts by hand.
 *
 * So the count is asked of MOD-04 through its own service rather than read from
 * `ticket` here. Reading the table directly would produce a check that agrees
 * with the projection exactly when both are wrong about the same thing — the
 * soft-delete predicate, say, or the scope filter — which is the failure a
 * reconciliation exists to catch.
 */

/** Above this, somebody is told. 0.5 % of a busy tenant's month is a handful of tickets. */
export const DRIFT_TOLERANCE = 0.005;

export interface DriftResult {
  projector: string;
  expected: number;
  actual: number;
  driftRatio: number;
  breached: boolean;
  windowFrom: Date;
  windowTo: Date;
}

/**
 * Compares the ticket projection with MOD-04 over a window.
 *
 * The window is bounded rather than "everything", and ends an hour ago rather
 * than now: an event published a second ago has not been projected yet, and a
 * check that counted it would report drift on every run and teach everyone to
 * ignore the alert.
 */
export async function checkTicketDrift(
  ctx: TenantContext,
  options: { days?: number; now?: Date } = {},
): Promise<DriftResult> {
  const now = options.now ?? new Date();
  const windowTo = new Date(now.getTime() - 60 * 60 * 1000);
  const windowFrom = new Date(windowTo.getTime() - (options.days ?? 30) * 24 * 60 * 60 * 1000);

  const expected = await ticketService.countTickets(ctx, { createdAfter: windowFrom, createdBefore: windowTo });
  const actual = await transaction(ctx, async (tx) => facts.countTicketFacts(tx, windowFrom, windowTo));

  // A tenant with no tickets in the window has no drift, rather than a division
  // by zero or an infinite ratio that pages somebody at three in the morning.
  const driftRatio = expected === 0 ? (actual === 0 ? 0 : 1) : Math.abs(expected - actual) / expected;

  const result: DriftResult = {
    projector: 'ticket',
    expected,
    actual,
    driftRatio,
    breached: driftRatio > DRIFT_TOLERANCE,
    windowFrom,
    windowTo,
  };

  metrics.observe('analytics_projection_drift_ratio', driftRatio, { projector: 'ticket' });
  if (!result.breached) return result;

  logger.warn('projection drift exceeds tolerance', {
    tenantId: ctx.tenantId,
    expected,
    actual,
    driftRatio: Number(driftRatio.toFixed(4)),
  });

  await transaction(ctx, async (tx) => {
    // Recorded as well as published: "the projection was 0.8 % light for three
    // days in March" is something somebody has to be able to look up when a
    // quarterly number is questioned, and an alert that has scrolled past
    // cannot answer it.
    await facts.recordDrift(tx, ctx.tenantId, { projector: 'ticket', expected, actual, driftRatio });
    await publish(tx, ctx, {
      definition: events.analyticsDriftDetected,
      aggregateId: ctx.tenantId,
      payload: {
        projector: 'ticket',
        expected,
        actual,
        driftRatio,
        windowFrom: windowFrom.toISOString(),
        windowTo: windowTo.toISOString(),
      },
    });
  });

  return result;
}
