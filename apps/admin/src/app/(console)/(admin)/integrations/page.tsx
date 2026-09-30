import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../components/Forbidden.js';
import { DeliveriesView } from '../../../../components/integrations/DeliveriesView.js';
import { HealthSummary } from '../../../../components/integrations/HealthSummary.js';
import {
  DELIVERY_SCOPE_LABELS,
  DELIVERY_STATUSES,
  actionView,
  countCredentials,
  deliveryStatus,
  deliveryView,
  failuresByAction,
  type IntegrationsHealth,
} from '../../../../components/integrations/presentation.js';
import { resolvePeople } from '../../../../server/people.js';
import { read } from '../../../../server/read.js';
import { pageAccess } from '../../../../server/session.js';
import { QUEUE_PAGE, actionsFor, credentialsFor, integrationsHeader, mayReplay, openFailures, reachable, runWorkflowNames } from './data.js';
import '../../../../components/integrations/integrations.css';

export const metadata: Metadata = { title: 'Integrations' };
export const dynamic = 'force-dynamic';

/**
 * Integrations › Failed deliveries (SPEC §6.1; Appendix C "replays a failed
 * delivery"; MOD-14): the outbound calls that did not land, in the Open,
 * Replayed and Dismissed scopes (`?status=`), under a summary of the desk's
 * integration health.
 *
 * A failed call is a thing that did not happen — an account not created, a
 * channel not opened — so this tab comes first. The error queue is the only
 * list read in full; actions and credentials are read for their names and
 * the health cards, each allowed to fail on its own, and the workflow runs a
 * failure came from are named when this person may read workflows.
 */
export default async function IntegrationsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const access = await pageAccess('/integrations');
  if (!access.allowed) return <Forbidden route="/integrations" />;
  const { me, api } = access;
  const status = deliveryStatus((await searchParams).status);
  const now = Date.now();

  const [shown, openElsewhere, actions, credentials] = await Promise.all([
    read(() => api.observe.integrations.errorQueue(status)),
    status === 'open' ? Promise.resolve(null) : openFailures(me, api),
    actionsFor(me, api),
    credentialsFor(me, api),
  ]);
  const open = status === 'open' ? shown : openElsewhere;
  const header = integrationsHeader(me, 'integration.action.replay', open);

  if (!shown.ok) {
    return (
      <div className="app-Page app-Integrations">
        <PageHeader title="Integrations" tabs={header.tabs} {...(header.viewOnly ? { viewOnly: header.viewOnly } : {})} />
        <Card title="Failed deliveries" problem={shown.problem} />
      </div>
    );
  }

  const [runWorkflows, people] = await Promise.all([
    runWorkflowNames(me, api, shown.value),
    status === 'open' ? Promise.resolve(new Map<string, { readonly name: string | null }>()) : resolvePeople(api, shown.value.map((row) => row.resolvedBy)),
  ]);
  const actionNames = new Map(actions?.ok ? actions.value.map((action) => [action.key, action.name] as const) : []);
  const rows = shown.value.map((row) =>
    deliveryView(row, {
      actionNames,
      runWorkflows,
      people: new Map([...people].map(([id, person]) => [id, person.name] as const)),
      hrefFor: (entry) => (entry.source === 'workflow' ? reachable(me, `/workflows/runs?open=run:${encodeURIComponent(entry.sourceId)}`) : undefined),
    }),
  );

  const openRows = open?.ok ? open.value : null;
  const failures = failuresByAction(openRows ?? []);
  const credentialMap = credentials?.ok ? new Map(credentials.value.map((credential) => [credential.ref, credential] as const)) : null;
  const actionViews = actions?.ok ? actions.value.map((action) => actionView(action, { credentials: credentialMap, failures, now })) : null;
  const health: IntegrationsHealth = {
    ...(openRows ? { deliveries: { open: openRows.length, capped: openRows.length >= QUEUE_PAGE } } : {}),
    ...(actionViews
      ? {
          actions: {
            live: actionViews.filter((action) => action.status === 'published').length,
            draft: actionViews.filter((action) => action.status !== 'published').length,
            attention: actionViews.filter((action) => action.health.tone === 'danger' || action.health.tone === 'warning').length,
          },
        }
      : {}),
    ...(credentials?.ok ? { credentials: countCredentials(credentials.value, now) } : {}),
  };
  const actionsLink = reachable(me, '/integrations/actions');
  const credentialsLink = reachable(me, '/integrations/credentials');

  return (
    <DeliveriesView
      header={header}
      status={status}
      scopes={DELIVERY_STATUSES.map((value) => ({
        value,
        label: DELIVERY_SCOPE_LABELS[value],
        href: value === 'open' ? '/integrations' : `/integrations?status=${value}`,
        ...(value === 'open' && openRows ? { count: openRows.length } : {}),
      }))}
      rows={rows}
      capped={shown.value.length >= QUEUE_PAGE}
      canReplay={mayReplay(me)}
      summary={
        <HealthSummary
          health={health}
          links={{ ...(actionsLink ? { actions: actionsLink } : {}), ...(credentialsLink ? { credentials: credentialsLink } : {}) }}
          locale={me.locale}
        />
      }
    />
  );
}
