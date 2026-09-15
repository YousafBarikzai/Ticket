import { defineJob, getSetting, logger, metrics, publish, transaction, type TenantContext } from '@itsm/platform';
import { events } from '@itsm/contracts';
import { needingAttention, type ContractAttention } from '../service/contract-service.js';

/**
 * Contracts that need a decision, and the ones where the decision has already
 * been made by the calendar.
 *
 * Published rather than only logged, because this is the one report in MOD-10
 * with an owner outside IT: `contract.expiring` carries the notice figure, so a
 * notification rule can put it in front of whoever signs things.
 */

export async function contractReport(ctx: TenantContext, now: Date = new Date()): Promise<ContractAttention[]> {
  const warnDays = (await getSetting<number>(ctx, 'contracts.noticeWarningDays')) ?? 30;
  return needingAttention(ctx, warnDays, now);
}

defineJob<Record<string, never>>('analytics', 'assets.contract.sweep', async (_payload, { ctx }) => {
  const rows = await contractReport(ctx);
  metrics.observe('contracts_needing_attention', rows.length, {});
  if (rows.length === 0) return;

  const missed = rows.filter((row) => row.assessment.urgency === 'notice_missed');
  if (missed.length > 0) {
    // Worth its own line in the log: these are contracts that have committed
    // money nobody chose to commit this year.
    logger.warn('contracts renewed because their notice window closed', {
      tenantId: ctx.tenantId,
      count: missed.length,
      references: missed.slice(0, 10).map((row) => row.reference),
    });
  }

  await transaction(ctx, async (tx) => {
    for (const row of rows.slice(0, 200)) {
      await publish(tx, ctx, {
        definition: events.contractExpiring,
        aggregateId: row.id,
        payload: {
          contractId: row.id,
          reference: row.reference,
          name: row.name,
          supplier: row.supplier,
          endsOn: row.endsOn.toISOString().slice(0, 10),
          daysToNotice: row.assessment.daysToNotice,
          daysToEnd: row.assessment.daysToEnd,
          autoRenews: row.autoRenews,
        },
      });
    }
  });
});
