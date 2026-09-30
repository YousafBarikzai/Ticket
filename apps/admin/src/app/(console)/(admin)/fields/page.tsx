import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../components/Forbidden.js';
import { FieldsView, type FieldScope } from '../../../../components/fields/FieldsView.js';
import { fieldView, rulesByField } from '../../../../components/fields/presentation.js';
import { holds, permissionLabel, viewOnlyFor } from '../../../../permissions.js';
import { read } from '../../../../server/read.js';
import { pageAccess } from '../../../../server/session.js';
import '../../../../components/catalogue/catalogue.css';
import '../../../../components/fields/fields.css';

export const metadata: Metadata = { title: 'Ticket fields' };
export const dynamic = 'force-dynamic';

const SCOPES: readonly { readonly value: FieldScope; readonly label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'retired', label: 'Retired' },
  { value: 'all', label: 'All' },
];

/**
 * Ticket fields (SPEC §6.1; ADR-0048; F27): what this desk collects beyond a
 * title and a description. Every definition is read, retired ones too — a
 * field turned off last year still has values on every ticket raised while
 * it was on — and the scope (`?scope=active|retired|all`) chooses which to
 * list. Permissions are read for the Restricted picker and the column's
 * names; rules only to say which read a field before it is retired.
 */
export default async function FieldsPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactNode> {
  const access = await pageAccess('/fields');
  if (!access.allowed) return <Forbidden route="/fields" />;
  const { me, api } = access;
  const query = await searchParams;
  const requested = typeof query.scope === 'string' ? query.scope : 'active';
  const scope: FieldScope = requested === 'retired' || requested === 'all' ? requested : 'active';
  const viewOnly = viewOnlyFor(me, 'Ticket fields', 'ticket.config.manage');

  const [fields, permissions, rules] = await Promise.all([
    read(() => api.tenant.fields(true)),
    read(() => api.tenant.permissions()),
    holds(me, 'rules.rule.read') ? read(() => api.configure.rules.list()) : Promise.resolve(null),
  ]);

  if (!fields.ok) {
    return (
      <div className="app-Page app-Fields">
        <PageHeader title="Ticket fields" />
        <Card title="Ticket fields" problem={fields.problem} />
      </div>
    );
  }

  const usage = rulesByField(rules?.ok ? rules.value : []);
  const all = fields.value.map((row) => fieldView(row, permissionLabel, usage.get(row.key) ?? []));
  const shown = all.filter((field) => (scope === 'all' ? true : scope === 'active' ? field.isActive : !field.isActive));
  const count = (value: FieldScope): number => all.filter((field) => (value === 'all' ? true : value === 'active' ? field.isActive : !field.isActive)).length;

  return (
    <FieldsView
      fields={shown}
      allFields={all}
      scope={scope}
      scopes={SCOPES.map((entry) => ({ ...entry, href: entry.value === 'active' ? '/fields' : `/fields?scope=${entry.value}`, count: count(entry.value) }))}
      canManage={holds(me, 'ticket.config.manage')}
      permissions={(permissions.ok ? permissions.value : []).map((permission) => ({ key: permission.key, label: permissionLabel(permission.key), description: permission.description }))}
      {...(viewOnly ? { viewOnly } : {})}
    />
  );
}
