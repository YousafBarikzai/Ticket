'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CiAttribute, CiClassRow, CiInput, CiRow } from '@itsm/sdk';
import { Button, FormErrorSummary, FormField, FormSection, InlineAlert, Input, SegmentedControl, Select, SkeletonText, Textarea } from '@itsm/ui';
import { DatePicker, PersonPicker, type PersonOption } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useMutation } from '../../client/useMutation.js';
import {
  CRITICALITIES,
  CRITICALITY_LOOK,
  ENVIRONMENT_SUGGESTIONS,
  attributeValues,
  classOptions,
  classTree,
  draftOf,
  type AttributeDraft,
  type CiView,
  type Criticality,
} from './presentation.js';

/**
 * A configuration item's fields, for *New item* and for *Edit* in its drawer
 * (SPEC §6.1): the class first — it decides the rest — then name,
 * criticality, environment, service, owner, and the class's own attributes
 * as typed fields (a date picker for a date, a choice for an enum, Yes/No
 * for a yes-or-no), checked the way the API checks them before anything is
 * sent.
 *
 * An edit sends only what changed. The API keeps a value it is not sent and
 * cannot clear a service, an owner or an identifier once set, so those
 * fields say so rather than appearing to clear and silently not.
 */

export interface CiFormProps {
  readonly formId: string;
  /** The item being edited; a new one without. */
  readonly ci?: CiView;
  readonly classes: readonly CiClassRow[];
  /** A new item's class, chosen before the sheet opened (the class the page shows). */
  readonly initialClassKey?: string | null;
  readonly services: readonly { readonly id: string; readonly name: string }[] | null;
  onDirtyChange(dirty: boolean): void;
  onBusyChange(busy: boolean): void;
  /**
   * Saved: the API's row, and the owner's name the form knows (a new owner is
   * not in any list yet). An edit has refreshed the page already; a new item
   * has not — its caller moves to the item's drawer first, then refreshes.
   */
  onDone(saved: CiRow | null, owner: PersonOption | null): void;
}

const IDS = {
  classKey: 'ci-class',
  name: 'ci-name',
  criticality: 'ci-criticality',
  environment: 'ci-environment',
  serviceId: 'ci-service',
  ownerId: 'ci-owner',
  externalKey: 'ci-external-key',
  description: 'ci-description',
} as const;

const attributeId = (key: string): string => `ci-attribute-${key}`;

type Attributes = { readonly status: 'idle' } | { readonly status: 'loading' } | { readonly status: 'ready'; readonly list: readonly CiAttribute[] } | { readonly status: 'failed' };

export function CiForm({ formId, ci, classes, initialClassKey, services, onDirtyChange, onBusyChange, onDone }: CiFormProps): ReactNode {
  const tree = useMemo(() => classTree(classes), [classes]);
  const [classKey, setClassKey] = useState(ci?.classKey ?? (initialClassKey && classes.some((row) => row.key === initialClassKey) ? initialClassKey : ''));
  const [name, setName] = useState(ci?.name ?? '');
  const [criticality, setCriticality] = useState<Criticality>((ci?.criticality as Criticality) ?? 'medium');
  const [environment, setEnvironment] = useState(ci?.environment ?? '');
  const [serviceId, setServiceId] = useState(ci?.serviceId ?? '');
  const [owner, setOwner] = useState<PersonOption | null>(ci?.owner ? { id: ci.owner.id, name: ci.owner.name ?? 'Unknown person' } : null);
  const [externalKey, setExternalKey] = useState(ci?.externalKey ?? '');
  const [description, setDescription] = useState(ci?.description ?? '');
  const [draft, setDraft] = useState<AttributeDraft>({});
  const [attributes, setAttributes] = useState<Attributes>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const touch = (change: () => void): void => {
    change();
    onDirtyChange(true);
  };

  // The class's attributes, inheritance included, whenever the class changes.
  useEffect(() => {
    if (!classKey) {
      setAttributes({ status: 'idle' });
      return;
    }
    let live = true;
    setAttributes({ status: 'loading' });
    api.observe.estate.classAttributes(classKey).then(
      (list) => {
        if (!live) return;
        setAttributes({ status: 'ready', list });
        setDraft(draftOf(list, ci?.attributes ?? {}));
      },
      () => {
        if (live) setAttributes({ status: 'failed' });
      },
    );
    return () => {
      live = false;
    };
    // `ci` is fixed for the form's life (it is keyed by the item).
  }, [classKey, loadAttempt]);

  const save = useMutation(
    async (input: { readonly create?: CiInput; readonly patch?: Record<string, unknown> }) => {
      if (input.create) return api.observe.estate.createCi(input.create);
      if (ci && input.patch) return api.observe.estate.updateCi(ci.id, input.patch);
      return null;
    },
    {
      success: (saved) => (saved ? (ci ? `${saved.name} saved` : `${saved.name} added`) : 'Nothing to save'),
      failure: ci ? 'Couldn’t save the item' : 'Couldn’t add the item',
      // A new item's sheet gives way to its drawer, which changes the URL; the
      // page refreshes after that (`onDone`), not during it — a refresh begun
      // for the old address and answered for the new one reloads the page.
      refresh: ci !== undefined,
    },
  );

  const submit = async (): Promise<void> => {
    const found: Record<string, string> = {};
    if (!ci && !classKey) found.classKey = 'Choose a class. It decides which details an item carries.';
    if (!name.trim()) found.name = 'Enter a name.';
    if (ci?.serviceId && !serviceId) found.serviceId = 'A service can’t be removed from an item once set. Choose another service.';
    if (ci?.owner && !owner) found.ownerId = 'An owner can’t be removed once set. Choose someone else.';
    if (ci?.externalKey && !externalKey.trim()) found.externalKey = 'An identifier can’t be removed once set. Change it instead.';
    let values: Record<string, unknown> = {};
    const hasClass = Boolean(classKey);
    if (hasClass && attributes.status !== 'ready') {
      found.attributes = attributes.status === 'failed' ? 'The class’s details couldn’t be loaded. Try again before saving.' : 'The class’s details are still loading.';
    } else if (attributes.status === 'ready') {
      const checked = attributeValues(attributes.list, draft, ci ? ci.attributes : undefined);
      values = checked.values;
      for (const [key, message] of Object.entries(checked.problems)) found[`attributes.${key}`] = message;
    }
    setErrors(found);
    setAttempt((value) => value + 1);
    if (Object.keys(found).length > 0) return;

    let payload: { create?: CiInput; patch?: Record<string, unknown> };
    if (!ci) {
      payload = {
        create: {
          classKey,
          name: name.trim(),
          criticality,
          ...(environment.trim() ? { environment: environment.trim() } : {}),
          ...(serviceId ? { serviceId } : {}),
          ...(owner ? { ownerId: owner.id } : {}),
          ...(externalKey.trim() ? { externalKey: externalKey.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          attributes: values,
        },
      };
    } else {
      const patch: Record<string, unknown> = {};
      if (name.trim() !== ci.name) patch.name = name.trim();
      if (criticality !== ci.criticality) patch.criticality = criticality;
      if (environment.trim() !== (ci.environment ?? '')) patch.environment = environment.trim();
      if (serviceId && serviceId !== (ci.serviceId ?? '')) patch.serviceId = serviceId;
      if (owner && owner.id !== (ci.owner?.id ?? null)) patch.ownerId = owner.id;
      if (externalKey.trim() && externalKey.trim() !== (ci.externalKey ?? '')) patch.externalKey = externalKey.trim();
      if (description.trim() !== (ci.description ?? '')) patch.description = description.trim();
      if (Object.keys(values).length > 0) patch.attributes = values;
      if (Object.keys(patch).length === 0) {
        onDirtyChange(false);
        onDone(null, owner);
        return;
      }
      payload = { patch };
    }

    onBusyChange(true);
    const result = await save.run(payload);
    onBusyChange(false);
    if (result.ok) {
      onDirtyChange(false);
      onDone(result.value, owner);
      return;
    }
    const problem = result.problem;
    if (problem.status === 409) setErrors({ externalKey: 'Another item already has this identifier. Identifiers are what discovery and imports match on, so each must be unique.' });
    else if (problem.status === 422) setErrors(mapFieldErrors(problem.fieldErrors ?? {}, problem.detail));
    else if (problem.status === 404 && !ci) setErrors({ classKey: 'That class no longer exists. Choose another.' });
    setAttempt((value) => value + 1);
  };

  const definitions = attributes.status === 'ready' ? attributes.list : [];
  const summary = Object.entries(errors).map(([field, message]) => ({
    fieldId: field.startsWith('attributes.') ? attributeId(field.slice('attributes.'.length)) : field === 'attributes' ? '' : (IDS[field as keyof typeof IDS] ?? IDS.name),
    message,
  }));
  const className = ci ? (ci.className ?? 'Unknown class') : (classes.find((row) => row.key === classKey)?.name ?? null);
  const serviceOptions = services ?? [];
  const knownService = !ci?.serviceId || serviceOptions.some((service) => service.id === ci.serviceId);

  return (
    <form
      id={formId}
      className="app-CmdbForm"
      noValidate
      aria-label={ci ? `Edit ${ci.name}` : 'New configuration item'}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {summary.length > 0 ? <FormErrorSummary errors={summary} headingLevel={3} focusKey={attempt} /> : null}

      <FormSection title="What it is" headingLevel={3}>
        {ci ? (
          <p className="app-CmdbForm__fixed">
            <span className="app-CmdbForm__fixedLabel">Class</span> {className}
            <span className="app-CmdbForm__fixedHint">An item’s class can’t change; retire it and record it again under the right class.</span>
          </p>
        ) : (
          <FormField label="Class" required id={IDS.classKey} hint="Decides the details an item carries." {...(errors.classKey ? { error: errors.classKey } : {})}>
            <Select
              value={classKey}
              placeholder="Choose a class"
              options={classOptions(tree)}
              onChange={(event) => touch(() => setClassKey(event.currentTarget.value))}
            />
          </FormField>
        )}
        <FormField label="Name" required id={IDS.name} counter={{ max: 200 }} hint="What people call it, like “Orders database” or “Leeds office Wi-Fi”." {...(errors.name ? { error: errors.name } : {})}>
          <Input value={name} maxLength={200} autoComplete="off" onChange={(event) => touch(() => setName(event.currentTarget.value))} />
        </FormField>
        <div className="app-CmdbForm__segment" id={IDS.criticality}>
          {/* Seen here; the group is named by its own label, so this is not read twice. */}
          <span className="app-CmdbForm__label" aria-hidden="true">
            Criticality
          </span>
          <p className="app-CmdbForm__hint">How much it matters when it fails. Impact lists put critical items first.</p>
          <SegmentedControl
            label="Criticality"
            mode="value"
            fullWidth
            value={criticality}
            options={CRITICALITIES.map((value) => ({ value, label: CRITICALITY_LOOK[value]!.label }))}
            onValueChange={(value) => touch(() => setCriticality(value as Criticality))}
          />
          {errors.criticality ? <p className="app-CmdbFieldError">{errors.criticality}</p> : null}
        </div>
        <FormField label="Environment" optional id={IDS.environment} hint="Production, Staging, or your own word." {...(errors.environment ? { error: errors.environment } : {})}>
          <Input value={environment} maxLength={60} list={`${formId}-environments`} autoComplete="off" onChange={(event) => touch(() => setEnvironment(event.currentTarget.value))} />
        </FormField>
        <datalist id={`${formId}-environments`}>
          {ENVIRONMENT_SUGGESTIONS.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <FormField label="Description" optional id={IDS.description} {...(errors.description ? { error: errors.description } : {})}>
          <Textarea rows={3} value={description} maxLength={10_000} onChange={(event) => touch(() => setDescription(event.currentTarget.value))} />
        </FormField>
      </FormSection>

      <FormSection title="Who and what it serves" headingLevel={3}>
        {services && knownService ? (
          <FormField label="Service" optional={!ci?.serviceId} id={IDS.serviceId} hint="The catalogue service it supports." {...(errors.serviceId ? { error: errors.serviceId } : {})}>
            <Select
              value={serviceId}
              options={[...(ci?.serviceId ? [] : [{ value: '', label: 'No service' }]), ...serviceOptions.map((service) => ({ value: service.id, label: service.name }))]}
              onChange={(event) => touch(() => setServiceId(event.currentTarget.value))}
            />
          </FormField>
        ) : ci?.serviceId ? (
          <p className="app-CmdbForm__fixed">
            <span className="app-CmdbForm__fixedLabel">Service</span> {ci.serviceName ?? 'A service you can’t see in the catalogue'}
          </p>
        ) : null}
        <FormField label="Owner" optional={!ci?.owner} id={IDS.ownerId} hint="The person who answers for it." {...(errors.ownerId ? { error: errors.ownerId } : {})}>
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
        <FormField
          label="Identifier"
          optional={!ci?.externalKey}
          id={IDS.externalKey}
          hint="The name discovery or an import knows it by, like a hostname. Must be unique."
          {...(errors.externalKey ? { error: errors.externalKey } : {})}
        >
          <Input value={externalKey} maxLength={200} autoComplete="off" spellCheck={false} onChange={(event) => touch(() => setExternalKey(event.currentTarget.value))} />
        </FormField>
      </FormSection>

      {classKey || ci ? (
        <FormSection title={className ? `${className} details` : 'Details'} headingLevel={3}>
          {!classKey ? (
            <p className="app-CmdbForm__hint app-CmdbForm__note">This item’s class isn’t known to this page, so its details can’t be edited here.</p>
          ) : attributes.status === 'loading' || attributes.status === 'idle' ? (
            <div aria-busy="true">
              <SkeletonText lines={3} />
              <span className="itsm-visually-hidden" role="status">
                Loading the class’s details…
              </span>
            </div>
          ) : attributes.status === 'failed' ? (
            <InlineAlert tone="danger">
              Couldn’t load the details this class asks for.{' '}
              <Button variant="ghost" size="sm" onClick={() => setLoadAttempt((value) => value + 1)}>
                Try again
              </Button>
            </InlineAlert>
          ) : definitions.length === 0 ? (
            <p className="app-CmdbForm__hint app-CmdbForm__note">This class asks for no other details.</p>
          ) : (
            definitions.map((definition) => (
              <AttributeField
                key={definition.key}
                definition={definition}
                value={draft[definition.key] ?? ''}
                {...(errors[`attributes.${definition.key}`] ? { error: errors[`attributes.${definition.key}`] } : {})}
                onChange={(value) => touch(() => setDraft((current) => ({ ...current, [definition.key]: value })))}
              />
            ))
          )}
        </FormSection>
      ) : null}
    </form>
  );
}

/** The API's 422 field paths onto this form's fields; anything else is said at the top. */
export function mapFieldErrors(fieldErrors: Readonly<Record<string, string>>, detail?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, message] of Object.entries(fieldErrors)) {
    if (path.startsWith('attributes.')) out[path] = message;
    else {
      const field = path.split('.')[0]!;
      out[field in IDS ? field : 'name'] ??= message;
    }
  }
  if (Object.keys(out).length === 0) out.name = detail ?? 'Something in the form isn’t right. Check each field and try again.';
  return out;
}

/** One class attribute as the control its type calls for. */
export function AttributeField({
  definition,
  value,
  error,
  onChange,
}: {
  readonly definition: CiAttribute;
  readonly value: string;
  readonly error?: string;
  onChange(value: string): void;
}): ReactNode {
  const common = {
    label: definition.label,
    id: attributeId(definition.key),
    ...(definition.required ? { required: true } : { optional: true }),
    ...(error ? { error } : {}),
  };
  const notSet = definition.required ? [] : [{ value: '', label: 'Not set' }];
  switch (definition.type) {
    case 'boolean':
      return (
        <FormField {...common}>
          <Select
            value={value}
            {...(definition.required ? { placeholder: 'Choose' } : {})}
            options={[...notSet, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        </FormField>
      );
    case 'enum':
      return (
        <FormField {...common}>
          <Select
            value={value}
            {...(definition.required ? { placeholder: 'Choose' } : {})}
            options={[...notSet, ...(definition.options ?? []).map((option) => ({ value: option, label: option }))]}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        </FormField>
      );
    case 'date':
      return (
        <FormField {...common}>
          {(control) => <DatePicker {...control} value={value || null} onChange={(next) => onChange(next ?? '')} />}
        </FormField>
      );
    case 'number':
      return (
        <FormField {...common}>
          <Input value={value} inputMode="decimal" autoComplete="off" onChange={(event) => onChange(event.currentTarget.value)} />
        </FormField>
      );
    default:
      return (
        <FormField {...common}>
          <Input value={value} autoComplete="off" onChange={(event) => onChange(event.currentTarget.value)} />
        </FormField>
      );
  }
}
