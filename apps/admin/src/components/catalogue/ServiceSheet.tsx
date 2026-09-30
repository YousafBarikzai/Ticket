'use client';

import { useId, useState, type ReactNode } from 'react';
import { Button, FormErrorSummary, FormField, FormSection, InlineAlert, Input, Select, Textarea } from '@itsm/ui';
import { PersonPicker, Sheet, type PersonOption } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import type { KeyState } from '../../keys.js';
import { KeyField } from '../KeyField.js';
import type { ServiceView } from './presentation.js';

/**
 * A service: the heading request types sit under in the portal (SPEC §6.1).
 * Name (its key made from it, checked against the services that exist and
 * permanent once saved), a description, an owner from the directory, and
 * the team its requests go to (A6, when the directory lists teams).
 */
export function ServiceSheet({
  open,
  service,
  missing = false,
  services,
  teams,
  onClose,
}: {
  readonly open: boolean;
  /** The service being edited; absent for a new one. */
  readonly service?: ServiceView;
  /** A drawer link that named a service that does not exist. */
  readonly missing?: boolean;
  readonly services: readonly ServiceView[];
  readonly teams: readonly { readonly id: string; readonly name: string }[] | null;
  readonly onClose: () => void;
}): ReactNode {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const online = useOnline();
  const close = (): void => {
    setDirty(false);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="md"
      title={service ? service.name : missing ? 'Service' : 'New service'}
      description={service || missing ? undefined : 'Services group what people can ask for. Request types live inside them.'}
      dirty={dirty}
      {...(missing
        ? {}
        : {
            footer: (
              <div className="app-SheetFooter">
                <Button variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" form={formId} loading={busy} {...(online ? {} : { disabledReason: 'You’re offline — changes can’t be saved.' })}>
                  {service ? 'Save service' : 'Add service'}
                </Button>
              </div>
            ),
          })}
    >
      {missing ? (
        <InlineAlert tone="warning">That service no longer exists. It may have been removed since the link was shared.</InlineAlert>
      ) : open ? (
        <ServiceForm
          key={service?.key ?? 'new'}
          formId={formId}
          {...(service ? { service } : {})}
          services={services}
          teams={teams}
          onDirtyChange={setDirty}
          onBusyChange={setBusy}
          onDone={close}
        />
      ) : null}
    </Sheet>
  );
}

const IDS: Readonly<Record<string, string>> = { name: 'service-name', key: 'service-key', description: 'service-description', ownerId: 'service-owner' };

function ServiceForm({
  formId,
  service,
  services,
  teams,
  onDirtyChange,
  onBusyChange,
  onDone,
}: {
  readonly formId: string;
  readonly service?: ServiceView;
  readonly services: readonly ServiceView[];
  readonly teams: readonly { readonly id: string; readonly name: string }[] | null;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onDone: () => void;
}): ReactNode {
  const [name, setName] = useState(service?.name ?? '');
  const [key, setKey] = useState(service?.key ?? '');
  const [keyState, setKeyState] = useState<KeyState>(service ? 'ok' : 'empty');
  const [description, setDescription] = useState(service?.description ?? '');
  const [owner, setOwner] = useState<PersonOption | null>(service?.owner ? { id: service.owner.id, name: service.owner.name } : null);
  const [groupId, setGroupId] = useState(service?.groupId ?? '');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);

  const touch = (change: () => void): void => {
    change();
    onDirtyChange(true);
  };

  const save = useMutation(
    async () => {
      if (service) {
        const patch: Record<string, unknown> = {};
        if (name.trim() !== service.name) patch.name = name.trim();
        if ((description.trim() || null) !== (service.description ?? null)) patch.description = description.trim() || null;
        if ((owner?.id ?? null) !== (service.ownerId ?? null)) patch.ownerId = owner?.id ?? null;
        if ((groupId || null) !== (service.groupId ?? null)) patch.groupId = groupId || null;
        if (Object.keys(patch).length === 0) return null;
        return api.configure.catalogue.updateService(service.key, patch);
      }
      return api.configure.catalogue.createService({
        key,
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(owner ? { ownerId: owner.id } : {}),
        ...(groupId ? { groupId } : {}),
      });
    },
    { success: () => (service ? `${name.trim()} saved` : `${name.trim()} added`), failure: service ? 'Couldn’t save the service' : 'Couldn’t add the service' },
  );

  const summary = Object.entries(errors).map(([field, message]) => ({ fieldId: IDS[field] ?? '', message }));

  return (
    <form
      id={formId}
      className="app-ServiceForm"
      noValidate
      aria-label={service ? `Edit ${service.name}` : 'New service'}
      onSubmit={async (event) => {
        event.preventDefault();
        const found: Record<string, string> = {};
        if (!name.trim()) found.name = 'Enter a name for the service.';
        else if (!service && keyState !== 'ok') found.key = keyState === 'taken' ? 'Another service already uses this key. Edit the key or change the name.' : 'Edit the key by hand: this name can’t make one.';
        setErrors(found);
        if (Object.keys(found).length > 0) {
          setAttempt((value) => value + 1);
          return;
        }
        onBusyChange(true);
        const result = await save.run();
        onBusyChange(false);
        if (result.ok) {
          onDirtyChange(false);
          onDone();
          return;
        }
        if (result.problem.status === 409) setErrors({ key: 'Another service already uses this key. Edit the key or change the name.' });
        else if (result.problem.status === 422) {
          const mapped: Record<string, string> = {};
          for (const [path, message] of Object.entries(result.problem.fieldErrors ?? {})) {
            const field = path.split('.')[0]!;
            mapped[field in IDS ? field : 'name'] ??= message;
          }
          setErrors(mapped);
        }
        setAttempt((value) => value + 1);
      }}
    >
      {summary.length > 0 ? <FormErrorSummary errors={summary} headingLevel={3} focusKey={attempt} /> : null}
      <FormSection title="Service" headingLevel={3}>
        <FormField label="Name" required hint="Like “Business applications” or “Workplace”." id={IDS.name!} counter={{ max: 120 }} {...(errors.name ? { error: errors.name } : {})}>
          <Input value={name} maxLength={120} autoComplete="off" onChange={(event) => touch(() => setName(event.currentTarget.value))} />
        </FormField>
        <div id={IDS.key} tabIndex={-1}>
          <KeyField
            source={name}
            rule="slug"
            value={key}
            onChange={setKey}
            onStateChange={setKeyState}
            taken={services.filter((entry) => entry.key !== service?.key).map((entry) => entry.key)}
            noun="service"
            locked={service !== undefined}
          />
          {errors.key ? <p className="app-FieldError">{errors.key}</p> : null}
        </div>
        <FormField label="Description" optional hint="What this service covers, in a sentence." id={IDS.description!} counter={{ max: 1000 }}>
          <Textarea rows={3} value={description} maxLength={1000} onChange={(event) => touch(() => setDescription(event.currentTarget.value))} />
        </FormField>
      </FormSection>
      <FormSection title="Who looks after it" headingLevel={3}>
        <FormField label="Owner" optional hint="The person who answers for this service." id={IDS.ownerId!}>
          {(control) => (
            <PersonPicker
              {...control}
              value={owner}
              placeholder="Search people"
              onChange={(next) => touch(() => setOwner(Array.isArray(next) ? (next[0] ?? null) : (next as PersonOption | null)))}
              loadPeople={async (query, signal) => {
                const people = await api.tenant.users({ q: query || undefined, limit: 20, status: 'active' });
                if (signal.aborted) return [];
                return people.map((person) => ({ id: person.id, name: person.displayName || person.email, ...(person.email ? { detail: person.email } : {}) }));
              }}
            />
          )}
        </FormField>
        {teams ? (
          <FormField label="Team" optional hint="Where its requests go, unless a request type names another team.">
            <Select
              value={groupId}
              options={[{ value: '', label: 'No team' }, ...teams.map((team) => ({ value: team.id, label: team.name }))]}
              onChange={(event) => touch(() => setGroupId(event.currentTarget.value))}
            />
          </FormField>
        ) : null}
      </FormSection>
    </form>
  );
}
