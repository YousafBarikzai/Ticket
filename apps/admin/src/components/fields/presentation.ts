import type { FormDefinition } from '@itsm/contracts/forms';
import type { IconName, Tone } from '@itsm/ui';
import { CHANNELS, LEVELS, PRIORITIES, TICKET_TYPES, type Fact } from '../../rules/facts.js';
import { describeCondition } from '../catalogue/describe.js';
import { readsOf } from '../catalogue/questions.js';

/**
 * Ticket fields in words (SPEC §6.1 `/fields`; F27): what type a field is,
 * who sees its value, which tickets carry it and when it must be filled in
 * — and the one function that writes a field back whole.
 *
 * `fieldPayload` is the fix for the silent wipe. The API's save is a full
 * replace (`PUT /field-definitions/:key`, defaults for anything left out),
 * and the old editor sent four of the eight columns — so renaming a field
 * reset where it applied, when it was required and its position. Every
 * write here (the sheet, Move up/down) sends every column, from the row as
 * it was read with the change applied.
 */

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect' | 'checkbox';
export type Classification = 'internal' | 'public' | 'restricted';

export const FIELD_TYPES: readonly { readonly type: FieldType; readonly label: string; readonly icon: IconName; readonly description: string }[] = [
  { type: 'text', label: 'Text', icon: 'pencil', description: 'A line of text, like an asset tag.' },
  { type: 'textarea', label: 'Paragraph', icon: 'note', description: 'Several lines of text.' },
  { type: 'number', label: 'Number', icon: 'sliders-horizontal', description: 'A number, like a cost.' },
  { type: 'date', label: 'Date', icon: 'calendar', description: 'A day, like a due date.' },
  { type: 'select', label: 'Dropdown', icon: 'chevrons-up-down', description: 'One choice from a list.' },
  { type: 'multiselect', label: 'Multi-select', icon: 'list-filter', description: 'Several choices from a list.' },
  { type: 'checkbox', label: 'Yes/No', icon: 'circle-check', description: 'A tick box.' },
];

export function typeInfo(type: string): { readonly label: string; readonly icon: IconName } {
  return FIELD_TYPES.find((entry) => entry.type === type) ?? { label: type, icon: 'fields' };
}

export function fieldHasOptions(type: string): boolean {
  return type === 'select' || type === 'multiselect';
}

export const VISIBILITY: Readonly<Record<Classification, { readonly label: string; readonly title: string; readonly description: string; readonly icon: IconName }>> = {
  internal: { label: 'Desk', title: 'The desk', description: 'Anyone who works tickets. Requesters never see it.', icon: 'people' },
  public: { label: 'Everyone', title: 'Everyone', description: 'The desk, and the requester in the portal.', icon: 'globe' },
  restricted: { label: 'Restricted', title: 'Restricted', description: 'Only people who work tickets and hold a permission you choose.', icon: 'lock' },
};

export const STATUS_LOOK: Readonly<Record<'active' | 'retired', { readonly label: string; readonly tone: Tone; readonly icon: IconName }>> = {
  active: { label: 'Active', tone: 'success', icon: 'circle-check' },
  retired: { label: 'Retired', tone: 'neutral', icon: 'archive' },
};

/**
 * What a field's *Required when* is worked out against: the ticket as it is
 * created or changed (`validateCustom` in the ticket service), with its
 * facts at the top level — `priority`, not `ticket.priority`, which is the
 * rules engine's spelling and would never match here.
 */
export const FIELD_FACTS: readonly Fact[] = [
  { path: 'type', label: 'Type', kind: 'enum', options: TICKET_TYPES, group: 'Ticket' },
  { path: 'priority', label: 'Priority', kind: 'enum', options: PRIORITIES, group: 'Ticket' },
  { path: 'impact', label: 'Impact', kind: 'enum', options: LEVELS, group: 'Ticket' },
  { path: 'urgency', label: 'Urgency', kind: 'enum', options: LEVELS, group: 'Ticket' },
  { path: 'sourceChannel', label: 'Channel it was raised by', kind: 'enum', options: CHANNELS, group: 'Ticket' },
];

export type Requirement = 'never' | 'always' | 'when';

export function requirementOf(requiredWhen: unknown): Requirement {
  if (requiredWhen === null || requiredWhen === undefined) return 'never';
  if (typeof requiredWhen === 'object' && (requiredWhen as { always?: unknown }).always === true) return 'always';
  return 'when';
}

/** "No", "Always", "When Priority is P1 · Critical". */
export function requiredLabel(requiredWhen: unknown): string {
  const requirement = requirementOf(requiredWhen);
  if (requirement === 'never') return 'No';
  if (requirement === 'always') return 'Always';
  return `When ${describeCondition(requiredWhen, FIELD_FACTS)}`;
}

export function appliesLabel(types: readonly string[]): string {
  if (types.length === 0) return 'All types';
  return types.map((type) => TICKET_TYPES.find((entry) => entry.value === type)?.label ?? type).join(', ');
}

/** A field as the API returns it (`FieldRow`). */
export interface FieldRowLike {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly appliesTo: { readonly types: readonly string[] };
  readonly requiredWhen: unknown;
  readonly visibleTo: readonly string[];
  readonly classification: string;
  readonly order: number;
  readonly isActive: boolean;
}

export interface FieldView extends Record<string, unknown> {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly typeLabel: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly appliesTo: readonly string[];
  readonly appliesLabel: string;
  readonly requiredWhen: unknown;
  readonly requiredLabel: string;
  readonly classification: Classification;
  readonly visibilityLabel: string;
  readonly visibleTo: readonly string[];
  /** The permissions a restricted field names, in words. */
  readonly visibleToLabels: readonly string[];
  readonly order: number;
  readonly isActive: boolean;
  readonly status: 'active' | 'retired';
  /** Rules whose conditions read this field, by name. */
  readonly usedByRules: readonly string[];
}

export function fieldView(row: FieldRowLike, permissionName: (key: string) => string, usedByRules: readonly string[] = []): FieldView {
  const classification = (['internal', 'public', 'restricted'].includes(row.classification) ? row.classification : 'internal') as Classification;
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type,
    typeLabel: typeInfo(row.type).label,
    options: row.options,
    appliesTo: row.appliesTo.types,
    appliesLabel: appliesLabel(row.appliesTo.types),
    requiredWhen: row.requiredWhen ?? null,
    requiredLabel: requiredLabel(row.requiredWhen),
    classification,
    visibilityLabel: VISIBILITY[classification].label,
    visibleTo: row.visibleTo,
    visibleToLabels: row.visibleTo.map(permissionName),
    order: row.order,
    isActive: row.isActive,
    status: row.isActive ? 'active' : 'retired',
    usedByRules,
  };
}

export interface FieldInput {
  readonly label: string;
  readonly type: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly appliesTo: readonly string[];
  readonly requiredWhen: unknown;
  readonly classification: string;
  readonly visibleTo: readonly string[];
  readonly order: number;
}

/**
 * The whole row, as `PUT /field-definitions/:key` takes it. Options only
 * for a list type and permissions only for a restricted field, because the
 * API refuses either where it does not apply rather than ignoring it.
 */
export function fieldPayload(input: FieldInput): Record<string, unknown> {
  return {
    label: input.label.trim(),
    type: input.type,
    options: fieldHasOptions(input.type) ? input.options.map((option) => ({ value: option.value, label: option.label.trim() })) : [],
    appliesTo: { types: [...input.appliesTo] },
    requiredWhen: input.requiredWhen ?? null,
    classification: input.classification,
    visibleTo: input.classification === 'restricted' ? [...input.visibleTo] : [],
    order: input.order,
  };
}

/** The row as it stands, for a write that changes one thing (Move up/down, reactivate). */
export function payloadOf(view: FieldView, change: Partial<FieldInput> = {}): Record<string, unknown> {
  return fieldPayload({
    label: view.label,
    type: view.type,
    options: view.options,
    appliesTo: view.appliesTo,
    requiredWhen: view.requiredWhen,
    classification: view.classification,
    visibleTo: view.visibleTo,
    order: view.order,
    ...change,
  });
}

/** The rules whose conditions read a custom field (`fields.<key>`), by field key. */
export function rulesByField(rules: readonly { readonly name: string; readonly conditions: unknown }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const rule of rules) {
    for (const path of readsOf(rule.conditions)) {
      const match = /^fields\.(.+)$/.exec(path);
      if (!match) continue;
      const list = out.get(match[1]!) ?? [];
      if (!list.includes(rule.name)) list.push(rule.name);
      out.set(match[1]!, list);
    }
  }
  return out;
}

/** The field as a one-question form, for the preview: the same control the desk and the portal draw. */
export function previewForm(field: { readonly key: string; readonly label: string; readonly type: string; readonly options: readonly { readonly value: string; readonly label: string }[]; readonly required: boolean }): FormDefinition {
  const key = /^[a-z][a-zA-Z0-9]{0,63}$/.test(field.key) ? field.key : 'field';
  const values = field.options.filter((option) => option.value).map((option) => option.value);
  const control = field.type === 'textarea' ? 'longtext' : field.type === 'text' ? 'text' : (field.type as 'number' | 'date' | 'select' | 'multiselect' | 'checkbox');
  const property =
    field.type === 'number'
      ? { type: 'number' as const }
      : field.type === 'date'
        ? { type: 'string' as const, format: 'date' as const }
        : field.type === 'select'
          ? { type: 'string' as const, enum: values }
          : field.type === 'multiselect'
            ? { type: 'array' as const, items: { type: 'string' as const, enum: values } }
            : field.type === 'checkbox'
              ? { type: 'boolean' as const }
              : { type: 'string' as const };
  return {
    key: 'field-preview',
    version: 0,
    schema: { type: 'object', properties: { [key]: { ...property, title: field.label || 'Untitled field' } }, ...(field.required ? { required: [key] } : {}) },
    ui: {
      elements: [
        {
          kind: 'field',
          field: key,
          control,
          label: field.label || 'Untitled field',
          ...(fieldHasOptions(field.type) ? { options: field.options.filter((option) => option.value).map((option) => ({ value: option.value, label: option.label || option.value })) } : {}),
        },
      ],
    },
  };
}
