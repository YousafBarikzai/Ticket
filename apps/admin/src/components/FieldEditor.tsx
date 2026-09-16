'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@itsm/sdk';
import { Button, Checkbox, FormField, Input, Select, Textarea } from '@itsm/ui';
import { api } from '../client/api.js';
import { keyFor } from '../keys.js';

/**
 * Adding a custom field.
 *
 * The form asks for the four things that decide what a field *is* and leaves
 * the rest at their defaults, because a form that offers every column of
 * `field_definition` at once asks an administrator to make six decisions to
 * add one text box.
 *
 * Two of them are worth the space they take.
 *
 * **Who sees it** is a real choice with a real consequence, and the wrong
 * default is the expensive one: a field an administrator believed was internal
 * that turns out to reach the requester through the portal. So the control
 * says what each option means in the words of the consequence, and the default
 * is the narrow one.
 *
 * **The key cannot be changed later**, so it is shown as it will be stored
 * rather than derived silently from the label. An administrator who types
 * "Cost centre" and gets `costCentre` should see that before they save, not
 * discover it in an export six months later.
 */

const TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Longer text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'One of a list' },
  { value: 'multiselect', label: 'Several of a list' },
  { value: 'checkbox', label: 'Yes or no' },
];

const CLASSIFICATIONS = [
  { value: 'internal', label: 'The desk only — the requester never sees it' },
  { value: 'public', label: 'Everybody, including the requester in the portal' },
  { value: 'restricted', label: 'Only people holding a named permission' },
];

export function FieldEditor({ existingKeys }: { existingKeys: readonly string[] }): ReactNode {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  const [classification, setClassification] = useState('internal');
  const [options, setOptions] = useState('');
  const [visibleTo, setVisibleTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = keyFor(label);
  const needsOptions = type === 'select' || type === 'multiselect';
  const taken = key !== '' && existingKeys.includes(key);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.tenant.saveField(key, {
        label: label.trim(),
        type,
        classification,
        ...(needsOptions
          ? {
              options: options
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => ({ value: keyFor(line) || line, label: line })),
            }
          : {}),
        ...(classification === 'restricted'
          ? { visibleTo: visibleTo.split(',').map((entry) => entry.trim()).filter(Boolean) }
          : {}),
      });
      setLabel('');
      setOptions('');
      setVisibleTo('');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="itsm-FieldEditor" aria-label="Add a custom field">
      <h2>Add a field</h2>

      <FormField label="Label" hint="What somebody filling in a ticket will read.">
        {(control) => <Input {...control} value={label} onChange={(event) => setLabel(event.target.value)} />}
      </FormField>

      {key ? (
        <p className="itsm-FieldEditor__key">
          Stored as <code>{key}</code>.{' '}
          {taken ? <strong>That key is already in use — saving would edit the existing field.</strong> : 'This cannot be changed later.'}
        </p>
      ) : label.trim() !== '' ? (
        <p className="itsm-FieldEditor__key" role="alert">
          A field key has to start with a letter, and this label gives one that does not. Try a different wording —
          &ldquo;First line&rdquo; rather than &ldquo;1st line&rdquo;.
        </p>
      ) : null}

      <FormField label="Type">
        {(control) => (
          <Select {...control} options={TYPES} value={type} onChange={(event) => setType(event.target.value)} />
        )}
      </FormField>

      {needsOptions ? (
        <FormField label="Options" hint="One per line.">
          {(control) => (
            <Textarea {...control} value={options} onChange={(event) => setOptions(event.target.value)} rows={4} />
          )}
        </FormField>
      ) : null}

      <FormField label="Who sees it">
        {(control) => (
          <Select
            {...control}
            options={CLASSIFICATIONS}
            value={classification}
            onChange={(event) => setClassification(event.target.value)}
          />
        )}
      </FormField>

      {classification === 'restricted' ? (
        <FormField
          label="Permissions that may read it"
          hint="Comma separated, e.g. ticket.comment.internal. A restricted field naming nobody is readable by nobody."
        >
          {(control) => (
            <Input {...control} value={visibleTo} onChange={(event) => setVisibleTo(event.target.value)} />
          )}
        </FormField>
      ) : null}

      {error ? (
        <p className="itsm-FieldEditor__error" role="alert">
          {error}
        </p>
      ) : null}

      <Button
        variant="primary"
        onClick={() => void save()}
        loading={busy}
        loadingLabel="Saving"
        disabled={key === '' || (needsOptions && options.trim() === '')}
      >
        {taken ? 'Update this field' : 'Add field'}
      </Button>
    </section>
  );
}
