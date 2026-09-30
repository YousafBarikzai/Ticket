import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { AssetsView } from '../../../../../components/cmdb/AssetsView.js';
import { drawerTarget, readAssetQuery } from '../../../../../components/cmdb/presentation.js';
import { holds, holdsAny, viewOnlyFor } from '../../../../../permissions.js';
import { pageAccess } from '../../../../../server/session.js';
import { loadAssets } from './data.js';
import '../../../../../components/cmdb/cmdb.css';

export const metadata: Metadata = { title: 'Assets' };
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Assets (SPEC §6.1 `/cmdb/assets`, MOD-10-E1): the register of hardware and
 * licences — who holds each, where it is, and when its warranty ends.
 *
 * The query string is the state: `q` (tag or serial), `status`,
 * `costCentre`, `holder` (a person), `warranty=30|90|expired` (the Command
 * centre links to `?warranty=30`) and `open=asset:<tag>` for the drawer.
 */
export default async function AssetsPage({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<ReactNode> {
  const access = await pageAccess('/cmdb/assets');
  if (!access.allowed) return <Forbidden route="/cmdb/assets" />;
  const { me, api } = access;

  const params = await searchParams;
  const query = readAssetQuery(params);
  const data = await loadAssets(api, me, query, drawerTarget(params.open, 'asset'));
  const viewOnly = viewOnlyFor(me, 'Assets', 'asset.manage');

  return (
    <AssetsView
      rows={data.rows}
      {...(data.problem ? { problem: data.problem } : {})}
      query={query}
      capped={data.capped}
      holders={data.holders}
      costCentres={data.costCentres}
      {...(data.holderOption ? { holderOption: data.holderOption } : {})}
      today={data.today}
      {...(data.detail ? { detail: data.detail } : {})}
      {...(data.detailMissing ? { detailMissing: true } : {})}
      canManage={holds(me, 'asset.manage')}
      canReadCis={holdsAny(me, ['cmdb.read', 'cmdb.manage'])}
      {...(viewOnly ? { viewOnly } : {})}
    />
  );
}
