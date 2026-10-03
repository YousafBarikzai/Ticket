import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { ChannelsView } from '../../../../../components/integrations/ChannelsView.js';
import { purposeFor, tabsFor } from '../../../../../navigation.js';
import { pageAccess } from '../../../../../server/session.js';

export const metadata: Metadata = { title: 'Channels · Integrations' };
export const dynamic = 'force-dynamic';

/**
 * Integrations › Channels (A7 §5.9), the route shell: the gate, the header
 * with the Integrations tabs, then the page's own component, which WP-79
 * replaces.
 */
export default async function ChannelsRoute(): Promise<ReactNode> {
  const access = await pageAccess('/integrations/channels');
  if (!access.allowed) return <Forbidden route="/integrations/channels" />;
  return (
    <div className="app-Page">
      <PageHeader title="Integrations" purpose={purposeFor('/integrations/channels')} tabs={tabsFor(access.me, 'integrations')} />
      <ChannelsView />
    </div>
  );
}
