import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card, EmptyState } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { UsageView } from '../../../../../components/settings/UsageView.js';
import { meterView } from '../../../../../components/settings/usage.js';
import { holds, viewOnlyFor } from '../../../../../permissions.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { settingsTabs } from '../data.js';
import '../../../../../components/settings/settings.css';

export const metadata: Metadata = { title: 'Usage & plan · Settings' };
export const dynamic = 'force-dynamic';

/**
 * Settings › Usage & plan (SPEC §6.1): the plan this desk is sold on and each
 * meter against it — agents now, tickets and API calls this month, storage —
 * with the warning line and the plan's limit on one bar. "Warn me at" moves
 * the warning line (`tenant.limit.manage`); the limit itself is the plan's,
 * changed by the platform operator.
 */
export default async function UsagePage(): Promise<ReactNode> {
  const access = await pageAccess('/settings/usage');
  if (!access.allowed) return <Forbidden route="/settings/usage" />;
  const { me, api } = access;
  const viewOnly = viewOnlyFor(me, 'the warning lines', 'tenant.limit.manage');
  const header = <PageHeader title="Settings" tabs={settingsTabs(me)} {...(viewOnly ? { viewOnly } : {})} />;
  const usage = await read(() => api.tenant.usage());
  if (!usage.ok) {
    return (
      <div className="app-Page app-Settings">
        {header}
        <Card title="Usage & plan" titleAs="h2" problem={usage.problem} />
      </div>
    );
  }
  const { plan, meters } = usage.value;

  return (
    <div className="app-Page app-Settings">
      {header}
      <Card title="Plan" titleAs="h2" icon="layers-2">
        {plan ? (
          <>
            <p className="app-UsagePlan__name">{plan.name}</p>
            {plan.description ? <p className="app-UsagePlan__text">{plan.description}</p> : null}
            <p className="app-UsagePlan__text">Moving to another plan is done by your platform operator.</p>
          </>
        ) : (
          <p className="app-UsagePlan__text">This desk isn’t on a plan, so nothing is limited. Your platform operator assigns plans.</p>
        )}
      </Card>
      {meters.length === 0 ? (
        <EmptyState size="sm" icon="trending-up" title="Nothing is metered yet" description="Meters appear here as the desk is used." />
      ) : (
        <UsageView meters={meters.map((meter) => meterView(meter, me.locale))} canEdit={holds(me, 'tenant.limit.manage')} locale={me.locale} />
      )}
    </div>
  );
}
