import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../components/Forbidden.js';
import { PoliciesView } from '../../../../components/sla/PoliciesView.js';
import { read } from '../../../../server/read.js';
import { pageAccess } from '../../../../server/session.js';
import { calendarOption, canManageSla, policyView, slaHeader } from './data.js';
import '../../../../components/command-centre/shared.css';
import '../../../../components/sla/sla.css';

export const metadata: Metadata = { title: 'Service levels' };
export const dynamic = 'force-dynamic';

/**
 * Service levels › Policies (SPEC §6.1): what this desk promises, in the
 * order the clock checks it. The policies and the calendars (for the clock's
 * words and the new policy's picker) are read separately, so a calendar
 * list that fails still leaves the promises readable.
 */
export default async function PoliciesPage(): Promise<ReactNode> {
  const access = await pageAccess('/sla');
  if (!access.allowed) return <Forbidden route="/sla" />;
  const { me, api } = access;
  const header = slaHeader(me);

  const [policies, calendars] = await Promise.all([read(() => api.configure.sla.policies()), read(() => api.configure.sla.calendars())]);

  if (!policies.ok) {
    return (
      <div className="app-Page app-Sla">
        <PageHeader title="Service levels" tabs={header.tabs} {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})} />
        <Card title="Policies" problem={policies.problem} />
      </div>
    );
  }

  return (
    <PoliciesView
      header={header}
      policies={policies.value.map(policyView)}
      calendars={calendars.ok ? calendars.value.map(calendarOption) : []}
      canManage={canManageSla(me)}
    />
  );
}
