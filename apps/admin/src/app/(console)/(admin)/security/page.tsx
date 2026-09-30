import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { cursorAt, pageHref } from '../../../../components/audit/presentation.js';
import { AlertsView, type AlertRowView } from '../../../../components/security/AlertsView.js';
import { alertDetails, alertPeople, alertSummary, alertSummaryLine, alertTitle, brokenAtSeq, severityOf, sortAlerts } from '../../../../components/security/presentation.js';
import { Forbidden } from '../../../../components/Forbidden.js';
import { isPending, mayOpen, tabsFor } from '../../../../navigation.js';
import { holds } from '../../../../permissions.js';
import { resolvePeople } from '../../../../server/people.js';
import { read } from '../../../../server/read.js';
import { pageAccess } from '../../../../server/session.js';
import '../../../../components/security/security.css';

export const metadata: Metadata = { title: 'Security' };
export const dynamic = 'force-dynamic';

/**
 * Security › Alerts (SPEC §6.1 `/security`, B §3.15): the open alerts the
 * audit pipeline raised, most severe first, each worded on the server with
 * the people it names resolved (F8) — the list carries sentences and a
 * details grid, never the raw `details` object.
 */
export default async function SecurityPage(): Promise<ReactNode> {
  const access = await pageAccess('/security');
  if (!access.allowed) return <Forbidden route="/security" />;
  const { me, api } = access;

  const [alerts, roles] = await Promise.all([
    read(() => api.observe.securityAlerts()),
    holds(me, 'identity.role.read') ? read(() => api.tenant.roles()) : Promise.resolve(null),
  ]);

  const list = alerts.ok ? sortAlerts(alerts.value) : [];
  const people = await resolvePeople(api, alertPeople(list));
  const nameOf = (id: string): string | null => people.get(id)?.name ?? null;
  const roleNames = new Map(roles?.ok ? roles.value.map((role) => [role.key, role.name] as const) : []);
  const mayAudit = !isPending('/audit') && mayOpen(me, '/audit');

  const rows: AlertRowView[] = list.map((alert) => {
    const seq = brokenAtSeq(alert);
    return {
      id: alert.id,
      severity: severityOf(alert.severity),
      title: alertTitle(alert.type),
      summary: alertSummary(alert, nameOf),
      createdAt: alert.createdAt,
      details: alertDetails(alert, nameOf, roleNames),
      ...(seq && mayAudit ? { auditHref: `${pageHref('/audit', {}, cursorAt(seq))}&open=event:${seq}` } : {}),
    };
  });

  return (
    <AlertsView
      tabs={tabsFor(me, 'security')}
      rows={rows}
      summary={alertSummaryLine(list, Date.now())}
      {...(alerts.ok ? {} : { problem: alerts.problem })}
    />
  );
}
