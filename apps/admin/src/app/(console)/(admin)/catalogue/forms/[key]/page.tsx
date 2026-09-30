import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card } from '@itsm/ui';
import { PageHeader } from '@itsm/ui/shell';
import { Forbidden } from '../../../../../../components/Forbidden.js';
import { FormEditor } from '../../../../../../components/catalogue/FormEditor.js';
import { usedBy } from '../../../../../../components/catalogue/presentation.js';
import { breadcrumbsFor } from '../../../../../../navigation.js';
import { holds, viewOnlyFor } from '../../../../../../permissions.js';
import { read } from '../../../../../../server/read.js';
import { pageAccess } from '../../../../../../server/session.js';
import { loadForms, mayWriteForms } from '../../data.js';
import '../../../../../../components/catalogue/catalogue.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { readonly params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  const access = await pageAccess('/catalogue/forms/[key]');
  if (!access.allowed) return { title: 'Form · Services & requests' };
  const forms = await loadForms(access.api, access.me);
  const form = forms?.ok ? forms.value.find((entry) => entry.key === key) : undefined;
  return { title: `${form?.name ?? 'Form'} · Services & requests` };
}

/**
 * The form editor (SPEC §6.1, Appendix C). The API has no single-form read
 * yet (A9), so the form comes from the list, which carries whole documents.
 * A key that names no form is the in-frame 404; request types are read only
 * to say which ask this form, and only for people who may see them.
 */
export default async function FormEditorPage({ params }: { readonly params: Promise<{ key: string }> }): Promise<ReactNode> {
  const access = await pageAccess('/catalogue/forms/[key]');
  if (!access.allowed) return <Forbidden route="/catalogue/forms/[key]" />;
  const { me, api } = access;
  const { key } = await params;
  const canSeeRequestTypes = holds(me, 'catalogue.manage');
  const crumbs = breadcrumbsFor('/catalogue/forms/[key]');

  const [forms, types] = await Promise.all([loadForms(api, me), canSeeRequestTypes ? read(() => api.configure.catalogue.requestTypes()) : Promise.resolve(null)]);
  if (!forms || !forms.ok) {
    return (
      <div className="app-Page app-FormEditor">
        <PageHeader title="Form" breadcrumbs={crumbs} />
        <Card title="Form" {...(forms && !forms.ok ? { problem: forms.problem } : { problem: { status: 403 } })} />
      </div>
    );
  }
  const form = forms.value.find((entry) => entry.key === key);
  if (!form) notFound();

  const viewOnly = viewOnlyFor(me, form.name, 'catalogue.form.manage');
  return (
    <FormEditor
      key={form.key}
      form={form}
      usedBy={types?.ok ? usedBy(form.key, types.value) : []}
      canManage={mayWriteForms(me)}
      canSeeRequestTypes={canSeeRequestTypes}
      breadcrumbs={crumbs}
      {...(viewOnly ? { viewOnly } : {})}
    />
  );
}
