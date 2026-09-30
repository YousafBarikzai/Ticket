import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { formatDateTime } from '@itsm/ui/format';
import { AuditView, type ChainBreak } from '../../../../components/audit/AuditView.js';
import {
  auditFilter,
  cursorAt,
  dayKeyOf,
  readAuditQuery,
  seqOf,
  type AuditChange,
  type AuditRowView,
} from '../../../../components/audit/presentation.js';
import { brokenAtSeq } from '../../../../components/security/presentation.js';
import { Forbidden } from '../../../../components/Forbidden.js';
import { holds } from '../../../../permissions.js';
import { resolvePeople } from '../../../../server/people.js';
import { read } from '../../../../server/read.js';
import { pageAccess } from '../../../../server/session.js';
import { auditRows } from './data.js';
import '../../../../components/audit/audit.css';

export const metadata: Metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

/** `?open=event:<seq>` → the seq, or null. */
function drawerSeq(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = raw ? /^event:(\d{1,19})$/.exec(raw) : null;
  return match ? match[1]! : null;
}

/**
 * Audit log (SPEC §6.1 `/audit`, B §3.17, F32): what has been done on this
 * desk, by whom, newest first, a hundred at a time.
 *
 * The record is append-only and chained — each event carries the
 * fingerprint of the one before it — so this page is where an administrator
 * (or an auditor) reads it. The query string is the state: the filters, the
 * cursor and `open=event:<seq>`.
 *
 * `before` and `after` are held on every event and deliberately **not**
 * sent with the list: they are arbitrarily large, often personal, and a page
 * of them is a bulk disclosure. The one event whose drawer is open is the
 * exception — its own before and after, and nothing else.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<ReactNode> {
  const access = await pageAccess('/audit');
  if (!access.allowed) return <Forbidden route="/audit" />;
  const { me, api } = access;

  const params = await searchParams;
  const query = readAuditQuery(params);
  const timeZone = me.timeZone || 'UTC';
  const locale = me.locale || 'en-GB';
  const openSeq = drawerSeq(params.open);

  const [page, alerts] = await Promise.all([
    read(() => api.observe.auditEvents(auditFilter(query, timeZone))),
    holds(me, 'security.alert.read') ? read(() => api.observe.securityAlerts()) : Promise.resolve(null),
  ]);

  const events = page.ok ? page.value.data : [];
  const [rows, actorName] = await Promise.all([
    auditRows(me, api, events),
    query.actor ? resolvePeople(api, [query.actor]).then((people) => people.get(query.actor!)?.name ?? null) : Promise.resolve(null),
  ]);

  // The open event: from this page when it is on it, otherwise exactly that one event.
  let initialEvent: { row: AuditRowView; change: AuditChange } | undefined;
  if (openSeq) {
    let event = events.find((entry) => seqOf(entry) === openSeq);
    let row = rows.find((entry) => entry.seq === openSeq);
    if (!event) {
      const single = await read(() => api.observe.auditEvents({ cursor: cursorAt(openSeq), limit: 1 }));
      event = single.ok ? single.value.data.find((entry) => seqOf(entry) === openSeq) : undefined;
      row = event ? (await auditRows(me, api, [event]))[0] : undefined;
    }
    if (event && row) initialEvent = { row, change: { seq: openSeq, before: event.before ?? null, after: event.after ?? null } };
  }

  // What the nightly chain check said, for people who may read security alerts.
  const chain: ChainBreak[] | null = alerts?.ok
    ? alerts.value
        .filter((alert) => alert.type === 'audit.chain.broken')
        .map((alert) => ({
          alertId: alert.id,
          seq: brokenAtSeq(alert),
          createdAt: alert.createdAt,
          createdLabel: formatDateTime(alert.createdAt, { locale, timeZone, style: 'datetime' }),
        }))
    : null;

  return (
    <AuditView
      rows={rows}
      query={query}
      nextCursor={page.ok ? page.value.nextCursor : null}
      {...(page.ok ? {} : { problem: page.problem })}
      {...(query.actor ? { actorOption: { value: query.actor, label: actorName ?? 'Unknown person' } } : {})}
      canExport={holds(me, 'audit.export')}
      chain={chain}
      {...(initialEvent ? { initialEvent } : {})}
      workspace={me.tenant?.slug ?? me.tenant?.name ?? 'workspace'}
      today={dayKeyOf(new Date().toISOString(), timeZone)}
    />
  );
}
