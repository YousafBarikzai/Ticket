import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState, Table } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { read } from '../../../server/read.js';
import { holds } from '../../../permissions.js';
import { Panel } from '../../../components/Panel.js';

export const metadata: Metadata = { title: 'Security' };
export const dynamic = 'force-dynamic';

const SEVERITY: Record<string, 'danger' | 'warning' | 'neutral'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
};

/**
 * What this desk can be asked to do, and what has looked wrong lately.
 *
 * Two lists. The permission registry is every permission the platform defines,
 * which is the only complete answer to "what could a role possibly grant" —
 * it is built from the modules themselves rather than from a document, so it
 * cannot drift from what the API actually checks.
 *
 * Security alerts are what the audit pipeline noticed: repeated refusals, a
 * privilege used for the first time, the patterns MOD-13 watches for. An alert
 * list nobody can see is an alert nobody acts on.
 *
 * Roles are not here. Who holds what is a property of people, and it belongs
 * on the people screen rather than in a second place that could disagree with
 * the first.
 */
export default async function SecurityPage(): Promise<ReactNode> {
  const { me, api } = await currentActor();

  const mayAlerts = holds(me, 'security.alert.read');
  const mayPermissions = holds(me, 'identity.role.manage') || holds(me, 'identity.user.read') || mayAlerts;

  if (!mayAlerts && !mayPermissions) {
    return (
      <EmptyState
        tone="error"
        title="Your account cannot see this desk's security"
        description="It needs security.alert.read for alerts, or identity.role.manage to read the permission registry."
      />
    );
  }

  const [alerts, permissions] = await Promise.all([
    mayAlerts ? read(() => api.observe.securityAlerts()) : null,
    mayPermissions ? read(() => api.tenant.permissions()) : null,
  ]);

  const byModule = permissions?.ok
    ? [...new Set(permissions.value.map((permission) => permission.module))].sort()
    : [];

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>Security</h1>
        <p className="itsm-Admin__lede">
          What the platform watches for, and the full vocabulary of permissions a role can be built from. Who holds
          which role is on <Link href="/people">the people screen</Link>.
        </p>
      </header>

      {alerts ? (
        <Panel
          title="Alerts"
          description="Raised by the audit pipeline when a pattern looks wrong — repeated refusals, a privilege used for the first time, an export nobody expected."
          result={alerts}
          empty="Nothing has looked wrong. The pipeline is watching; it has found nothing to raise."
        >
          {(rows) => (
            <Table
              caption="Security alerts"
              columns={[
                {
                  key: 'severity',
                  header: 'Severity',
                  cell: (row) => (
                    <Badge intent={SEVERITY[row.severity] ?? 'neutral'} srPrefix="Severity">
                      {row.severity}
                    </Badge>
                  ),
                },
                { key: 'type', header: 'What', cell: (row) => row.type },
                { key: 'when', header: 'When', cell: (row) => new Date(row.createdAt).toLocaleString() },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
            />
          )}
        </Panel>
      ) : null}

      {permissions ? (
        <Panel
          title="Permissions"
          description="Every permission this deployment defines, grouped by the module that enforces it. A role is a selection from this list."
          result={permissions}
          empty="The registry is empty, which should not be possible — no module has declared a permission."
        >
          {(rows) => (
            <div className="itsm-Admin__groups">
              {byModule.map((module) => (
                <section key={module} aria-label={`${module} permissions`}>
                  <h3>{module}</h3>
                  <Table
                    caption={`Permissions enforced by ${module}`}
                    captionHidden
                    columns={[
                      { key: 'key', header: 'Permission', cell: (row) => <code>{row.key}</code> },
                      {
                        key: 'scopes',
                        header: 'Scopes',
                        cell: (row) => (row.scopes.length === 0 ? '—' : row.scopes.join(', ')),
                      },
                      { key: 'description', header: 'What it allows', cell: (row) => row.description ?? '—' },
                      {
                        key: 'held',
                        header: 'You',
                        cell: (row) => (holds(me, row.key) ? 'Held' : '—'),
                      },
                    ]}
                    rows={rows.filter((permission) => permission.module === module)}
                    rowKey={(row) => row.key}
                  />
                </section>
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      <section className="itsm-Admin__note" aria-label="What this screen cannot do yet">
        <h2>Not built yet</h2>
        <p>
          Editing a role&rsquo;s permissions has no screen. It is the single most dangerous write in the console — a
          mis-click removes somebody&rsquo;s access to their own work, or gives a contractor the audit log — and it
          needs a preview of what changes before it needs a form.
        </p>
      </section>
    </div>
  );
}
