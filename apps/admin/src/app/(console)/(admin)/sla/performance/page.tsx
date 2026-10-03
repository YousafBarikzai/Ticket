import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { SlaPerformancePage } from '../../../../../components/sla-performance/SlaPerformancePage.js';
import { purposeFor, tabsFor } from '../../../../../navigation.js';
import { pageAccess } from '../../../../../server/session.js';

export const metadata: Metadata = { title: 'Performance · Service levels' };
export const dynamic = 'force-dynamic';

/**
 * Service levels › Performance (A7 §4.4), the route shell: the gate, the
 * header with the four tabs, then the page's own component. WP-77 replaces
 * the component, not this file's shape.
 */
export default async function SlaPerformanceRoute(): Promise<ReactNode> {
  const access = await pageAccess('/sla/performance');
  if (!access.allowed) return <Forbidden route="/sla/performance" />;
  return (
    <div className="app-Page">
      <PageHeader title="Service levels" purpose={purposeFor('/sla/performance')} tabs={tabsFor(access.me, 'service-levels')} />
      <SlaPerformancePage />
    </div>
  );
}
