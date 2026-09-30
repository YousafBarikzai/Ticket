import 'server-only';
import type { Admin, AssetRow, Me } from '@itsm/sdk';
import type { Problem } from '@itsm/ui';
import { holdsAny } from '../../../../../permissions.js';
import { personFrom, resolvePeople } from '../../../../../server/people.js';
import { read } from '../../../../../server/read.js';
import {
  ASSET_LIMIT,
  assetFilter,
  assetView,
  costCentres,
  isAssetFiltered,
  narrowWarrantyRows,
  todayIn,
  warrantyDays,
  type AssetQuery,
  type AssetView,
} from '../../../../../components/cmdb/presentation.js';
import { assetDetailView, type AssetDetailView } from '../../../../../components/cmdb/assets.js';

/**
 * What the Assets page loads, made serialisable for its client view: the
 * register's rows for the URL's query — or, with the warranty filter, the
 * API's warranty report narrowed by the rest of the query — holders by name,
 * the cost centres to filter by, and on a hard load of `?open=asset:<tag>`
 * that asset with its holdings and linked item.
 */
export interface AssetsData {
  readonly rows: readonly AssetView[];
  readonly problem?: Problem;
  readonly capped: boolean;
  /** The API says who holds each asset (older ones did not): the Holder column shows. */
  readonly holders: boolean;
  readonly costCentres: readonly string[];
  /** The person the `holder` filter names, so its chip reads a name. */
  readonly holderOption?: { readonly value: string; readonly label: string };
  readonly today: string;
  readonly detail?: AssetDetailView;
  readonly detailMissing?: boolean;
}

export async function loadAssets(api: Admin, me: Me, query: AssetQuery, drawerTag: string | null): Promise<AssetsData> {
  const today = todayIn(me.timeZone);
  const mayReadCis = holdsAny(me, ['cmdb.read', 'cmdb.manage']);

  const listing = query.warranty
    ? read(async () => narrowWarrantyRows(await api.observe.estate.warranties(warrantyDays(query.warranty!)), query))
    : read(() => api.observe.estate.assets(assetFilter(query)));
  // The cost-centre choices come from the whole register, not from rows already narrowed to one.
  const everything = isAssetFiltered(query) ? read(() => api.observe.estate.assets({ limit: 200 })) : null;
  const [list, all, detail] = await Promise.all([listing, everything, drawerTag ? read(() => api.observe.estate.asset(drawerTag)) : Promise.resolve(null)]);

  const rows: readonly AssetRow[] = list.ok ? list.value : [];
  const detailRow = detail?.ok ? detail.value : null;
  const linkedCi = detailRow?.ciId && mayReadCis ? await read(() => api.observe.estate.ci(detailRow.ciId!)) : null;
  const people = await resolvePeople(api, [
    ...rows.map((row) => row.holderId),
    ...(detailRow ? detailRow.assignments.map((row) => row.userId) : []),
    query.holder,
  ]);
  const person = (id: string | null) => personFrom(people, id);
  const context = { person, today, locale: me.locale };

  return {
    rows: rows.map((row) => assetView(row, context)),
    ...(list.ok ? {} : { problem: list.problem }),
    capped: !query.warranty && rows.length >= ASSET_LIMIT,
    holders: rows.length === 0 || rows.some((row) => row.holderId !== undefined),
    costCentres: costCentres(all?.ok ? all.value : rows, query.costCentre),
    ...(query.holder ? { holderOption: { value: query.holder, label: people.get(query.holder)?.name ?? 'Unknown person' } } : {}),
    today,
    ...(detailRow
      ? {
          detail: assetDetailView(detailRow, {
            ...context,
            ci: linkedCi === null ? (detailRow.ciId ? 'hidden' : null) : linkedCi.ok ? { id: linkedCi.value.id, name: linkedCi.value.name, status: linkedCi.value.status } : 'hidden',
          }),
        }
      : {}),
    ...(drawerTag && detail && !detail.ok && detail.problem.status === 404 ? { detailMissing: true } : {}),
  };
}
