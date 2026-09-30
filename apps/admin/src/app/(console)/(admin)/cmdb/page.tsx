import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Forbidden } from '../../../../components/Forbidden.js';
import { CisView } from '../../../../components/cmdb/CisView.js';
import { drawerTarget, readCiQuery } from '../../../../components/cmdb/presentation.js';
import { mayOpen } from '../../../../navigation.js';
import { holds, holdsAny, viewOnlyFor } from '../../../../permissions.js';
import { pageAccess } from '../../../../server/session.js';
import { loadCmdb } from './data.js';
import '../../../../components/cmdb/cmdb.css';

export const metadata: Metadata = { title: 'Configuration items' };
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Configuration items (SPEC §6.1 `/cmdb`, MOD-10-E1): what the desk runs on,
 * by class, and how it depends on itself.
 *
 * The query string is the state: `class` (the class tree), `q` (name or
 * identifier), `status`, `criticality`, `retired=true` (retired items are
 * left out otherwise, as the API leaves them out), and `open=ci:<id>` for an
 * item's drawer — the link an asset, a relationship or a colleague follows.
 *
 * Assets are their own page (`/cmdb/assets`) with their own gate; the two
 * registers link to each other through an asset's linked item.
 */
export default async function CmdbPage({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<ReactNode> {
  const access = await pageAccess('/cmdb');
  if (!access.allowed) return <Forbidden route="/cmdb" />;
  const { me, api } = access;

  const params = await searchParams;
  const query = readCiQuery(params);
  const data = await loadCmdb(api, me, query, drawerTarget(params.open, 'ci'));
  const viewOnly = viewOnlyFor(me, 'Configuration items', 'cmdb.manage');

  return (
    <CisView
      classes={data.classes}
      {...(data.classesProblem ? { classesProblem: data.classesProblem } : {})}
      rows={data.rows}
      {...(data.problem ? { problem: data.problem } : {})}
      query={query}
      unknownClass={data.unknownClass}
      capped={data.capped}
      services={data.services}
      {...(data.detail ? { detail: data.detail } : {})}
      {...(data.detailMissing ? { detailMissing: true } : {})}
      canManage={holds(me, 'cmdb.manage')}
      canAudit={holds(me, 'audit.read')}
      canReadTickets={holdsAny(me, ['ticket.read'])}
      mayOpenTickets={mayOpen(me, '/tickets')}
      mayOpenAudit={mayOpen(me, '/audit')}
      {...(viewOnly ? { viewOnly } : {})}
    />
  );
}
