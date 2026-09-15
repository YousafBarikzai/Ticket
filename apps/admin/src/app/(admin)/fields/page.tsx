import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ApiError } from '@itsm/sdk';
import { Badge, EmptyState, Table } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { holds } from '../../../permissions.js';
import { FieldEditor } from '../../../components/FieldEditor.js';

export const metadata: Metadata = { title: 'The shape of a ticket' };
export const dynamic = 'force-dynamic';

/**
 * Custom fields.
 *
 * The first screen in this console that writes, and the one that most needed
 * to exist: `field_definition` has been a table since Phase 1 with no service,
 * no routes and no way for anybody to see what their own desk collects
 * (ADR-0048).
 *
 * Inactive definitions are shown, not hidden. A field somebody turned off last
 * year still has values on every ticket raised while it was on, and an
 * administrator wondering where a column went is better served by seeing it
 * greyed than by it vanishing.
 */
export default async function FieldsPage(): Promise<ReactNode> {
  const { me, api } = await currentActor();
  const canManage = holds(me, 'ticket.config.manage');

  let fields: Awaited<ReturnType<typeof api.tenant.fields>>;
  try {
    fields = await api.tenant.fields(true);
  } catch (error) {
    return (
      <EmptyState
        tone="error"
        title="The field definitions could not be loaded"
        description={error instanceof ApiError ? error.message : 'The API could not be reached.'}
      />
    );
  }

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>The shape of a ticket</h1>
        <p className="itsm-Admin__lede">
          What this desk collects beyond a title and a description. A value is refused if it does not match one of
          these, so a field defined here is the only way a ticket can carry it.
        </p>
      </header>

      {fields.length === 0 ? (
        <EmptyState
          title="No custom fields"
          description="A ticket carries its standard fields only. Add one below when this desk needs something else."
        />
      ) : (
        <Table
          caption="Custom fields on a ticket"
          columns={[
            { key: 'label', header: 'Label', cell: (row) => row.label },
            { key: 'key', header: 'Key', cell: (row) => <code>{row.key}</code> },
            { key: 'type', header: 'Type', cell: (row) => row.type },
            {
              key: 'who',
              header: 'Who sees it',
              cell: (row) =>
                row.classification === 'public' ? (
                  'Everybody, including the requester'
                ) : row.classification === 'internal' ? (
                  'The desk'
                ) : (
                  <>Only {row.visibleTo.join(', ') || 'nobody'}</>
                ),
            },
            {
              key: 'applies',
              header: 'Applies to',
              cell: (row) => (row.appliesTo.types.length === 0 ? 'Every type' : row.appliesTo.types.join(', ')),
            },
            {
              key: 'active',
              header: 'In use',
              cell: (row) => (
                <Badge intent={row.isActive ? 'success' : 'neutral'} srPrefix="In use">
                  {row.isActive ? 'Yes' : 'Retired'}
                </Badge>
              ),
            },
          ]}
          rows={fields}
          rowKey={(row) => row.id}
        />
      )}

      {canManage ? (
        <FieldEditor existingKeys={fields.map((field) => field.key)} />
      ) : (
        <p className="itsm-Admin__note">
          Your account can see these but not change them. Editing needs <code>ticket.config.manage</code>.
        </p>
      )}
    </div>
  );
}
