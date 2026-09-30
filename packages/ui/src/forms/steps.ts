/**
 * How a form definition divides into steps, and how its answers read back.
 *
 * Pure functions, no React: `FormRenderer` in steps mode renders what these
 * say, and the tests check the division without a DOM. There is no schema
 * change behind steps (SPEC §4.4, 07 §3) — the structure the form builder
 * already produces is read as a sequence:
 *
 * - every top-level `section` is a step, titled with the section's title;
 * - the loose top-level questions form a first step, named after the item
 *   being requested. All of them, wherever they sit between sections: a step
 *   is a stable thing, and a question that moved from one step to another
 *   because an earlier answer revealed a section would be lost from under the
 *   person answering it;
 * - loose instructions with no loose questions beside them introduce the
 *   first step that is shown, rather than being a step with nothing to answer;
 * - a step whose section is hidden, or whose every element is, is skipped.
 *
 * Visibility is the contract's own (`isVisible`), the same function the API
 * runs, so a step exists on screen exactly when its questions would be
 * accepted by the server.
 */
import type { EvalContext } from '@itsm/expr';
import { displayIsoDate } from '../overlays/calendar-dates.js';
import { formatList, formatNumber } from '../format/format.js';
import { isEmpty, isVisible } from './logic.js';
import {
  isFieldElement,
  isSectionElement,
  type FieldOption,
  type FormDefinition,
  type FormValue,
  type FormValues,
  type UiElement,
  type UiFieldElement,
  type UiSectionElement,
} from './schema.js';

/** The id of the first step, made of loose questions. Not a valid section id in practice, and never shown. */
export const DETAILS_STEP_ID = ':details';

export interface FormStep {
  /** The section's id, or `DETAILS_STEP_ID`. Stable across answers: the current step is remembered by it. */
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /** The elements shown on this step, in order (a section's own elements for a section step). */
  readonly elements: readonly UiElement[];
  /** The section this step is, whose visibility decides whether the step exists. */
  readonly section?: UiSectionElement;
}

/** The steps a definition divides into, before any answer is known. */
export function formSteps(definition: FormDefinition, title: string): { readonly steps: readonly FormStep[]; readonly lead: readonly UiElement[] } {
  const loose = definition.ui.elements.filter((element) => !isSectionElement(element));
  const sections = definition.ui.elements.filter(isSectionElement);
  const sectionSteps = sections.map<FormStep>((section) => ({
    id: section.id,
    title: section.title,
    ...(section.description ? { description: section.description } : {}),
    elements: section.elements,
    section,
  }));

  if (loose.length === 0) return { steps: sectionSteps, lead: [] };
  if (sections.length === 0 || loose.some(isFieldElement)) {
    return { steps: [{ id: DETAILS_STEP_ID, title, elements: loose }, ...sectionSteps], lead: [] };
  }
  return { steps: sectionSteps, lead: loose };
}

/** Whether anything in these elements would be on screen. */
function anyVisible(elements: readonly UiElement[], context: EvalContext): boolean {
  return elements.some((element) => isVisible(element, context) && (!isSectionElement(element) || anyVisible(element.elements, context)));
}

/** The steps as the answers so far make them: hidden sections and empty steps left out. */
export function visibleSteps(definition: FormDefinition, context: EvalContext, title: string): readonly FormStep[] {
  const { steps, lead } = formSteps(definition, title);
  const out: FormStep[] = [];
  let pendingLead = lead;
  for (const step of steps) {
    if (step.section && !isVisible(step.section, context)) continue;
    const elements = pendingLead.length > 0 ? [...pendingLead, ...step.elements] : step.elements;
    if (!anyVisible(elements, context)) continue;
    pendingLead = [];
    out.push(elements === step.elements ? step : { ...step, elements });
  }
  return out;
}

/** The visible questions on a step, in order, out of any nested sections. */
export function stepFields(step: FormStep, context: EvalContext): readonly UiFieldElement[] {
  const collect = (elements: readonly UiElement[]): UiFieldElement[] =>
    elements.flatMap((element) => {
      if (!isVisible(element, context)) return [];
      if (isSectionElement(element)) return collect(element.elements);
      return isFieldElement(element) ? [element] : [];
    });
  return collect(step.elements);
}

/* -------------------------------------------------------------------------
 * Answers, as the review step reads them
 * ---------------------------------------------------------------------- */

export interface ReviewAnswer {
  readonly field: string;
  readonly label: string;
  readonly text: string;
}

export interface AnswerFormat {
  readonly locale: string;
  /** Names for person ids. */
  readonly userName: (id: string) => string;
}

/** The options a choice question offers: its own, or its property's `enum`. */
export function fieldOptions(element: UiFieldElement, definition: FormDefinition): readonly FieldOption[] {
  const property = definition.schema.properties[element.field];
  const values = property?.enum ?? property?.items?.enum ?? [];
  return element.options ?? values.map((entry) => ({ value: entry, label: entry }));
}

/** The label a question is asked with. */
export function fieldLabel(element: UiFieldElement, definition: FormDefinition): string {
  return element.label ?? definition.schema.properties[element.field]?.title ?? element.field;
}

/**
 * One answer as a sentence would say it: an option's label rather than its
 * key, a date in the reader's locale, a person's name, "Yes"/"No".
 */
export function formatAnswer(element: UiFieldElement, definition: FormDefinition, value: FormValue | undefined, format: AnswerFormat): string {
  if (value === undefined || value === null) return '';
  const labelOf = (key: string): string => fieldOptions(element, definition).find((option) => option.value === key)?.label ?? key;
  switch (element.control) {
    case 'checkbox':
      return value === true ? 'Yes' : 'No';
    case 'select':
      return typeof value === 'string' ? labelOf(value) : String(value);
    case 'multiselect':
      return Array.isArray(value) ? formatList(value.map(labelOf), { locale: format.locale }) : String(value);
    case 'date':
      return typeof value === 'string' ? displayIsoDate(value, format.locale) || value : String(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? formatNumber(value, { locale: format.locale }) : String(value);
    case 'user':
      return typeof value === 'string' ? format.userName(value) : String(value);
    default:
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
}

/** The answered questions on a step, for the review. A ticked-off checkbox counts as answered ("No"); an empty box does not. */
export function stepAnswers(
  step: FormStep,
  definition: FormDefinition,
  values: FormValues,
  context: EvalContext,
  format: AnswerFormat,
): readonly ReviewAnswer[] {
  return stepFields(step, context)
    .filter((element) => {
      const value = values[element.field];
      return element.control === 'checkbox' ? typeof value === 'boolean' : !isEmpty(value);
    })
    .map((element) => ({
      field: element.field,
      label: fieldLabel(element, definition),
      text: formatAnswer(element, definition, values[element.field], format),
    }));
}
