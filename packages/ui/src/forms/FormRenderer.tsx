'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { cx } from '../web/cx.js';
import { Checkbox } from '../web/Checkbox.js';
import { Combobox, type ComboboxOption } from '../web/Combobox.js';
import { DatePicker } from '../web/DatePicker.js';
import { FormField, type FieldControlProps } from '../web/FormField.js';
import { RichText } from '../web/RichText.js';
import { Input } from '../web/Input.js';
import { Select } from '../web/Select.js';
import { Textarea } from '../web/Textarea.js';
import { useStableId } from '../a11y/ids.js';
import {
  buildEvalContext,
  isReadOnly,
  isRequired,
  isVisible,
  type FormErrors,
  type FormEvalExtras,
} from './logic.js';
import {
  isFieldElement,
  isSectionElement,
  type FieldOption,
  type FormDefinition,
  type FormValue,
  type FormValues,
  type UiElement,
  type UiFieldElement,
} from './schema.js';

export interface UserOption {
  readonly id: string;
  readonly name: string;
  /** Shown as the secondary line — an e-mail address or a department. */
  readonly detail?: string;
}

export interface FormRendererProps {
  readonly definition: FormDefinition;
  readonly values: FormValues;
  readonly onChange: (values: FormValues) => void;
  /** Validation results, from `validateForm` or from the API's 422 response. */
  readonly errors?: FormErrors;
  /** Everything a condition may read besides the answers themselves. */
  readonly context?: FormEvalExtras;
  /**
   * The directory search behind every `user` field. Injected, because the
   * design system must not know about the SDK, the session or tenancy.
   */
  readonly loadUsers?: (query: string, signal: AbortSignal) => Promise<readonly UserOption[]>;
  /** Names for user ids already in `values`, so an existing submission shows names rather than ids. */
  readonly userLabels?: Readonly<Record<string, string>>;
  readonly disabled?: boolean;
  readonly locale?: string;
  readonly className?: string;
}

function asString(value: FormValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function asArray(value: FormValue | undefined): readonly string[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Renders a form definition.
 *
 * One implementation for the portal, the mobile app (through the native
 * component set) and the admin preview: a builder's preview that differs from
 * what the requester sees is a preview nobody can trust.
 */
export function FormRenderer({
  definition,
  values,
  onChange,
  errors = {},
  context: extras = {},
  loadUsers,
  userLabels = {},
  disabled = false,
  locale = 'en-GB',
  className,
}: FormRendererProps): ReactNode {
  const baseId = useStableId('itsm-form');
  // Names of users chosen in this session, so the picker can show a label for a
  // value it has just set without another round trip.
  const [resolvedUsers, setResolvedUsers] = useState<Readonly<Record<string, string>>>({});

  // Rebuilt whenever an answer changes: every condition in the form is a
  // function of the current answers, so this is the form's whole state machine.
  const evalContext = useMemo(() => buildEvalContext(values, extras), [values, extras]);

  const setValue = useCallback(
    (field: string, value: FormValue) => {
      onChange({ ...values, [field]: value });
    },
    [onChange, values],
  );

  const renderControl = (element: UiFieldElement, control: FieldControlProps, readOnly: boolean): ReactNode => {
    const value = values[element.field];
    const inert = disabled || readOnly;
    const options: readonly FieldOption[] =
      element.options ??
      (definition.schema.properties[element.field]?.enum ?? []).map((entry) => ({ value: entry, label: entry }));

    switch (element.control) {
      case 'longtext':
        return (
          <Textarea
            {...control}
            autoGrow
            rows={element.rows ?? 4}
            placeholder={element.placeholder}
            disabled={inert}
            value={asString(value)}
            onChange={(event) => setValue(element.field, event.target.value)}
          />
        );

      case 'number': {
        const property = definition.schema.properties[element.field];
        return (
          <Input
            {...control}
            type="number"
            inputMode={property?.type === 'integer' ? 'numeric' : 'decimal'}
            min={property?.minimum}
            max={property?.maximum}
            placeholder={element.placeholder}
            disabled={inert}
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(event) => {
              const raw = event.target.value;
              // An empty box is "no answer", not zero.
              setValue(element.field, raw === '' ? null : Number(raw));
            }}
          />
        );
      }

      case 'date':
        return (
          <DatePicker
            id={control.id}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            required={control.required}
            locale={locale}
            disabled={inert}
            value={typeof value === 'string' ? value : null}
            onChange={(next) => setValue(element.field, next)}
          />
        );

      case 'select':
        return (
          <Select
            {...control}
            disabled={inert}
            placeholder={element.placeholder ?? 'Choose…'}
            options={options.map((option) => ({ value: option.value, label: option.label, disabled: option.disabled }))}
            value={asString(value)}
            onChange={(event) => setValue(element.field, event.target.value === '' ? null : event.target.value)}
          />
        );

      case 'multiselect': {
        const selected = asArray(value);
        return (
          // A group of checkboxes rather than a multi-select listbox: every
          // option is visible, every one is reachable by Tab, and it behaves
          // identically on a phone.
          <fieldset
            style={{ border: 0, margin: 0, padding: 0 }}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
          >
            <legend className="itsm-visually-hidden">{element.label ?? element.field}</legend>
            {options.map((option) => (
              <Checkbox
                key={option.value}
                label={option.label}
                description={option.description}
                disabled={inert || option.disabled}
                checked={selected.includes(option.value)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, option.value]
                    : selected.filter((entry) => entry !== option.value);
                  setValue(element.field, next);
                }}
              />
            ))}
          </fieldset>
        );
      }

      case 'checkbox':
        return (
          <Checkbox
            id={control.id}
            aria-describedby={control['aria-describedby']}
            label={element.label ?? element.field}
            disabled={inert}
            checked={value === true}
            onChange={(event) => setValue(element.field, event.target.checked)}
          />
        );

      case 'user': {
        const id = typeof value === 'string' ? value : null;
        const label = id ? (resolvedUsers[id] ?? userLabels[id] ?? id) : null;
        return (
          <Combobox
            id={control.id}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            required={control.required}
            disabled={inert}
            placeholder={element.placeholder ?? 'Search for a person'}
            minQueryLength={element.minQueryLength ?? 2}
            value={id ? { value: id, label: label ?? id } : null}
            loadOptions={
              loadUsers
                ? async (query, signal): Promise<readonly ComboboxOption<UserOption>[]> => {
                    const people = await loadUsers(query, signal);
                    return people.map((person) => ({
                      value: person.id,
                      label: person.name,
                      description: person.detail,
                      data: person,
                    }));
                  }
                : undefined
            }
            onChange={(option) => {
              if (option) setResolvedUsers((current) => ({ ...current, [option.value]: option.label }));
              setValue(element.field, option?.value ?? null);
            }}
          />
        );
      }

      case 'text':
      default: {
        const property = definition.schema.properties[element.field];
        return (
          <Input
            {...control}
            type={property?.format === 'email' ? 'email' : property?.format === 'uri' ? 'url' : 'text'}
            maxLength={property?.maxLength}
            placeholder={element.placeholder}
            disabled={inert}
            value={asString(value)}
            onChange={(event) => setValue(element.field, event.target.value)}
          />
        );
      }
    }
  };

  const renderElement = (element: UiElement): ReactNode => {
    if (!isVisible(element, evalContext)) return null;

    if (isSectionElement(element)) {
      const headingId = `${baseId}-${element.id}`;
      return (
        <section key={element.id} aria-labelledby={headingId} style={{ marginBlockEnd: 'var(--itsm-space-lg)' }}>
          <h3 id={headingId} style={{ font: 'inherit', fontSize: 'var(--itsm-font-size-lg)', fontWeight: 600, margin: '0 0 var(--itsm-space-2xs)' }}>
            {element.title}
          </h3>
          {element.description ? (
            <p className="itsm-Field__hint" style={{ marginBlockStart: 0 }}>
              {element.description}
            </p>
          ) : null}
          {element.elements.map(renderElement)}
        </section>
      );
    }

    if (!isFieldElement(element)) {
      return (
        <div
          key={element.id}
          className="itsm-Card__body"
          style={{
            marginBlockEnd: 'var(--itsm-space-md)',
            background: `var(--itsm-colour-${element.intent ?? 'info'}-subtle)`,
            color: `var(--itsm-colour-${element.intent ?? 'info'}-subtleText)`,
            borderRadius: 'var(--itsm-radius-md)',
          }}
        >
          <RichText content={element.content} />
        </div>
      );
    }

    const property = definition.schema.properties[element.field];
    const required = isRequired(element, definition, evalContext);
    const readOnly = isReadOnly(element, evalContext);
    const error = errors[element.field];

    // A checkbox labels itself: wrapping it in a field label as well would make
    // a screen reader read the question twice.
    if (element.control === 'checkbox') {
      return (
        <div key={element.field} className="itsm-Field">
          {renderControl(element, { id: `${baseId}-${element.field}`, 'aria-describedby': undefined, 'aria-invalid': error ? true : undefined, 'aria-required': required || undefined, required }, readOnly)}
          {element.help ?? property?.description ? <span className="itsm-Field__hint">{element.help ?? property?.description}</span> : null}
          {error ? <span className="itsm-Field__error">{error}</span> : null}
        </div>
      );
    }

    return (
      <FormField
        key={element.field}
        label={element.label ?? property?.title ?? element.field}
        hint={element.help ?? property?.description}
        error={error}
        required={required}
      >
        {(control) => renderControl(element, control, readOnly)}
      </FormField>
    );
  };

  return (
    <div className={cx('itsm-FormRenderer', className)}>
      {/* A misconfigured form is not the requester's fault and not theirs to
          fix, so it says so at the top rather than rendering fields that behave
          unpredictably. `validateForm` returns this under `_form` when a
          condition cannot be evaluated at all (ADR-0021). */}
      {errors._form ? (
        <p className="itsm-FormRenderer__error" role="alert">
          {errors._form}
        </p>
      ) : null}
      {definition.ui.elements.map(renderElement)}
    </div>
  );
}
