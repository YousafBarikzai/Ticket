import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { CalendarsView } from '../../../../../components/sla/CalendarsView.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { calendarView, canManageSla, slaHeader } from '../data.js';
import '../../../../../components/command-centre/shared.css';
import '../../../../../components/sla/sla.css';

export const metadata: Metadata = { title: 'Calendars · Service levels' };
export const dynamic = 'force-dynamic';

/**
 * Service levels › Calendars (SPEC §6.1): the business hours SLA clocks
 * count. Policies are read too, only to say which use each calendar; if they
 * fail, the calendars still show.
 */
export default async function CalendarsPage(): Promise<ReactNode> {
  const access = await pageAccess('/sla/calendars');
  if (!access.allowed) return <Forbidden route="/sla/calendars" />;
  const { me, api } = access;
  const header = slaHeader(me);

  const [calendars, policies] = await Promise.all([read(() => api.configure.sla.calendars()), read(() => api.configure.sla.policies())]);

  if (!calendars.ok) {
    return (
      <div className="app-Page app-Sla">
        <PageHeader title="Service levels" tabs={header.tabs} {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})} />
        <Card title="Calendars" problem={calendars.problem} />
      </div>
    );
  }

  const usedBy = policies.ok ? policies.value : [];
  return <CalendarsView header={header} calendars={calendars.value.map((row) => calendarView(row, usedBy))} canManage={canManageSla(me)} />;
}
