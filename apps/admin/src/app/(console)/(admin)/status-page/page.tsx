import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../components/Forbidden.js';
import { StatusPageConsole } from '../../../../components/status-page/StatusPageConsole.js';
import { purposeFor } from '../../../../navigation.js';
import { pageAccess } from '../../../../server/session.js';

export const metadata: Metadata = { title: 'Status page' };
export const dynamic = 'force-dynamic';

/**
 * The Status page console (A7 §4.7), the route shell: the gate, the header,
 * then the console's own component, which WP-91 replaces.
 */
export default async function StatusPageRoute(): Promise<ReactNode> {
  const access = await pageAccess('/status-page');
  if (!access.allowed) return <Forbidden route="/status-page" />;
  return (
    <div className="app-Page">
      <PageHeader title="Status page" purpose={purposeFor('/status-page')} />
      <StatusPageConsole />
    </div>
  );
}
