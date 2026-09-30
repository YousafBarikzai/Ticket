'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  CheckboxGroup,
  FormErrorSummary,
  FormField,
  FormSection,
  Icon,
  InlineAlert,
  Input,
  NumberField,
  RadioGroup,
  SegmentedControl,
  StatusPill,
} from '@itsm/ui';
import { Combobox, Sheet, type ComboboxOption } from '@itsm/ui/overlays';
import { FormRenderer, type FormValues } from '@itsm/ui/forms';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import type { KeyState } from '../../keys.js';
import { TICKET_TYPES } from '../../rules/facts.js';
import { ConditionBuilder } from '../ConditionBuilder.js';
import { KeyField } from '../KeyField.js';
import { OptionsEditor } from '../catalogue/OptionsEditor.js';
import { newOption, optionProblems, type OptionDraft } from '../catalogue/questions.js';
import {
  FIELD_FACTS,
  FIELD_TYPES,
  fieldHasOptions,
  fieldPayload,
  previewForm,
  requirementOf,
  STATUS_LOOK,
  typeInfo,
  VISIBILITY,
  type Classification,
  type FieldType,
  type FieldView,
  type Requirement,
} from './presentation.js';

/**
 * The field sheet (SPEC §6.1 `/fields`; F27): one sheet to add a field or
 * change one, with the control as the desk and the requester will see it.
 *
 * - **Label**, and the key made from it (camelCase, permanent once saved).
 * - **Type**, from seven; fixed once saved, and it says why.
 * - **Options** for a dropdown or multi-select: a row each, duplicates
 *   flagged, no comma-separated text.
 * - **Who sees it**: the desk, everyone, or only people holding a
 *   permission chosen by name — never typed.
 * - **Advanced**: which ticket types carry it, when it is required (never,
 *   always, or when a ticket's type, priority, impact, urgency or channel
 *   says so) and its position.
 *
 * Saving sends the whole row (`fieldPayload`), so nothing set elsewhere is
 * lost, and the sheet is a real `<form>`: Enter saves.
 */
export interface FieldSheetProps {
  readonly open: boolean;
  /** The field being changed; absent for a new one. */
  readonly field?: FieldView;
  readonly missing?: boolean;
  readonly fields: readonly FieldView[];
  /** Permissions to restrict a field to, in words. */
  readonly permissions: readonly { readonly key: string; readonly label: string; readonly description: string | null }[];
  readonly onClose: () => void;
  readonly onSaved: (key: string) => void;
}

export function FieldSheet({ open, field, missing = false, fields, permissions, onClose, onSaved }: FieldSheetProps): ReactNode {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const online = useOnline();
  const close = (): void => {
    setDirty(false);
    onClose();
  };
  const status = field ? STATUS_LOOK[field.status] : null;

  return (
    <Sheet
      open={open || missing}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      title={field ? field.label : missing ? 'Ticket field' : 'New field'}
      {...(field || missing ? {} : { description: 'Something every ticket can carry beyond a title and a description.' })}
      {...(status ? { headerMeta: <StatusPill size="sm" tone={status.tone} icon={status.icon} label={status.label} /> } : {})}
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
                  {field ? 'Save field' : 'Add field'}
                </Button>
              </div>
            ),
          })}
    >
      {missing ? (
        <InlineAlert tone="warning">That field no longer exists. It may have been renamed since the link was shared.</InlineAlert>
      ) : open ? (
        <FieldForm
          key={field?.key ?? 'new'}
          formId={formId}
          {...(field ? { field } : {})}
          fields={fields}
          permissions={permissions}
          onDirtyChange={setDirty}
          onBusyChange={setBusy}
          onDone={(key) => {
            setDirty(false);
            onSaved(key);
            onClose();
          }}
        />
      ) : null}
    </Sheet>
  );
}

const IDS: Readonly<Record<string, string>> = {
  label: 'field-label',
  key: 'field-key',
  type: 'field-type',
  options: 'field-options',
  classification: 'field-visibility',
  visibleTo: 'field-visible-to',
  requiredWhen: 'field-required',
  appliesTo: 'field-applies',
  order: 'field-order',
};

function FieldForm({
  formId,
  field,
  fields,
  permissions,
  onDirtyChange,
  onBusyChange,
  onDone,
}: {
  readonly formId: string;
  readonly field?: FieldView;
  readonly fields: readonly FieldView[];
  readonly permissions: FieldSheetProps['permissions'];
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onDone: (key: string) => void;
}): ReactNode {
  const [label, setLabel] = useState(field?.label ?? '');
  const [key, setKey] = useState(field?.key ?? '');
  const [keyState, setKeyState] = useState<KeyState>(field ? 'ok' : 'empty');
  const [type, setType] = useState<FieldType>((field?.type as FieldType | undefined) ?? 'text');
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    field ? field.options.map((option, index) => ({ id: `o:${index}`, label: option.label, value: option.value, auto: false })) : [newOption('Option 1'), newOption('Option 2')],
  );
  const [classification, setClassification] = useState<Classification>(field?.classification ?? 'internal');
  const [visibleTo, setVisibleTo] = useState<readonly string[]>(field?.visibleTo ?? []);
  const [appliesTo, setAppliesTo] = useState<readonly string[]>(field?.appliesTo ?? []);
  const [requirement, setRequirement] = useState<Requirement>(requirementOf(field?.requiredWhen));
  const [requiredWhen, setRequiredWhen] = useState<unknown>(field && requirementOf(field.requiredWhen) === 'when' ? field.requiredWhen : null);
  const [order, setOrder] = useState<number | null>(field?.order ?? nextOrder(fields));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);

  const touch = (change: () => void): void => {
    change();
    onDirtyChange(true);
  };

  const permissionOptions = useMemo<ComboboxOption[]>(
    () => permissions.map((permission) => ({ value: permission.key, label: permission.label, ...(permission.description ? { description: permission.description } : {}) })),
    [permissions],
  );
  const chosen = visibleTo.map((value) => permissionOptions.find((option) => option.value === value) ?? { value, label: value });

  const save = useMutation((payload: Record<string, unknown>) => api.tenant.saveField(key, payload), {
    success: () => `${label.trim()} saved`,
    failure: field ? 'Couldn’t save the field' : 'Couldn’t add the field',
  });

  const payload = (): Record<string, unknown> =>
    fieldPayload({
      label,
      type,
      options: options.map((option) => ({ value: option.value, label: option.label })),
      appliesTo,
      requiredWhen: requirement === 'never' ? null : requirement === 'always' ? { always: true } : requiredWhen,
      classification,
      visibleTo,
      order: order ?? 0,
    });

  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (!label.trim()) found.label = 'Enter a label for the field.';
    else if (!field && keyState !== 'ok') found.key = keyState === 'taken' ? 'Another field already uses this key. Edit the key or change the label.' : 'Edit the key by hand: this label can’t make one.';
    if (fieldHasOptions(type)) {
      const problems = optionProblems(options);
      if (options.length === 0) found.options = 'Add at least one option.';
      else if (problems.emptyLabels.size > 0) found.options = 'Every option needs words.';
      else if (problems.duplicateValues.size > 0 || problems.emptyValues.size > 0) found.options = 'Two options would be stored the same way. Reword one of them.';
    }
    if (classification === 'restricted' && visibleTo.length === 0) found.visibleTo = 'Choose at least one permission, or let the whole desk see it.';
    if (requirement === 'when' && (requiredWhen === null || (typeof requiredWhen === 'object' && (requiredWhen as { always?: unknown }).always === true))) {
      found.requiredWhen = 'Add a condition for when it’s required, or choose Always.';
    }
    if (order === null) found.order = 'Enter a position.';
    return found;
  };

  const summary = Object.entries(errors).map(([name, message]) => ({ fieldId: IDS[name] ?? '', message }));
  const [agentValues, setAgentValues] = useState<FormValues>({});
  const [requesterValues, setRequesterValues] = useState<FormValues>({});
  const preview = previewForm({ key, label, type, options, required: requirement === 'always' });

  return (
    <form
      id={formId}
      className="app-FieldForm"
      noValidate
      aria-label={field ? `Edit ${field.label}` : 'New field'}
      onSubmit={async (event) => {
        event.preventDefault();
        const found = validate();
        setErrors(found);
        if (Object.keys(found).length > 0) {
          setAttempt((value) => value + 1);
          return;
        }
        onBusyChange(true);
        const result = await save.run(payload());
        onBusyChange(false);
        if (result.ok) {
          onDone(key);
          return;
        }
        const problem = result.problem;
        if (problem.status === 409) setErrors({ type: problem.detail ?? 'This field’s type can’t change: tickets already hold values for it.' });
        else if (problem.status === 422) {
          const mapped: Record<string, string> = {};
          for (const [path, message] of Object.entries(problem.fieldErrors ?? {})) {
            const head = path.split('.')[0]!;
            const name = head === 'appliesTo' ? 'appliesTo' : head in IDS ? head : 'label';
            mapped[name] ??= message;
          }
          setErrors(mapped);
        }
        setAttempt((value) => value + 1);
      }}
    >
      {summary.length > 0 ? <FormErrorSummary errors={summary} headingLevel={3} focusKey={attempt} /> : null}
      {field && !field.isActive ? (
        <InlineAlert tone="info">This field is retired: it isn’t offered on tickets. Changes are kept for when it’s reactivated.</InlineAlert>
      ) : null}

      <FormSection title="Field" headingLevel={3}>
        <FormField label="Label" required hint="What the desk reads beside the value, like “Cost centre”." id={IDS.label!} counter={{ max: 200 }} {...(errors.label ? { error: errors.label } : {})}>
          <Input value={label} maxLength={200} autoComplete="off" onChange={(event) => touch(() => setLabel(event.currentTarget.value))} />
        </FormField>
        <div id={IDS.key} tabIndex={-1}>
          <KeyField source={label} rule="field" value={key} onChange={setKey} onStateChange={setKeyState} taken={fields.filter((entry) => entry.key !== field?.key).map((entry) => entry.key)} noun="field" locked={field !== undefined} />
          {errors.key ? <p className="app-FieldError">{errors.key}</p> : null}
        </div>
        <div id={IDS.type} tabIndex={-1}>
          {field ? (
            <div className="app-FieldForm__lockedType">
              <p className="app-FieldForm__typeLine">
                <Icon name={typeInfo(type).icon} size="sm" /> <strong>{typeInfo(type).label}</strong>
              </p>
              <p className="app-FieldForm__note">
                <Icon name="lock" size="xs" /> Tickets already hold values for this field, so its type can’t change. Retire it and add a new field to collect something of another type.
              </p>
            </div>
          ) : (
            <RadioGroup
              label="Type"
              variant="cards"
              columns={3}
              value={type}
              onChange={(value) =>
                touch(() => {
                  setType(value);
                  if (fieldHasOptions(value) && options.length === 0) setOptions([newOption('Option 1'), newOption('Option 2')]);
                })
              }
              options={FIELD_TYPES.map((entry) => ({ value: entry.type, label: entry.label, description: entry.description, icon: entry.icon }))}
            />
          )}
          {errors.type ? <p className="app-FieldError">{errors.type}</p> : null}
        </div>
        {fieldHasOptions(type) ? (
          <fieldset className="app-Inspector__group">
            <legend>Options</legend>
            <OptionsEditor
              id={IDS.options}
              label={`Options for ${label || 'this field'}`}
              options={options}
              showValues={field !== undefined}
              onChange={(next) => touch(() => setOptions(next))}
              {...(errors.options ? { error: errors.options } : {})}
            />
          </fieldset>
        ) : null}
      </FormSection>

      <FormSection title="Who sees it" headingLevel={3}>
        <div id={IDS.classification} tabIndex={-1}>
          <RadioGroup
            label="Who sees the value"
            labelHidden
            variant="cards"
            columns={3}
            value={classification}
            onChange={(value) => touch(() => setClassification(value))}
            options={(['internal', 'public', 'restricted'] as const).map((value) => ({ value, label: VISIBILITY[value].title, description: VISIBILITY[value].description, icon: VISIBILITY[value].icon }))}
          />
        </div>
        {classification === 'restricted' ? (
          <FormField
            label="Permissions that may see it"
            required
            hint="People who work tickets and hold any one of these."
            id={IDS.visibleTo!}
            {...(errors.visibleTo ? { error: errors.visibleTo } : {})}
          >
            {(control) => (
              <Combobox
                {...control}
                multiple
                options={permissionOptions}
                value={chosen}
                placeholder="Search permissions"
                emptyMessage="No permission matches"
                onChange={(next) => touch(() => setVisibleTo(next.map((option) => option.value)))}
              />
            )}
          </FormField>
        ) : null}
        {classification === 'public' ? <p className="app-FieldForm__note">Requesters see the value on their request in the portal.</p> : null}
      </FormSection>

      <FormSection
        title="Advanced"
        headingLevel={3}
        collapsible
        defaultOpen={Boolean(field && (field.appliesTo.length > 0 || requirementOf(field.requiredWhen) !== 'never'))}
        description="Which tickets carry it, when it must be filled in, and where it sits."
      >
        <div id={IDS.appliesTo} tabIndex={-1}>
          <CheckboxGroup
            label="Applies to"
            hint="None ticked means every type of ticket."
            orientation="horizontal"
            options={TICKET_TYPES.map((entry) => ({ value: entry.value, label: entry.label }))}
            value={[...appliesTo]}
            onChange={(next) => touch(() => setAppliesTo(next))}
          />
        </div>
        <fieldset className="app-Inspector__group" id={IDS.requiredWhen} tabIndex={-1}>
          <legend>Required</legend>
          <SegmentedControl
            label="Required"
            mode="value"
            size="sm"
            value={requirement}
            onValueChange={(value) => touch(() => setRequirement(value as Requirement))}
            options={[
              { value: 'never', label: 'Never' },
              { value: 'always', label: 'Always' },
              { value: 'when', label: 'When…' },
            ]}
          />
          {requirement === 'when' ? (
            <ConditionBuilder
              label="Required when"
              value={requiredWhen ?? undefined}
              factCatalogue={FIELD_FACTS}
              emptyText="Never"
              onChange={(expression) => touch(() => setRequiredWhen(expression))}
            />
          ) : null}
          {requirement === 'always' ? <p className="app-FieldForm__note">A ticket can’t be saved without it — including tickets raised by email or through the API.</p> : null}
          {errors.requiredWhen ? <p className="app-FieldError">{errors.requiredWhen}</p> : null}
        </fieldset>
        <FormField label="Position" hint="Lower numbers come first. Move up and Move down in the list do this for you." id={IDS.order!} {...(errors.order ? { error: errors.order } : {})}>
          {(control) => <NumberField {...control} value={order} min={0} max={10_000} step={10} onChange={(next) => touch(() => setOrder(next))} />}
        </FormField>
      </FormSection>

      <FormSection title="Preview" headingLevel={3} description="The control as it will appear. Answers here aren’t saved.">
        <div className="app-FieldPreview">
          <div className="app-FieldPreview__pane">
            <p className="app-FieldPreview__label">As the desk sees it</p>
            <FormRenderer definition={preview} values={agentValues} onChange={setAgentValues} headingLevel={3} />
          </div>
          <div className="app-FieldPreview__pane">
            <p className="app-FieldPreview__label">As the requester sees it</p>
            {classification === 'public' ? (
              <FormRenderer definition={preview} values={requesterValues} onChange={setRequesterValues} headingLevel={3} />
            ) : (
              <p className="app-FieldPreview__none">
                <Icon name="eye-off" size="sm" /> Requesters never see this field.
              </p>
            )}
          </div>
        </div>
      </FormSection>
    </form>
  );
}

/** A new field goes last: ten after the highest position so far. */
function nextOrder(fields: readonly FieldView[]): number {
  const highest = fields.reduce((max, field) => Math.max(max, field.order), 0);
  return Math.min(10_000, highest + 10);
}
