import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../components/Forbidden.js';
import { FormsView, type FormRowView } from '../../../../../components/catalogue/FormsView.js';
import { formStateLabel, usedBy } from '../../../../../components/catalogue/presentation.js';
import { tabsFor } from '../../../../../navigation.js';
import { holds, viewOnlyFor } from '../../../../../permissions.js';
import { read } from '../../../../../server/read.js';
import { pageAccess } from '../../../../../server/session.js';
import { loadForms, mayWriteForms } from '../data.js';
import '../../../../../components/catalogue/catalogue.css';

export const metadata: Metadata = { title: 'Forms · Services & requests' };
export const dynamic = 'force-dynamic';

/**
 * Services & requests › Forms (SPEC §6.1): the questions request types ask,
 * as forms — whether each is live, which request types use it, and the way
 * into the form editor. Request types are read only to say who uses a form,
 * and only for people who may see them; the list stands without.
 */
export default async function FormsPage(): Promise<ReactNode> {
  const access = await pageAccess('/catalogue/forms');
  if (!access.allowed) return <Forbidden route="/catalogue/forms" />;
  const { me, api } = access;
  const tabs = tabsFor(me, 'services');
  const canSeeRequestTypes = holds(me, 'catalogue.manage');
  const viewOnly = viewOnlyFor(me, 'Forms', 'catalogue.form.manage');

  const [forms, types] = await Promise.all([loadForms(api, me), canSeeRequestTypes ? read(() => api.configure.catalogue.requestTypes()) : Promise.resolve(null)]);

  if (!forms || !forms.ok) {
    return (
      <div className="app-Page app-Catalogue">
        <PageHeader title="Services & requests" tabs={tabs} />
        <Card title="Forms" {...(forms && !forms.ok ? { problem: forms.problem } : { problem: { status: 403 } })} />
      </div>
    );
  }

  const typeRows = types?.ok ? types.value : [];
  const rows: FormRowView[] = forms.value.map((form) => {
    const users = usedBy(form.key, typeRows);
    const pending = typeRows.find((type) => type.key === form.key && type.formKey === null);
    return {
      key: form.key,
      name: form.name,
      description: form.description,
      state: form.state,
      stateLabel: formStateLabel(form.state, form.version),
      version: form.version,
      questionCount: form.questionCount,
      usedBy: users,
      draftFor: pending ? pending.name : null,
      updatedAt: form.updatedAt,
    };
  });

  return (
    <FormsView
      tabs={tabs}
      forms={forms.value}
      rows={rows}
      canManage={mayWriteForms(me)}
      canSeeRequestTypes={canSeeRequestTypes}
      {...(viewOnly ? { viewOnly } : {})}
    />
  );
}
