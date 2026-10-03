import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { ChannelsView } from '../../../../../components/integrations/ChannelsView.js';
import { isPending, purposeFor, tabsFor } from '../../../../../navigation.js';
import { pageAccess } from '../../../../../server/session.js';

export const metadata: Metadata = { title: 'Channels · Integrations' };
export const dynamic = 'force-dynamic';

/**
 * Integrations › Channels (A7 §5.9), the route shell: the gate, the header
 * with the Integrations tabs, then the page's own component, which WP-79
 * replaces.
 */
export default async function ChannelsRoute(): Promise<ReactNode> {
  // Held back for the v3 release (UNFINISHED in navigation.ts): a stand-in is not shown in production.
  if (isPending('/integrations/channels')) notFound();
  const access = await pageAccess('/integrations/channels');
  if (!access.allowed) return <Forbidden route="/integrations/channels" />;
  return (
    <div className="app-Page">
      <PageHeader title="Integrations" purpose={purposeFor('/integrations/channels')} tabs={tabsFor(access.me, 'integrations')} />
      <ChannelsView />
    </div>
  );
}
