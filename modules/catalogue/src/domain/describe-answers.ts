import type {
  FormDefinition,
  FormValue,
  FormValues,
  JsonSchemaProperty,
  UiElement,
  UiFieldElement,
} from '@itsm/contracts/forms';

/**
 * A catalogue request's answers as a person would read them (A4 §5.3).
 *
 * The ticket's description is what an agent reads first, and it used to be the
 * answers object printed raw: `model: performance`, `licence: paid`,
 * `manager: 0199…`. Those are the form's storage keys and option values, which
 * mean something to the form builder and nothing to the person working the
 * request. This prints what the requester saw instead — the question's label,
 * the option's label, the person's name — in the order the form asked.
 *
 * Pure, and exported from the service, because two callers must agree: a live
 * submission, and the demo build, which writes four months of requests through
 * the import path and must make them read exactly like live ones. The raw
 * values stay on the ticket's `custom`, where rules and reports match on them.
 */

/** What a request with no answers says, so the description is never empty. */
export const NO_ANSWERS_DESCRIPTION = 'Raised from the service catalogue.';

/** Shown for a `user` answer whose person cannot be found any more. */
export const UNKNOWN_PERSON = 'Unknown person';

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * One line per answer, as `Label: value`, in form order.
 *
 * - **Order** is the form's: sections depth-first, then their fields, however
 *   the answers object happens to be ordered.
 * - **Which answers**: only those present and non-empty in `answers`. The
 *   caller passes what `validateSubmission` accepted, which has already
 *   dropped every field the person could not see; visibility is not decided
 *   again here, because a condition may read facts about the requester that a
 *   description has no business re-deriving. An answer the form never asks
 *   for is not described either: it was not a question anybody answered.
 * - **Label**: the element's label, then the schema property's title, then
 *   the key made readable (`costCentre` → "Cost centre").
 * - **Values**: an option's label (several joined with ", "; a value the
 *   options do not list is printed as it is), "Yes"/"No", a date as
 *   `12 October 2026` read straight from the ISO date with no time-zone
 *   shift, a person's display name from `names` ("Unknown person" when it is
 *   missing), and long text under its label on lines of its own.
 */
export function describeAnswers(definition: FormDefinition, answers: FormValues, names: ReadonlyMap<string, string>): string {
  const blocks: { text: string; standalone: boolean }[] = [];

  for (const element of fieldElements(definition.ui.elements)) {
    if (!Object.prototype.hasOwnProperty.call(answers, element.field)) continue;
    const value = answers[element.field];
    if (isBlank(value)) continue;

    const property = definition.schema.properties[element.field];
    const label = labelFor(element, property);
    const text = formatValue(element, property, value as Exclude<FormValue, null>, names);
    if (element.control === 'longtext') {
      blocks.push({ text: `${label}:\n${text}`, standalone: true });
    } else {
      blocks.push({ text: `${label}: ${text}`, standalone: false });
    }
  }

  if (blocks.length === 0) return NO_ANSWERS_DESCRIPTION;

  // Long text sits between blank lines, so where it ends is never in doubt —
  // a line after it that looked like "Label: value" could otherwise be read
  // as part of what the person wrote.
  return blocks.reduce(
    (out, block, index) => (index === 0 ? block.text : `${out}${block.standalone || blocks[index - 1]!.standalone ? '\n\n' : '\n'}${block.text}`),
    '',
  );
}

/**
 * The ids of every person a `user` question was answered with, for the
 * caller to look up before describing. Only id-shaped values: the directory
 * is keyed by UUID, and a malformed value would fail the lookup rather than
 * simply not being found.
 */
export function userAnswerIds(definition: FormDefinition, answers: FormValues): string[] {
  const ids = new Set<string>();
  for (const element of fieldElements(definition.ui.elements)) {
    if (element.control !== 'user') continue;
    const value = answers[element.field];
    for (const candidate of Array.isArray(value) ? value : [value]) {
      if (typeof candidate === 'string' && UUID.test(candidate)) ids.add(candidate.toLowerCase());
    }
  }
  return [...ids];
}

/**
 * A storage key as words: `costCentre` → "Cost centre", `needed_by` →
 * "Needed by", `VPNAccess` → "VPN access". Sentence case, keeping acronyms.
 */
export function humaniseKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_.-]+/)
    .filter(Boolean);
  if (words.length === 0) return key;
  return words
    .map((word, index) => {
      if (word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word)) return word;
      const lower = word.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

/** Every field element in document order, sections walked depth-first; each field once. */
function fieldElements(elements: readonly UiElement[]): UiFieldElement[] {
  const seen = new Set<string>();
  const out: UiFieldElement[] = [];
  const walk = (list: readonly UiElement[]): void => {
    for (const element of list) {
      if (element.kind === 'section') walk(element.elements);
      else if (element.kind === 'field' && !seen.has(element.field)) {
        seen.add(element.field);
        out.push(element);
      }
    }
  };
  walk(elements);
  return out;
}

function isBlank(value: FormValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return Array.isArray(value) && value.every((item) => item.trim() === '');
}

function labelFor(element: UiFieldElement, property: JsonSchemaProperty | undefined): string {
  return element.label?.trim() || property?.title?.trim() || humaniseKey(element.field);
}

function formatValue(
  element: UiFieldElement,
  property: JsonSchemaProperty | undefined,
  value: Exclude<FormValue, null>,
  names: ReadonlyMap<string, string>,
): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const items = (Array.isArray(value) ? value : [value]).filter((item) => String(item).trim() !== '');

  switch (element.control) {
    case 'select':
    case 'multiselect':
      return items.map((item) => optionLabel(element, String(item))).join(', ');
    case 'user':
      return items.map((item) => names.get(String(item).toLowerCase()) ?? names.get(String(item)) ?? UNKNOWN_PERSON).join(', ');
    case 'date':
      return items.map((item) => formatDate(String(item))).join(', ');
    case 'longtext':
      return items.map((item) => String(item).trim()).join('\n');
    default:
      return items.map((item) => (property?.format === 'date' ? formatDate(String(item)) : String(item))).join(', ');
  }
}

function optionLabel(element: UiFieldElement, value: string): string {
  return element.options?.find((option) => option.value === value)?.label ?? value;
}

/**
 * `2026-10-12` → "12 October 2026". Read from the calendar date itself and
 * formatted in UTC, so the day never moves with the server's time zone; a
 * value that is not a real ISO date is printed as it is.
 */
function formatDate(value: string): string {
  const match = ISO_DATE.exec(value);
  if (!match) return value;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return value;
  return DATE_FORMAT.format(at);
}
