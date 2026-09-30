import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { ActionsView } from '../../../../../components/integrations/ActionsView.js';
import { actionView, failuresByAction } from '../../../../../components/integrations/presentation.js';
import { holds } from '../../../../../permissions.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { credentialsFor, integrationsHeader, openFailures, reachable } from '../data.js';
import '../../../../../components/integrations/integrations.css';

export const metadata: Metadata = { title: 'Actions · Integrations' };
export const dynamic = 'force-dynamic';

/**
 * Integrations › Actions (SPEC §6.1): every action with its health, read
 * against the credentials it names and the failures waiting for it. The
 * credentials are read only where this person may read them; without them
 * the chip shows the reference alone, never "missing".
 */
export default async function ActionsPage(): Promise<ReactNode> {
  const access = await pageAccess('/integrations/actions');
  if (!access.allowed) return <Forbidden route="/integrations/actions" />;
  const { me, api } = access;
  const now = Date.now();

  const [actions, credentials, open] = await Promise.all([
    read(() => api.observe.integrations.actions()),
    credentialsFor(me, api),
    openFailures(me, api),
  ]);
  const header = integrationsHeader(me, 'integration.action.manage', open);

  if (!actions.ok) {
    return (
      <div className="app-Page app-Integrations">
        <PageHeader title="Integrations" tabs={header.tabs} {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})} />
        <Card title="Actions" problem={actions.problem} />
      </div>
    );
  }

  const credentialMap = credentials?.ok ? new Map(credentials.value.map((credential) => [credential.ref, credential] as const)) : null;
  const failures = failuresByAction(open?.ok ? open.value : []);
  const rows = actions.value
    .map((action) => actionView(action, { credentials: credentialMap, failures, now }))
    // Live first, then by name: the ones workflows can call are the ones to watch.
    .sort((a, b) => Number(b.status === 'published') - Number(a.status === 'published') || a.name.localeCompare(b.name));
  const credentialsHref = reachable(me, '/integrations/credentials');
  const deliveriesHref = reachable(me, '/integrations');

  return (
    <ActionsView
      header={header}
      rows={rows}
      canPublish={holds(me, 'integration.action.manage')}
      credentialsUnknown={credentialMap === null}
      {...(credentialsHref ? { credentialsHref } : {})}
      {...(deliveriesHref ? { deliveriesHref } : {})}
    />
  );
}
