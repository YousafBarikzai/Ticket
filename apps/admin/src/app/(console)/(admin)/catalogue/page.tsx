import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../components/Forbidden.js';
import { RequestTypesView } from '../../../../components/catalogue/RequestTypesView.js';
import { tabsFor } from '../../../../navigation.js';
import { read } from '../../../../server/read.js';
import { currentAreas, pageAccess } from '../../../../server/session.js';
import { loadForms, loadTeams, mayWriteForms, requestTypeViews, serviceViews } from './data.js';
import '../../../../components/catalogue/catalogue.css';

export const metadata: Metadata = { title: 'Services & requests' };
export const dynamic = 'force-dynamic';

/**
 * Services & requests › Request types (SPEC §6.1, §6.4; X-41).
 *
 * The shortest loop in the product between an administrator doing something
 * and a requester seeing it: publish a request type here and it is in the
 * Help Portal's catalogue, entitlement permitting. Drafts are listed beside live
 * items for that reason — the difference between "I made it" and "they can
 * see it" is one column, and hiding drafts would make the gap invisible.
 *
 * Services, request types, forms and teams are read separately: without
 * forms (a person who may not read them) the questions show but cannot be
 * changed; without teams (A6) the team pickers are left out; without the
 * request types the services still show, with the failure in the table.
 */
export default async function CataloguePage(): Promise<ReactNode> {
  const access = await pageAccess('/catalogue');
  if (!access.allowed) return <Forbidden route="/catalogue" />;
  const { me, api } = access;
  const tabs = tabsFor(me, 'services');

  const [services, types, forms, teams, areas] = await Promise.all([
    read(() => api.configure.catalogue.services()),
    read(() => api.configure.catalogue.requestTypes()),
    loadForms(api, me),
    loadTeams(api),
    currentAreas(),
  ]);

  if (!services.ok) {
    return (
      <div className="app-Page app-Catalogue">
        <PageHeader title="Services & requests" tabs={tabs} />
        <Card title="Services" problem={services.problem} />
      </div>
    );
  }

  const serviceRows = await serviceViews(api, services.value, teams);
  const formRows = forms?.ok ? forms.value : null;
  const typeRows = types.ok ? requestTypeViews(types.value, serviceRows, formRows ?? [], teams) : [];

  return (
    <RequestTypesView
      tabs={tabs}
      services={serviceRows}
      types={typeRows}
      forms={formRows}
      teams={teams}
      canEditQuestions={mayWriteForms(me)}
      areas={areas}
      {...(types.ok ? {} : { problem: types.problem })}
    />
  );
}
