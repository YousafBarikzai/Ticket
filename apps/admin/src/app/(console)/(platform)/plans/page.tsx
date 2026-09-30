import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card, EmptyState, StatusPill } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { planView, plansInOrder } from '../../../../components/platform/presentation.js';
import { read } from '../../../../server/read.js';
import { requirePlatformOperator } from '../../../../server/session.js';
import '../../../../components/platform/platform.css';

export const metadata: Metadata = { title: 'Plans' };
export const dynamic = 'force-dynamic';

/**
 * Platform › Plans (SPEC §6.1 `/plans`): the price list every tenant is sold
 * against, as cards side by side — price per agent, what each plan allows
 * and warns at, what it includes, and which are no longer sold. Nothing here
 * charges anybody: these are the numbers a plan is sold against and the
 * limits it enforces, not a billing system (OD-05, ADR-0047).
 */
export default async function PlansPage(): Promise<ReactNode> {
  const { me, api } = await requirePlatformOperator();
  const plans = await read(() => api.platform.plans());
  const header = <PageHeader title="Plans" className="app-PlatformHeader" status={<StatusPill tone="info" icon="platform" label="Operator" />} />;

  if (!plans.ok) {
    return (
      <div className="app-Page app-Platform">
        {header}
        <Card title="Plans" titleAs="h2" problem={plans.problem} />
      </div>
    );
  }
  const views = plansInOrder(plans.value).map((plan) => planView(plan, me.locale));

  return (
    <div className="app-Page app-Platform">
      {header}
      {views.length === 0 ? (
        <EmptyState icon="layers-2" title="No plans yet" description="Plans are written to the deployment when it is first set up." />
      ) : (
        <>
          <p className="app-Plans__lede">Per agent, per month. Limits are what each plan refuses at; tenants are warned before them.</p>
          <ul className="app-Plans" aria-label="Plans">
            {views.map((plan) => (
              <li key={plan.key} className="app-Plans__item">
                <Card
                  title={plan.name}
                  titleAs="h2"
                  className="app-PlanCard"
                  {...(plan.retired ? { meta: <StatusPill size="sm" tone="neutral" label="Retired" srPrefix="Sold" /> } : {})}
                >
                  <p className="app-PlanCard__price">
                    <span className="app-PlanCard__amount">{plan.price}</span>
                    {plan.price === 'Negotiated' ? null : <span className="app-PlanCard__per"> per agent a month</span>}
                  </p>
                  {plan.description ? <p className="app-PlanCard__description">{plan.description}</p> : null}
                  <dl className="app-PlanCard__limits">
                    {plan.limits.map((limit) => (
                      <div key={limit.label} className="app-PlanCard__limit">
                        <dt>{limit.label}</dt>
                        <dd>{limit.text}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="app-PlanCard__features">{plan.features.length > 0 ? `Includes ${plan.features.join(', ')}.` : 'The core desk, nothing extra.'}</p>
                  {plan.retired ? <p className="app-PlanCard__features">No longer sold; tenants already on it keep it.</p> : null}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
