/**
 * Form logic, with no React in it.
 *
 * Visibility, conditional requirement, read-only state, which values may be
 * submitted and what is invalid are all decided here, as pure functions over a
 * definition and a set of values. Two reasons: the same functions run in the
 * admin preview and in tests without a DOM, and the browser's answers are
 * derived from the same expressions the API uses, so a condition can never
 * mean one thing on screen and another on the server.
 */
import { evaluate, type EvalContext, type Expr } from '@itsm/expr';
import {
  isFieldElement,
  isSectionElement,
  type FormDefinition,
  type FormValue,
  type FormValues,
  type UiElement,
  type UiFieldElement,
} from './schema.js';

/** Anything else a condition may read: the signed-in user, the catalogue item, the clock. */
export interface FormEvalExtras {
  readonly user?: Readonly<Record<string, unknown>>;
  readonly now?: string;
  readonly [key: string]: unknown;
}

/**
 * Builds the evaluation context. Field values live under `form.`, so a
 * condition reads `{ var: 'form.impact' }` — the same path the API builds when
 * it re-checks the submission.
 */
export function buildEvalContext(values: FormValues, extras: FormEvalExtras = {}): EvalContext {
  return { ...extras, now: extras.now ?? new Date().toISOString(), form: { ...values } };
}

function test(condition: Expr | undefined, context: EvalContext, fallback: boolean): boolean {
  if (!condition) return fallback;
  return evaluate(condition, context);
}

export function isVisible(element: UiElement, context: EvalContext): boolean {
  return test(element.visibleWhen, context, true);
}

export function isRequired(element: UiFieldElement, definition: FormDefinition, context: EvalContext): boolean {
  if (definition.schema.required?.includes(element.field)) return true;
  return test(element.requiredWhen, context, false);
}

export function isReadOnly(element: UiFieldElement, context: EvalContext): boolean {
  return test(element.readOnlyWhen, context, false);
}

/**
 * The elements that should be on screen, with hidden sections pruned along with
 * everything inside them: a field inside a hidden section is hidden however its
 * own condition evaluates.
 */
export function visibleElements(elements: readonly UiElement[], context: EvalContext): readonly UiElement[] {
  const out: UiElement[] = [];
  for (const element of elements) {
    if (!isVisible(element, context)) continue;
    if (isSectionElement(element)) {
      out.push({ ...element, elements: visibleElements(element.elements, context) });
    } else {
      out.push(element);
    }
  }
  return out;
}

/** Every visible field, flattened out of its sections, in document order. */
export function visibleFields(definition: FormDefinition, context: EvalContext): readonly UiFieldElement[] {
  const collect = (elements: readonly UiElement[]): UiFieldElement[] =>
    elements.flatMap((element) => {
      if (!isVisible(element, context)) return [];
      if (isSectionElement(element)) return collect(element.elements);
      return isFieldElement(element) ? [element] : [];
    });
  return collect(definition.ui.elements);
}

export function isEmpty(value: FormValue | undefined): boolean {
  if (value === undefined || value === null || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

/**
 * The values that may be sent.
 *
 * A field the user cannot see has no business in the submission: leaving a
 * stale answer in place is how a request ends up approved against a condition
 * nobody saw. The API applies the same rule, so a client that gets this wrong
 * is rejected rather than trusted.
 */
export function submissionValues(definition: FormDefinition, values: FormValues, extras: FormEvalExtras = {}): FormValues {
  const context = buildEvalContext(values, extras);
  const allowed = new Set(visibleFields(definition, context).map((field) => field.field));
  const out: Record<string, FormValue> = {};
  for (const [key, value] of Object.entries(values)) {
    if (allowed.has(key) && !isEmpty(value)) out[key] = value;
  }
  return out;
}

export type FormErrors = Readonly<Record<string, string>>;

/**
 * Client-side validation. The API validates again — this is for the user's
 * benefit, not the server's — so the messages say what to do, not what failed.
 */
export function validateForm(definition: FormDefinition, values: FormValues, extras: FormEvalExtras = {}): FormErrors {
  const context = buildEvalContext(values, extras);
  const errors: Record<string, string> = {};

  for (const element of visibleFields(definition, context)) {
    const property = definition.schema.properties[element.field];
    const value = values[element.field];
    const label = element.label ?? property?.title ?? element.field;

    if (isRequired(element, definition, context)) {
      if (isEmpty(value) || (element.control === 'checkbox' && value !== true)) {
        errors[element.field] = `${label} is required`;
        continue;
      }
    }

    if (isEmpty(value) || !property) continue;

    if (typeof value === 'string') {
      if (property.minLength !== undefined && value.length < property.minLength) {
        errors[element.field] = `${label} must be at least ${property.minLength} characters`;
        continue;
      }
      if (property.maxLength !== undefined && value.length > property.maxLength) {
        errors[element.field] = `${label} must be ${property.maxLength} characters or fewer`;
        continue;
      }
      if (property.pattern !== undefined && !new RegExp(property.pattern).test(value)) {
        errors[element.field] = `${label} is not in the expected format`;
        continue;
      }
      if (property.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        errors[element.field] = `${label} must be a date in the form yyyy-mm-dd`;
        continue;
      }
      if (property.format === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
        errors[element.field] = `${label} must be an e-mail address`;
        continue;
      }
      if (property.enum && !property.enum.includes(value)) {
        errors[element.field] = `Choose one of the available options for ${label}`;
        continue;
      }
    }

    if (typeof value === 'number') {
      if (Number.isNaN(value)) {
        errors[element.field] = `${label} must be a number`;
        continue;
      }
      if (property.type === 'integer' && !Number.isInteger(value)) {
        errors[element.field] = `${label} must be a whole number`;
        continue;
      }
      if (property.minimum !== undefined && value < property.minimum) {
        errors[element.field] = `${label} must be ${property.minimum} or more`;
        continue;
      }
      if (property.maximum !== undefined && value > property.maximum) {
        errors[element.field] = `${label} must be ${property.maximum} or less`;
        continue;
      }
    }

    if (Array.isArray(value)) {
      const allowedValues = property.items?.enum;
      if (allowedValues && value.some((entry) => !allowedValues.includes(entry))) {
        errors[element.field] = `Choose one of the available options for ${label}`;
      }
    }
  }

  return errors;
}

/** Fills in schema defaults for fields that have no answer yet. */
export function withDefaults(definition: FormDefinition, values: FormValues = {}): FormValues {
  const out: Record<string, FormValue> = { ...values };
  for (const [field, property] of Object.entries(definition.schema.properties)) {
    if (out[field] === undefined && property.default !== undefined) out[field] = property.default;
  }
  return out;
}
