'use client';

import type { ReactNode } from 'react';
import type { EvalContext } from '@itsm/expr';
import { joinIds } from '../a11y/ids.js';
import { CheckboxGroup } from '../controls/CheckboxGroup.js';
import { Icon } from '../icons/Icon.js';
import type { IconName } from '../types.js';
import { Checkbox } from '../web/Checkbox.js';
import { Combobox, type ComboboxOption } from '../web/Combobox.js';
import { DatePicker } from '../web/DatePicker.js';
import { FormField, type FieldControlProps } from '../web/FormField.js';
import { Input } from '../web/Input.js';
import { RichText } from '../web/RichText.js';
import { Select } from '../web/Select.js';
import { Textarea } from '../web/Textarea.js';
import { isReadOnly, isRequired, isVisible, type FormErrors } from './logic.js';
import { isFieldElement, isSectionElement, type FormDefinition, type FormIntent, type FormValue, type FormValues, type UiElement, type UiFieldElement } from './schema.js';
import { fieldLabel, fieldOptions, formatAnswer } from './steps.js';

export interface UserOption {
  readonly id: string;
  readonly name: string;
  /** Shown as the secondary line — an e-mail address or a department. */
  readonly detail?: string;
}

export type HeadingLevel = 2 | 3 | 4 | 5 | 6;

/** Everything rendering a field needs from the renderer around it. */
export interface FieldRenderContext {
  readonly definition: FormDefinition;
  readonly values: FormValues;
  readonly setValue: (field: string, value: FormValue) => void;
  readonly errors: FormErrors;
  readonly evalContext: EvalContext;
  readonly baseId: string;
  readonly disabled: boolean;
  readonly locale: string;
  readonly loadUsers?: (query: string, signal: AbortSignal) => Promise<readonly UserOption[]>;
  /** A person's name for an id, from what the caller passed and what was chosen here. */
  readonly userName: (id: string) => string;
  /** Remembers a name chosen in a user picker. */
  readonly rememberUser: (id: string, name: string) => void;
}

/**
 * A key from the definition, made safe for an id: letters, digits, `-` and
 * `_` as they are, anything else (a space, a dot) as `_` and its code, so two
 * different keys never meet in one id and a label always finds its control.
 */
function idPart(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, (character) => `_${character.charCodeAt(0).toString(16)}`);
}

/** The id of a question's control: what its label points at, and what an error summary links to. */
export function fieldId(baseId: string, field: string): string {
  return `${baseId}-${idPart(field)}`;
}

function asString(value: FormValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function asArray(value: FormValue | undefined): readonly string[] {
  return Array.isArray(value) ? value : [];
}

/** The icon each instruction intent carries, so its tint is never the only signal (SPEC §1.1). */
const intentIcon: Readonly<Record<FormIntent, IconName>> = {
  brand: 'info',
  neutral: 'info',
  info: 'info',
  success: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-alert',
};

function nextLevel(level: HeadingLevel): HeadingLevel {
  return Math.min(6, level + 1) as HeadingLevel;
}

/*
 * A read-only answer: a checkbox keeps its box (checked or not reads at a
 * glance) but will not change; everything else is a read-only text field
 * showing the answer as words. Read-only, not disabled (01 §5.7): it stays in
 * the tab order, its text can be selected and copied, and it is not drawn in
 * the faded disabled colour, because nothing is wrong with it.
 *
 * The box "will not change" because it is controlled and its change is
 * ignored: React puts the controlled value back after the event. Cancelling
 * the click instead would fight the browser's own undo of a cancelled click.
 */

function renderControl(element: UiFieldElement, control: FieldControlProps, readOnly: boolean, ctx: FieldRenderContext): ReactNode {
  const { definition, values, setValue, disabled, locale } = ctx;
  const value = values[element.field];
  const property = definition.schema.properties[element.field];

  // Choices, dates and people have no native read-only state; their answer
  // is shown as text in a read-only field instead.
  if (readOnly && (element.control === 'select' || element.control === 'date' || element.control === 'user')) {
    return <Input {...control} readOnly disabled={disabled} value={formatAnswer(element, definition, value, { locale, userName: ctx.userName })} />;
  }

  switch (element.control) {
    case 'longtext':
      return (
        <Textarea
          {...control}
          autoGrow
          rows={element.rows ?? 4}
          placeholder={element.placeholder}
          disabled={disabled}
          readOnly={readOnly}
          maxLength={property?.maxLength}
          value={asString(value)}
          onChange={(event) => setValue(element.field, event.target.value)}
        />
      );

    case 'number':
      return (
        <Input
          {...control}
          type="number"
          inputMode={property?.type === 'integer' ? 'numeric' : 'decimal'}
          min={property?.minimum}
          max={property?.maximum}
          placeholder={element.placeholder}
          disabled={disabled}
          readOnly={readOnly}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(event) => {
            const raw = event.target.value;
            // An empty box is "no answer", not zero.
            setValue(element.field, raw === '' ? null : Number(raw));
          }}
        />
      );

    case 'date':
      return (
        <DatePicker
          id={control.id}
          aria-describedby={control['aria-describedby']}
          aria-invalid={control['aria-invalid']}
          required={control.required}
          locale={locale}
          disabled={disabled}
          value={typeof value === 'string' ? value : null}
          onChange={(next) => setValue(element.field, next)}
        />
      );

    case 'select':
      return (
        <Select
          {...control}
          disabled={disabled}
          placeholder={element.placeholder ?? 'Choose…'}
          options={fieldOptions(element, definition).map((option) => ({ value: option.value, label: option.label, disabled: option.disabled }))}
          value={asString(value)}
          onChange={(event) => setValue(element.field, event.target.value === '' ? null : event.target.value)}
        />
      );

    case 'user': {
      const id = typeof value === 'string' ? value : null;
      const { loadUsers } = ctx;
      return (
        <Combobox
          id={control.id}
          aria-describedby={control['aria-describedby']}
          aria-invalid={control['aria-invalid']}
          required={control.required}
          disabled={disabled}
          placeholder={element.placeholder ?? 'Search for a person'}
          minQueryLength={element.minQueryLength ?? 2}
          value={id ? { value: id, label: ctx.userName(id) } : null}
          loadOptions={
            loadUsers
              ? async (query, signal): Promise<readonly ComboboxOption<UserOption>[]> => {
                  const people = await loadUsers(query, signal);
                  return people.map((person) => ({ value: person.id, label: person.name, description: person.detail, data: person }));
                }
              : undefined
          }
          onChange={(option) => {
            if (option) ctx.rememberUser(option.value, option.label);
            setValue(element.field, option?.value ?? null);
          }}
        />
      );
    }

    case 'text':
    default:
      return (
        <Input
          {...control}
          type={property?.format === 'email' ? 'email' : property?.format === 'uri' ? 'url' : 'text'}
          maxLength={property?.maxLength}
          placeholder={element.placeholder}
          disabled={disabled}
          readOnly={readOnly}
          value={asString(value)}
          onChange={(event) => setValue(element.field, event.target.value)}
        />
      );
  }
}

/** A multiple choice: every option visible and a Tab stop, the question as the group's legend. */
function renderMultiselect(element: UiFieldElement, ctx: FieldRenderContext, required: boolean, readOnly: boolean): ReactNode {
  const { definition, values, setValue, errors, baseId, disabled } = ctx;
  const property = definition.schema.properties[element.field];
  const options = fieldOptions(element, definition);
  const selected = asArray(values[element.field]);
  const label = fieldLabel(element, definition);
  const hint = element.help ?? property?.description;
  const error = errors[element.field];
  const id = fieldId(baseId, element.field);

  if (readOnly) {
    // The group's own markup, with boxes that show the answer and do not change it.
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    return (
      <div key={element.field} id={id} className="itsm-FormRenderer__group">
        <fieldset className="itsm-CheckboxGroup" disabled={disabled || undefined} aria-describedby={joinIds(hint && hintId, error && errorId)}>
          <legend className="itsm-Field__label itsm-CheckboxGroup__legend">{label}</legend>
          {hint ? (
            <span className="itsm-Field__hint itsm-CheckboxGroup__hint" id={hintId}>
              {hint}
            </span>
          ) : null}
          <div className="itsm-CheckboxGroup__options">
            {options.map((option) => (
              <Checkbox
                key={option.value}
                label={option.label}
                description={option.description}
                checked={selected.includes(option.value)}
                aria-readonly="true"
                onChange={() => undefined}
              />
            ))}
          </div>
          {error ? (
            <span className="itsm-Field__error itsm-CheckboxGroup__error" id={errorId}>
              <Icon name="circle-alert" size="xs" className="itsm-Field__errorIcon" />
              <span>{error}</span>
            </span>
          ) : null}
        </fieldset>
      </div>
    );
  }

  return (
    // The wrapper carries the id an error summary links to; the group's first box takes focus from there.
    <div key={element.field} id={id} className="itsm-FormRenderer__group">
      <CheckboxGroup
        label={label}
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
          ...(option.description ? { description: option.description } : {}),
          ...(option.disabled ? { disabled: true } : {}),
        }))}
        value={selected}
        required={required}
        disabled={disabled}
        {...(hint ? { hint } : {})}
        {...(error ? { error } : {})}
        onChange={(next) => setValue(element.field, next)}
      />
    </div>
  );
}

/**
 * A single checkbox labels itself: wrapping it in a field label as well
 * would make a screen reader read the question twice. Its hint and error are
 * wired to the box with `aria-describedby`, as a field's are (01 §5.7).
 */
function renderCheckbox(element: UiFieldElement, ctx: FieldRenderContext, required: boolean, readOnly: boolean): ReactNode {
  const { definition, values, setValue, errors, baseId, disabled } = ctx;
  const property = definition.schema.properties[element.field];
  const id = fieldId(baseId, element.field);
  const hint = element.help ?? property?.description;
  const error = errors[element.field];
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div key={element.field} className="itsm-Field itsm-FormRenderer__checkbox">
      <Checkbox
        id={id}
        label={fieldLabel(element, definition)}
        aria-describedby={joinIds(hint && hintId, error && errorId)}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        required={required}
        disabled={disabled}
        checked={values[element.field] === true}
        {...(readOnly ? { 'aria-readonly': true } : {})}
        onChange={(event) => {
          if (!readOnly) setValue(element.field, event.target.checked);
        }}
      />
      {hint ? (
        <span className="itsm-Field__hint itsm-FormRenderer__checkboxHint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="itsm-Field__error itsm-FormRenderer__checkboxError" id={errorId}>
          <Icon name="circle-alert" size="xs" className="itsm-Field__errorIcon" />
          <span>{error}</span>
        </span>
      ) : null}
    </div>
  );
}

/**
 * One element of the definition, if its condition shows it: a section with
 * its heading (at `level`, its own sections one below), an instruction, or a
 * question.
 */
export function renderElement(element: UiElement, ctx: FieldRenderContext, level: HeadingLevel): ReactNode {
  const { definition, errors, baseId, evalContext } = ctx;
  if (!isVisible(element, evalContext)) return null;

  if (isSectionElement(element)) {
    const headingId = `${baseId}-section-${idPart(element.id)}`;
    const Heading = `h${level}` as const;
    return (
      <section key={element.id} aria-labelledby={headingId} className="itsm-FormRenderer__section">
        <Heading id={headingId} className="itsm-FormRenderer__sectionTitle">
          {element.title}
        </Heading>
        {element.description ? <p className="itsm-FormRenderer__sectionDescription">{element.description}</p> : null}
        {element.elements.map((child) => renderElement(child, ctx, nextLevel(level)))}
      </section>
    );
  }

  if (!isFieldElement(element)) {
    const intent = element.intent ?? 'info';
    return (
      <div key={element.id} className="itsm-FormRenderer__instruction" data-intent={intent}>
        <Icon name={intentIcon[intent]} className="itsm-FormRenderer__instructionIcon" />
        <div className="itsm-FormRenderer__instructionBody">
          <RichText content={element.content} />
        </div>
      </div>
    );
  }

  const property = definition.schema.properties[element.field];
  const required = isRequired(element, definition, evalContext);
  const readOnly = isReadOnly(element, evalContext);

  if (element.control === 'checkbox') return renderCheckbox(element, ctx, required, readOnly);
  if (element.control === 'multiselect') return renderMultiselect(element, ctx, required, readOnly);

  return (
    <FormField
      key={element.field}
      id={fieldId(baseId, element.field)}
      label={fieldLabel(element, definition)}
      hint={element.help ?? property?.description}
      error={errors[element.field]}
      required={required}
    >
      {(control) => renderControl(element, control, readOnly, ctx)}
    </FormField>
  );
}
