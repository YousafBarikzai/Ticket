import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Badge, EmptyState, Table } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { read } from '../../../server/read.js';
import { holds } from '../../../permissions.js';
import { Panel } from '../../../components/Panel.js';

export const metadata: Metadata = { title: 'Integrations' };
export const dynamic = 'force-dynamic';

/**
 * What this desk reaches out to (MOD-14).
 *
 * Three lists: the actions a workflow may call, the credentials they
 * authenticate with, and the queue of attempts that failed.
 *
 * The credential table shows a fingerprint and never a value, because there is
 * no route that returns one — not to an administrator, not to a platform
 * operator, not with a flag. That is a property of the store rather than a
 * choice made on this page, and it is worth saying here because a table of
 * credentials is exactly where somebody would expect a reveal button.
 *
 * The error queue is the reason this screen matters. A failed outbound call is
 * a thing that did not happen — a user not created, a channel not opened —
 * and until now the only way to know was to read the table.
 */
export default async function IntegrationsPage(): Promise<ReactNode> {
  const { me, api } = await currentActor();

  const mayActions = holds(me, 'integration.action.read') || holds(me, 'integration.action.manage');
  const mayCredentials = holds(me, 'integration.credential.read') || holds(me, 'integration.credential.manage');

  if (!mayActions && !mayCredentials) {
    return (
      <EmptyState
        tone="error"
        title="Your account cannot see this desk's integrations"
        description="It needs integration.action.read, or integration.credential.read for the credential list."
      />
    );
  }

  const [actions, credentials, errors] = await Promise.all([
    mayActions ? read(() => api.observe.integrations.actions()) : null,
    mayCredentials ? read(() => api.observe.integrations.credentials()) : null,
    mayActions ? read(() => api.observe.integrations.errorQueue('open')) : null,
  ]);

  const open = errors?.ok ? errors.value.length : 0;

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>Integrations</h1>
        <p className="itsm-Admin__lede">
          Everything this desk calls that is not itself. Outbound requests go through the gateway, which refuses
          private addresses and opens a circuit breaker on a host that keeps failing.
        </p>
      </header>

      {errors ? (
        <Panel
          title={open > 0 ? `Failed calls (${open})` : 'Failed calls'}
          description="Attempts that did not land. A replay reuses the original idempotency key, so retrying cannot create a duplicate of something the first attempt already did."
          result={errors}
          empty="Nothing has failed. Every outbound call this desk has made has landed."
        >
          {(rows) => (
            <Table
              caption="Open error queue"
              columns={[
                { key: 'action', header: 'Action', cell: (row) => row.actionKey ?? <em>none named</em> },
                { key: 'source', header: 'Called by', cell: (row) => row.source },
                { key: 'error', header: 'What went wrong', cell: (row) => row.error },
                {
                  key: 'attempts',
                  header: 'Attempts',
                  cell: (row) => (
                    <Badge intent={row.attempts > 3 ? 'danger' : 'warning'} srPrefix="Attempts">
                      {row.attempts}
                    </Badge>
                  ),
                },
                { key: 'when', header: 'First failed', cell: (row) => new Date(row.createdAt).toLocaleString() },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
            />
          )}
        </Panel>
      ) : null}

      {actions ? (
        <Panel
          title="Actions"
          description="A draft action cannot be called. Publishing is what makes it available to a workflow."
          result={actions}
          empty="No actions. Workflows on this desk cannot reach anything outside it."
        >
          {(rows) => (
            <Table
              caption="Action definitions"
              columns={[
                { key: 'name', header: 'Action', cell: (row) => row.name },
                { key: 'key', header: 'Key', cell: (row) => <code>{row.key}</code> },
                { key: 'kind', header: 'Kind', cell: (row) => row.kind },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (row) => (
                    <Badge intent={row.status === 'published' ? 'success' : 'neutral'} srPrefix="Status">
                      {row.status}
                    </Badge>
                  ),
                },
                { key: 'credential', header: 'Authenticates with', cell: (row) => row.credentialRef ?? 'Nothing' },
                { key: 'timeout', header: 'Gives up after', cell: (row) => `${Math.round(row.timeoutMs / 1000)}s` },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
            />
          )}
        </Panel>
      ) : null}

      {credentials ? (
        <Panel
          title="Credentials"
          description="Metadata and a fingerprint. The value is never returned by any route, so it cannot appear here."
          result={credentials}
          empty="No credentials stored."
        >
          {(rows) => (
            <Table
              caption="Stored credentials"
              columns={[
                { key: 'ref', header: 'Name', cell: (row) => <code>{row.ref}</code> },
                { key: 'kind', header: 'Kind', cell: (row) => row.kind },
                { key: 'fingerprint', header: 'Fingerprint', cell: (row) => <code>{row.fingerprint}</code> },
                {
                  key: 'used',
                  header: 'Last used',
                  cell: (row) => (row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleDateString() : 'Never'),
                },
                {
                  key: 'expires',
                  header: 'Expires',
                  cell: (row) => (row.expiresAt ? new Date(row.expiresAt).toLocaleDateString() : '—'),
                },
                {
                  key: 'rewrap',
                  header: 'Key',
                  cell: (row) =>
                    row.needsRewrap ? (
                      <Badge intent="warning" srPrefix="Encryption key">
                        Needs rewrapping
                      </Badge>
                    ) : (
                      'Current'
                    ),
                },
              ]}
              rows={rows}
              rowKey={(row) => row.ref}
            />
          )}
        </Panel>
      ) : null}

      <section className="itsm-Admin__note" aria-label="What this screen cannot do yet">
        <h2>Not built yet</h2>
        <p>
          Replaying and dismissing a failed call, storing and rotating a credential, and publishing an action are all
          writes the API accepts and this screen does not offer. Replay in particular needs to be deliberate — it sends
          a real request to a real system — and it deserves a confirmation that says what it is about to do.
        </p>
      </section>
    </div>
  );
}
