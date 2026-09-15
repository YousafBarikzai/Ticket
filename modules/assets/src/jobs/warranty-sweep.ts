import { defineJob, getSetting, logger, metrics, type TenantContext } from '@itsm/platform';
import { warrantiesExpiring } from '../service/asset-service.js';

/**
 * Warranties about to lapse, and those that already have.
 *
 * The one report that pays for the asset register. A machine repaired the week
 * after its cover ended costs more than the whole exercise of keeping the
 * dates, and nobody ever notices a lapse by looking.
 *
 * Reports rather than acts. What to do about a laptop whose cover ends on
 * Friday depends on things the platform does not know — whether it is being
 * replaced anyway, whether the supplier will extend — so this puts the list
 * somewhere a person will see it and stops.
 */
export interface WarrantyReport {
  expired: { tag: string; warrantyEndsOn: Date | null }[];
  expiring: { tag: string; warrantyEndsOn: Date | null }[];
}

export async function warrantyReport(ctx: TenantContext, now: Date = new Date()): Promise<WarrantyReport> {
  const days = (await getSetting<number>(ctx, 'assets.warrantyWarningDays')) ?? 30;
  const assets = await warrantiesExpiring(ctx, days, now);

  const expired: WarrantyReport['expired'] = [];
  const expiring: WarrantyReport['expiring'] = [];
  for (const asset of assets) {
    const row = { tag: asset.tag, warrantyEndsOn: asset.warrantyEndsOn };
    // Already past is the case worth surfacing rather than hiding: an expired
    // warranty nobody noticed is exactly the one that costs money.
    if (asset.warrantyEndsOn && asset.warrantyEndsOn.getTime() < now.getTime()) expired.push(row);
    else expiring.push(row);
  }
  return { expired, expiring };
}

defineJob<Record<string, never>>('analytics', 'assets.warranty.sweep', async (_payload, { ctx }) => {
  const report = await warrantyReport(ctx);
  metrics.observe('asset_warranties_expiring', report.expiring.length, {});
  metrics.observe('asset_warranties_expired', report.expired.length, {});
  if (report.expired.length === 0 && report.expiring.length === 0) return;

  logger.info('asset warranties need attention', {
    tenantId: ctx.tenantId,
    expired: report.expired.length,
    expiring: report.expiring.length,
    soonest: report.expiring.slice(0, 10),
  });
});
