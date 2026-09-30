import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { CredentialsView } from '../../../../../components/integrations/CredentialsView.js';
import { credentialView, expiryLook } from '../../../../../components/integrations/presentation.js';
import { holds } from '../../../../../permissions.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { actionsFor, integrationsHeader, openFailures, reachable } from '../data.js';
import '../../../../../components/integrations/integrations.css';

export const metadata: Metadata = { title: 'Credentials · Integrations' };
export const dynamic = 'force-dynamic';

const URGENCY = { expired: 0, soon: 1, ok: 2, none: 3 } as const;

/**
 * Integrations › Credentials (SPEC §6.1): metadata and a fingerprint for
 * each stored credential, the ones that need attention first — expired,
 * then expiring soonest, then the rest by reference. The actions are read
 * (where this person may) to say which would lose a credential if it went.
 */
export default async function CredentialsPage(): Promise<ReactNode> {
  const access = await pageAccess('/integrations/credentials');
  if (!access.allowed) return <Forbidden route="/integrations/credentials" />;
  const { me, api } = access;
  const now = Date.now();

  const [credentials, actions, open] = await Promise.all([read(() => api.observe.integrations.credentials()), actionsFor(me, api), openFailures(me, api)]);
  const header = integrationsHeader(me, 'integration.credential.manage', open);

  if (!credentials.ok) {
    return (
      <div className="app-Page app-Integrations">
        <PageHeader title="Integrations" tabs={header.tabs} {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})} />
        <Card title="Credentials" problem={credentials.problem} />
      </div>
    );
  }

  const rows = credentials.value
    .map((row) => credentialView(row, now, actions?.ok ? actions.value : []))
    .sort((a, b) => {
      const urgency = URGENCY[expiryLook(a.expiresAt, now).state] - URGENCY[expiryLook(b.expiresAt, now).state];
      if (urgency !== 0) return urgency;
      if (a.expiresAt && b.expiresAt && a.expiry.state !== 'ok') return Date.parse(a.expiresAt) - Date.parse(b.expiresAt);
      return Number(b.needsRewrap) - Number(a.needsRewrap) || a.ref.localeCompare(b.ref);
    });
  const actionsHref = reachable(me, '/integrations/actions');

  return <CredentialsView header={header} rows={rows} canManage={holds(me, 'integration.credential.manage')} {...(actionsHref ? { actionsHref } : {})} />;
}
