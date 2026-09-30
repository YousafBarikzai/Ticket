import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { eventCatalogue } from '@itsm/contracts';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { WebhooksView } from '../../../../../components/integrations/WebhooksView.js';
import { webhookView } from '../../../../../components/integrations/presentation.js';
import type { EventChoice } from '../../../../../components/integrations/types.js';
import { holds } from '../../../../../permissions.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { integrationsHeader, openFailures } from '../data.js';
import '../../../../../components/integrations/integrations.css';

export const metadata: Metadata = { title: 'Webhooks · Integrations' };
export const dynamic = 'force-dynamic';

/**
 * Integrations › Webhooks (SPEC §6.1 [Plus]). The events a webhook may carry
 * are the contract's own catalogue, filtered to those marked for external
 * subscribers — read here on the server, so the picker ships a list of names
 * rather than the catalogue's schemas.
 */
export default async function WebhooksPage(): Promise<ReactNode> {
  const access = await pageAccess('/integrations/webhooks');
  if (!access.allowed) return <Forbidden route="/integrations/webhooks" />;
  const { me, api } = access;

  const [webhooks, open] = await Promise.all([read(() => api.tenant.webhooks()), openFailures(me, api)]);
  const header = integrationsHeader(me, 'webhook.manage', open);

  if (!webhooks.ok) {
    return (
      <div className="app-Page app-Integrations">
        <PageHeader title="Integrations" tabs={header.tabs} {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})} />
        <Card title="Webhooks" problem={webhooks.problem} />
      </div>
    );
  }

  const events: EventChoice[] = eventCatalogue
    .filter((event) => event.webhook)
    .map((event) => ({ type: event.type, description: event.description }))
    .sort((a, b) => a.type.localeCompare(b.type));

  return <WebhooksView header={header} rows={webhooks.value.map(webhookView)} events={events} canManage={holds(me, 'webhook.manage')} />;
}
