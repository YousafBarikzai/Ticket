import type { AssetDetail } from '@itsm/sdk';
import type { PersonRef } from '../PersonCell.js';
import { assetView, type AssetView } from './presentation.js';

/**
 * One asset as its drawer shows it (SPEC §6.1 `/cmdb/assets`): the row's
 * facts with the current holder taken from the open holding, every holding
 * with names, and the linked configuration item by name — or `hidden` when
 * there is one this person cannot read. Pure and server-safe: the page builds
 * it for a hard load of `?open=asset:<tag>`, the drawer for everything else.
 */
export interface AssetDetailView {
  readonly asset: AssetView;
  readonly holdings: readonly {
    readonly who: PersonRef | null;
    readonly location: string | null;
    readonly note: string | null;
    readonly assignedAt: string;
    readonly returnedAt: string | null;
  }[];
  /** The linked item; `hidden` when this person cannot read items; null when none is linked. */
  readonly ci: { readonly id: string; readonly name: string; readonly status: string } | 'hidden' | null;
}

export function assetDetailView(
  detail: AssetDetail,
  context: {
    person(id: string | null): PersonRef | null;
    readonly today: string;
    readonly locale: string;
    readonly ci: AssetDetailView['ci'];
  },
): AssetDetailView {
  const open = detail.assignments.find((row) => row.returnedAt === null);
  return {
    // The holder is whoever the open holding names: the detail says it even where a list did not.
    asset: assetView({ ...detail, holderId: open?.userId ?? null }, context),
    holdings: detail.assignments.map((row) => ({
      who: context.person(row.userId),
      location: row.location,
      note: row.note,
      assignedAt: row.assignedAt,
      returnedAt: row.returnedAt,
    })),
    ci: context.ci,
  };
}
