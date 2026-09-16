import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ApiError } from '@itsm/sdk';
import { Badge, EmptyState, Table } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { holds } from '../../../permissions.js';
import { CatalogueEditor } from '../../../components/CatalogueEditor.js';

export const metadata: Metadata = { title: 'What people can ask for' };
export const dynamic = 'force-dynamic';

/**
 * The catalogue.
 *
 * The shortest loop in the product between an administrator doing something
 * and a requester seeing it: publish a request type here and it is on the
 * portal's "Request something" page, entitlement permitting. That is why this
 * screen shows the draft ones too — the difference between "I made it" and
 * "they can see it" is one column, and hiding drafts would make the gap
 * invisible.
 *
 * Services come first because a request type cannot exist without one. It is
 * the one ordering constraint in the catalogue and the form below enforces it
 * by offering the services that exist rather than a free-text key.
 */
export default async function CataloguePage(): Promise<ReactNode> {
  const { me, api } = await currentActor();
  const canManage = holds(me, 'catalogue.manage');

  if (!canManage) {
    return (
      <div className="itsm-Admin">
        <header className="itsm-Admin__head">
          <h1>What people can ask for</h1>
        </header>
        <EmptyState
          title="Your account cannot see the catalogue's drafts"
          description="Listing services and unpublished request types needs catalogue.manage. The published catalogue is on the portal."
        />
      </div>
    );
  }

  let services: Awaited<ReturnType<typeof api.configure.catalogue.services>>;
  let requestTypes: Awaited<ReturnType<typeof api.configure.catalogue.requestTypes>>;
  let forms: Awaited<ReturnType<typeof api.configure.catalogue.forms>>;
  try {
    [services, requestTypes, forms] = await Promise.all([
      api.configure.catalogue.services(),
      api.configure.catalogue.requestTypes(),
      api.configure.catalogue.forms(),
    ]);
  } catch (error) {
    return (
      <EmptyState
        tone="error"
        title="The catalogue could not be loaded"
        description={error instanceof ApiError ? error.message : 'The API could not be reached.'}
      />
    );
  }

  const serviceName = new Map(services.map((service) => [service.id, service.name]));
  const published = requestTypes.filter((type) => type.status === 'published').length;

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>What people can ask for</h1>
        <p className="itsm-Admin__lede">
          A service is something this desk provides; a request type is a specific thing somebody can ask for within
          it. {published === 0 ? 'Nothing is published yet, so the portal has an empty catalogue.' : `${published} of ${requestTypes.length} are published and on the portal now.`}
        </p>
      </header>

      <section aria-labelledby="services-heading">
        <h2 id="services-heading">Services</h2>
        {services.length === 0 ? (
          <EmptyState
            title="No services"
            description="A request type belongs to a service, so this is the first thing to add."
          />
        ) : (
          <Table
            caption="Services this desk provides"
            columns={[
              { key: 'name', header: 'Name', cell: (row) => row.name },
              { key: 'key', header: 'Key', cell: (row) => <code>{row.key}</code> },
              { key: 'description', header: 'Description', cell: (row) => row.description ?? '—' },
              {
                key: 'status',
                header: 'Status',
                cell: (row) => (
                  <Badge intent={row.status === 'active' ? 'success' : 'neutral'} srPrefix="Status">
                    {row.status}
                  </Badge>
                ),
              },
            ]}
            rows={services}
            rowKey={(row) => row.id}
          />
        )}
      </section>

      <section aria-labelledby="types-heading">
        <h2 id="types-heading">Request types</h2>
        {requestTypes.length === 0 ? (
          <EmptyState
            title="No request types"
            description="Add one below. Until one is published the portal's catalogue is empty."
          />
        ) : (
          <Table
            caption="Request types, including the ones nobody has published"
            columns={[
              { key: 'name', header: 'Name', cell: (row) => row.name },
              { key: 'key', header: 'Key', cell: (row) => <code>{row.key}</code> },
              { key: 'service', header: 'Service', cell: (row) => serviceName.get(row.serviceId) ?? '—' },
              { key: 'form', header: 'Form', cell: (row) => (row.formKey ? <code>{row.formKey}</code> : 'None') },
              { key: 'priority', header: 'Priority', cell: (row) => row.priority },
              {
                key: 'status',
                header: 'On the portal',
                cell: (row) => (
                  <Badge intent={row.status === 'published' ? 'success' : 'warning'} srPrefix="On the portal">
                    {row.status === 'published' ? 'Yes' : 'Draft'}
                  </Badge>
                ),
              },
            ]}
            rows={requestTypes}
            rowKey={(row) => row.id}
          />
        )}
      </section>

      <CatalogueEditor
        services={services.map((service) => ({ key: service.key, name: service.name }))}
        requestTypes={requestTypes.map((type) => ({ key: type.key, name: type.name, status: type.status }))}
        formKeys={forms.map((form) => form.key)}
      />
    </div>
  );
}
