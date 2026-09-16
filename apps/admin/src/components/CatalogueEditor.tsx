'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@itsm/sdk';
import { Button, FormField, Input, Select, Textarea } from '@itsm/ui';
import { api } from '../client/api.js';
import { slugFor } from '../keys.js';

/**
 * Adding to the catalogue.
 *
 * Three forms rather than one, because they are three different decisions
 * taken at three different times: a service is a thing this desk provides and
 * changes rarely; a request type is a specific ask within it; publishing is
 * the moment it becomes visible to every requester, and deserves not to be a
 * checkbox on the form that created it.
 *
 * Publishing is separated for a reason worth stating. A request type is
 * created as a draft, and the gap between the two is where somebody checks the
 * wording, the form and the priority. Collapsing them into one button would
 * mean every typo in a request-type name was live before anybody read it back.
 *
 * There is no delete. Retiring a request type that tickets already reference
 * has cascade behaviour this console has not been taught, and a button that
 * might orphan a year of requests is worse than an absent one — the note under
 * the form says so rather than leaving somebody hunting for it.
 */
export function CatalogueEditor({
  services,
  requestTypes,
  formKeys,
}: {
  services: readonly { key: string; name: string }[];
  requestTypes: readonly { key: string; name: string; status: string }[];
  formKeys: readonly string[];
}): ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [serviceName, setServiceName] = useState('');
  const [serviceDescription, setServiceDescription] = useState('');

  const [typeName, setTypeName] = useState('');
  const [typeService, setTypeService] = useState('');
  const [typeSummary, setTypeSummary] = useState('');
  const [typeForm, setTypeForm] = useState('');
  const [typePriority, setTypePriority] = useState('P3');

  const [publishKey, setPublishKey] = useState('');

  const serviceKey = slugFor(serviceName);
  const typeKey = slugFor(typeName);
  const drafts = requestTypes.filter((type) => type.status !== 'published');

  async function run(what: string, action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await action();
      setDone(what);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="itsm-FieldEditor" aria-label="Add to the catalogue">
      <h2>Add to the catalogue</h2>

      <form
        aria-label="Add a service"
        onSubmit={(event) => {
          event.preventDefault();
          void run(`Service ${serviceKey} added.`, async () => {
            await api.configure.catalogue.createService({
              key: serviceKey,
              name: serviceName.trim(),
              ...(serviceDescription.trim() ? { description: serviceDescription.trim() } : {}),
            });
            setServiceName('');
            setServiceDescription('');
          });
        }}
      >
        <h3>A service</h3>
        <FormField label="Name" hint="Something this desk provides, like “End user computing”.">
          {(control) => <Input {...control} value={serviceName} onChange={(event) => setServiceName(event.target.value)} />}
        </FormField>
        {serviceName.trim() !== '' ? (
          <p className="itsm-FieldEditor__key">
            {serviceKey ? (
              <>
                Stored as <code>{serviceKey}</code>.
              </>
            ) : (
              <>That name cannot make a key. A key is lower case letters, digits and hyphens, starts with a letter and is at least two characters — try different wording.</>
            )}
          </p>
        ) : null}
        <FormField label="Description" hint="Optional. What this service covers.">
          {(control) => (
            <Textarea {...control} value={serviceDescription} onChange={(event) => setServiceDescription(event.target.value)} />
          )}
        </FormField>
        <Button type="submit" disabled={busy || serviceKey === ''}>
          Add service
        </Button>
      </form>

      <form
        aria-label="Add a request type"
        onSubmit={(event) => {
          event.preventDefault();
          void run(`Request type ${typeKey} added as a draft.`, async () => {
            await api.configure.catalogue.createRequestType({
              key: typeKey,
              serviceKey: typeService,
              name: typeName.trim(),
              priority: typePriority,
              ...(typeSummary.trim() ? { shortSummary: typeSummary.trim() } : {}),
              ...(typeForm ? { formKey: typeForm } : {}),
            });
            setTypeName('');
            setTypeSummary('');
          });
        }}
      >
        <h3>A request type</h3>
        {services.length === 0 ? (
          <p className="itsm-Admin__note">Add a service first — a request type has to belong to one.</p>
        ) : null}
        <FormField label="Name" hint="What a requester will click, like “Order a laptop”.">
          {(control) => <Input {...control} value={typeName} onChange={(event) => setTypeName(event.target.value)} />}
        </FormField>
        {typeName.trim() !== '' ? (
          <p className="itsm-FieldEditor__key">
            {typeKey ? (
              <>
                Stored as <code>{typeKey}</code>.
              </>
            ) : (
              <>That name cannot make a key — try different wording.</>
            )}
          </p>
        ) : null}
        <FormField label="Service" hint="Which service this belongs to.">
          {(control) => (
            <Select
              {...control}
              value={typeService}
              onChange={(event) => setTypeService(event.target.value)}
              placeholder="Choose a service"
              options={services.map((service) => ({ value: service.key, label: service.name }))}
            />
          )}
        </FormField>
        <FormField label="One-line summary" hint="Optional. Shown under the name on the portal.">
          {(control) => <Input {...control} value={typeSummary} onChange={(event) => setTypeSummary(event.target.value)} />}
        </FormField>
        <FormField label="Form" hint="Optional. What the requester is asked. Without one they get a title and a description.">
          {(control) => (
            <Select
              {...control}
              value={typeForm}
              onChange={(event) => setTypeForm(event.target.value)}
              options={[{ value: '', label: 'No form' }, ...formKeys.map((key) => ({ value: key, label: key }))]}
            />
          )}
        </FormField>
        <FormField label="Priority" hint="What a ticket raised from this starts at.">
          {(control) => (
            <Select
              {...control}
              value={typePriority}
              onChange={(event) => setTypePriority(event.target.value)}
              options={['P1', 'P2', 'P3', 'P4'].map((priority) => ({ value: priority, label: priority }))}
            />
          )}
        </FormField>
        <Button type="submit" disabled={busy || typeKey === '' || typeService === ''}>
          Add as a draft
        </Button>
      </form>

      <form
        aria-label="Publish a request type"
        onSubmit={(event) => {
          event.preventDefault();
          void run(`${publishKey} is on the portal.`, async () => {
            await api.configure.catalogue.publishRequestType(publishKey);
            setPublishKey('');
          });
        }}
      >
        <h3>Publish</h3>
        <p className="itsm-Admin__note">
          A draft is invisible to requesters. Publishing puts it on the portal for everybody the entitlement allows,
          immediately.
        </p>
        {drafts.length === 0 ? (
          <p className="itsm-Admin__note">Nothing is waiting to be published.</p>
        ) : (
          <>
            <FormField label="Draft" hint="Read the wording back before this goes live.">
              {(control) => (
                <Select
                  {...control}
                  value={publishKey}
                  onChange={(event) => setPublishKey(event.target.value)}
                  placeholder="Choose a draft"
                  options={drafts.map((type) => ({ value: type.key, label: type.name }))}
                />
              )}
            </FormField>
            <Button type="submit" disabled={busy || publishKey === ''}>
              Publish to the portal
            </Button>
          </>
        )}
      </form>

      {error ? (
        <p className="itsm-FieldEditor__error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="itsm-FieldEditor__done" role="status">
          {done}
        </p>
      ) : null}

      <p className="itsm-Admin__note">
        Editing an existing entry and retiring one are reachable through the API and have no controls here.
        Retiring in particular has cascade behaviour this console has not been taught, and tickets already raised
        from a request type outlive it.
      </p>
    </section>
  );
}
