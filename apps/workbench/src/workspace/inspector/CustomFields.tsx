'use client';

import type { ReactNode } from 'react';
import type { FieldRow, Ticket } from '@itsm/sdk';
import { Checkbox, CheckboxGroup, FormField, InlineEdit, Input, Select, Textarea, type InlineEditResult } from '@itsm/ui';
import { customValueText } from '../../client/mutations.js';

/**
 * The desk's own fields (SPEC §6.2 "Custom fields"): typed by the field
 * definitions, edited in place with `PATCH {custom: {key: value}}`, which the
 * service merges — changing one never clears another.
 *
 * The simple types are edited inline (text, long text, number, date, a
 * choice, yes or no). A field that holds several choices is shown but not
 * edited here: a list editor inside a 320 px column would be worse than
 * saying so. A restricted field the reader may not see is left out by the
 * service's lens, so it is only listed when the ticket carries a value.
 */

/** The fields that belong on this ticket, in the desk's order. */
export function applicableFields(fields: readonly FieldRow[] | null | undefined, ticket: Pick<Ticket, 'type' | 'custom'>): FieldRow[] {
  if (!fields) return [];
  return fields
    .filter((field) => field.isActive)
    .filter((field) => field.appliesTo.types.length === 0 || field.appliesTo.types.includes(ticket.type))
    .filter((field) => field.classification !== 'restricted' || Object.prototype.hasOwnProperty.call(ticket.custom ?? {}, field.key))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

/** Whether a field can be edited in one step here. */
export function editableInline(field: FieldRow): boolean {
  return field.type !== 'multiselect';
}

/** A stored value as the editor's string: `''` for nothing, `'true'`/`'false'` for a checkbox, `YYYY-MM-DD` for a date. */
export function toEditorValue(field: FieldRow, value: unknown): string {
  if (value === null || value === undefined) return '';
  switch (field.type) {
    case 'checkbox':
      return value === true ? 'true' : value === false ? 'false' : '';
    case 'date':
      return typeof value === 'string' ? value.slice(0, 10) : '';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
    case 'multiselect':
      return Array.isArray(value) ? value.join(', ') : '';
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

/** The editor's string as the value to store; `null` clears the field. */
export function fromEditorValue(field: FieldRow, text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  switch (field.type) {
    case 'checkbox':
      return trimmed === 'true';
    case 'number':
      return Number(trimmed.replace(',', '.'));
    default:
      return field.type === 'textarea' ? text : trimmed;
  }
}

/** A value in words, with a choice's label rather than its stored value. */
export function fieldValueText(field: FieldRow, value: unknown): string {
  if (field.type === 'select' && typeof value === 'string') return field.options.find((option) => option.value === value)?.label ?? value;
  if (field.type === 'multiselect' && Array.isArray(value)) {
    const labels = value.map((entry) => field.options.find((option) => option.value === entry)?.label ?? String(entry));
    return labels.length > 0 ? labels.join(', ') : 'Not set';
  }
  return customValueText(value);
}

function validateNumber(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return Number.isFinite(Number(trimmed.replace(',', '.'))) ? null : 'Enter a number, like 12 or 3.5';
}

const YES_NO = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
] as const;

/* ------------------------------------------------------------ Inspector */

export interface CustomFieldRowsProps {
  readonly fields: readonly FieldRow[];
  readonly ticket: Pick<Ticket, 'custom'>;
  /** Why nothing can be edited ("Needs a connection", or no right to edit the ticket); absent when it can. */
  readonly readOnlyReason?: string;
  readonly onSave: (field: FieldRow, value: unknown) => Promise<InlineEditResult>;
}

/** The fields as rows of a description list, each its own editor. */
export function CustomFieldRows({ fields, ticket, readOnlyReason, onSave }: CustomFieldRowsProps): ReactNode {
  return (
    <dl className="app-InspRows">
      {fields.map((field) => {
        const value = ticket.custom?.[field.key];
        const text = toEditorValue(field, value);
        const reason = readOnlyReason ?? (editableInline(field) ? undefined : 'Several choices can’t be changed here yet');
        const common = {
          label: field.label,
          value: text,
          display: text === '' ? undefined : fieldValueText(field, value),
          onSave: (next: string) => onSave(field, fromEditorValue(field, next)),
          ...(reason ? { readOnlyReason: reason } : {}),
        };
        let editor: ReactNode;
        switch (field.type) {
          case 'textarea':
            editor = <InlineEdit {...common} editor="textarea" />;
            break;
          case 'number':
            editor = <InlineEdit {...common} editor="text" validate={validateNumber} />;
            break;
          case 'date':
            editor = <InlineEdit {...common} editor="date" />;
            break;
          case 'select':
            editor = <InlineEdit {...common} editor="select" options={field.options} />;
            break;
          case 'checkbox':
            editor = <InlineEdit {...common} editor="select" options={YES_NO} />;
            break;
          default:
            editor = <InlineEdit {...common} editor="text" />;
        }
        return (
          <div key={field.key} className="app-InspRow" data-field={`custom.${field.key}`}>
            <dt className="app-InspRow__label">{field.label}</dt>
            <dd className="app-InspRow__value">{editor}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/* -------------------------------------------------------------- A form */

export interface CustomFieldControlProps {
  readonly field: FieldRow;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly error?: string;
}

/** One field as a form control, for the new-ticket sheet. */
export function CustomFieldControl({ field, value, onChange, error }: CustomFieldControlProps): ReactNode {
  const errorProps = error ? { error } : {};
  switch (field.type) {
    case 'checkbox':
      return (
        <div className="app-NewTicket__check">
          <Checkbox label={field.label} checked={value === true} onChange={(event) => onChange(event.target.checked ? true : null)} />
          {error ? <p className="app-NewTicket__error">{error}</p> : null}
        </div>
      );
    case 'multiselect':
      return (
        <CheckboxGroup
          label={field.label}
          options={field.options.map((option) => ({ value: option.value, label: option.label }))}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={(next) => onChange(next.length > 0 ? [...next] : null)}
          {...errorProps}
        />
      );
    case 'select':
      return (
        <FormField label={field.label} optional {...errorProps}>
          <Select
            value={typeof value === 'string' ? value : ''}
            placeholder="Not set"
            options={field.options.map((option) => ({ value: option.value, label: option.label }))}
            onChange={(event) => onChange(event.target.value || null)}
          />
        </FormField>
      );
    case 'textarea':
      return (
        <FormField label={field.label} optional {...errorProps}>
          <Textarea value={typeof value === 'string' ? value : ''} rows={3} onChange={(event) => onChange(event.target.value || null)} />
        </FormField>
      );
    case 'number':
      return (
        <FormField label={field.label} optional {...errorProps}>
          <Input
            inputMode="decimal"
            value={typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''}
            onChange={(event) => {
              const text = event.target.value;
              const number = Number(text.replace(',', '.'));
              onChange(text.trim() === '' ? null : Number.isFinite(number) ? number : text);
            }}
          />
        </FormField>
      );
    case 'date':
      return (
        <FormField label={field.label} optional {...errorProps}>
          <Input type="date" value={typeof value === 'string' ? value.slice(0, 10) : ''} onChange={(event) => onChange(event.target.value || null)} />
        </FormField>
      );
    default:
      return (
        <FormField label={field.label} optional {...errorProps}>
          <Input value={typeof value === 'string' ? value : ''} autoComplete="off" onChange={(event) => onChange(event.target.value || null)} />
        </FormField>
      );
  }
}
