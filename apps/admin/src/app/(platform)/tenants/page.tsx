import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ApiError } from '@itsm/sdk';
import { Badge, EmptyState, Table } from '@itsm/ui';
import { requirePlatformOperator } from '../../../server/session.js';

export const metadata: Metadata = { title: 'Tenants' };
export const dynamic = 'force-dynamic';

/** Every tenant on this deployment. Behind the section's gate. */
export default async function TenantsPage(): Promise<ReactNode> {
  const { api } = await requirePlatformOperator();

  let tenants: Awaited<ReturnType<typeof api.platform.tenants>>;
  try {
    tenants = await api.platform.tenants();
  } catch (error) {
    return (
      <EmptyState
        tone="error"
        title="The tenants could not be loaded"
        description={error instanceof ApiError ? error.message : 'The API could not be reached.'}
      />
    );
  }

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>Tenants</h1>
        <p className="itsm-Admin__lede">
          {tenants.length} on this deployment. Provisioning, suspending and moving a tenant between plans are API
          operations; this lists what is here.
        </p>
      </header>

      <Table
        caption="Tenants on this deployment"
        columns={[
          { key: 'name', header: 'Name', cell: (row) => row.name },
          { key: 'slug', header: 'Slug', cell: (row) => <code>{row.slug}</code> },
          {
            key: 'status',
            header: 'Status',
            cell: (row) => (
              <Badge intent={row.status === 'active' ? 'success' : 'warning'} srPrefix="Status">
                {row.status}
              </Badge>
            ),
          },
          { key: 'region', header: 'Region', cell: (row) => row.region },
          {
            key: 'created',
            header: 'Created',
            cell: (row) => <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleDateString('en-GB')}</time>,
          },
        ]}
        rows={tenants}
        rowKey={(row) => row.id}
      />
    </div>
  );
}
