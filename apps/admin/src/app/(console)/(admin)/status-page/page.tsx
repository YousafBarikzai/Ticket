import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../components/Forbidden.js';
import { StatusPageConsole } from '../../../../components/status-page/StatusPageConsole.js';
import { isPending, purposeFor } from '../../../../navigation.js';
import { pageAccess } from '../../../../server/session.js';

export const metadata: Metadata = { title: 'Status page' };
export const dynamic = 'force-dynamic';

/**
 * The Status page console (A7 §4.7), the route shell: the gate, the header,
 * then the console's own component, which WP-91 replaces.
 */
export default async function StatusPageRoute(): Promise<ReactNode> {
  // Held back for the v3 release (UNFINISHED in navigation.ts): a stand-in is not shown in production.
  if (isPending('/status-page')) notFound();
  const access = await pageAccess('/status-page');
  if (!access.allowed) return <Forbidden route="/status-page" />;
  return (
    <div className="app-Page">
      <PageHeader title="Status page" purpose={purposeFor('/status-page')} />
      <StatusPageConsole />
    </div>
  );
}
