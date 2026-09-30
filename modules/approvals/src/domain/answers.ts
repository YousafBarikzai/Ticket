import {
  isFieldElement,
  isSectionElement,
  type FieldControl,
  type UiElement,
  type UiFieldElement,
} from '@itsm/contracts';

/**
 * A catalogue submission's answers, as an approver reads them.
 *
 * The stored answers are keyed by property name and hold option values and
 * user ids: `{ accessLevel: 'admin', manager: '6f1c…' }`. An approver shown that
 * is being asked to decide on a key they have never seen and an id they cannot
 * look up, and has no way to fetch the form to translate it — they may not be
 * entitled to the catalogue item at all. So the translation happens here, from
 * the form version the requester was actually shown, and the raw value rides
 * along for anything that wants to do its own formatting.
 */

export interface ApprovalAnswer {
  /** The property name in the form's schema. */
  field: string;
  /** The question as the requester saw it; the property name when the form has none. */
  label: string;
  /** What was stored, untouched. */
  value: unknown;
  /** The same answer in words: option labels, a person's name, Yes or No. Empty when unanswered. */
  display: string;
}

interface FieldFacts {
  label: string;
  control: FieldControl | null;
  options: Map<string, string>;
}

/**
 * Orders and labels a submission's answers against its form document.
 *
 * Answers come out in the order the form asked them, sections flattened, and
 * any answer the document does not mention (a document that failed to load, or
 * a key no element names) follows at the end under its property name rather than
 * being dropped: an approver missing one answer is deciding on less than the
 * requester said, and nothing on the screen would tell them so.
 *
 * `document` is JSON from the database, so every step is defensive; a malformed
 * form must degrade to property names, never to an error on the approver's
 * screen.
 */
export function labelAnswers(
  document: unknown,
  answers: unknown,
  names: ReadonlyMap<string, string> = new Map(),
): ApprovalAnswer[] {
  if (!isRecord(answers)) return [];

  const fields = fieldsOf(document);
  const out: ApprovalAnswer[] = [];
  const seen = new Set<string>();

  const add = (field: string) => {
    if (seen.has(field) || !(field in answers)) return;
    seen.add(field);
    const facts = fields.get(field);
    out.push({
      field,
      label: facts?.label ?? field,
      value: answers[field],
      display: displayOf(answers[field], facts, names),
    });
  };

  for (const field of fields.keys()) add(field);
  for (const field of Object.keys(answers)) add(field);
  return out;
}

/**
 * The ids of the people named in a submission's `user` answers, so their names
 * can be read in one query before the answers are labelled.
 */
export function userIdsIn(document: unknown, answers: unknown): string[] {
  if (!isRecord(answers)) return [];
  const ids = new Set<string>();
  for (const [field, facts] of fieldsOf(document)) {
    if (facts.control !== 'user') continue;
    const value = answers[field];
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string' && item.length > 0) ids.add(item);
    }
  }
  return [...ids];
}

/** Every field element in document order, keyed by property name; the first element for a property wins. */
function fieldsOf(document: unknown): Map<string, FieldFacts> {
  const fields = new Map<string, FieldFacts>();
  if (!isRecord(document)) return fields;

  const schema = isRecord(document.schema) ? document.schema : {};
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const ui = isRecord(document.ui) ? document.ui : {};

  const visit = (elements: unknown, depth: number) => {
    // Sections nest, but not without limit: a document that nests itself deeper
    // than any builder produces is not worth recursing into.
    if (!Array.isArray(elements) || depth > 8) return;
    for (const element of elements as UiElement[]) {
      if (!isRecord(element)) continue;
      if (isSectionElement(element)) {
        visit(element.elements, depth + 1);
      } else if (isFieldElement(element) && typeof element.field === 'string' && !fields.has(element.field)) {
        fields.set(element.field, factsFor(element, properties[element.field]));
      }
    }
  };
  visit(ui.elements, 0);
  return fields;
}

function factsFor(element: UiFieldElement, property: unknown): FieldFacts {
  const title = isRecord(property) && typeof property.title === 'string' ? property.title : undefined;
  const options = new Map<string, string>();
  if (Array.isArray(element.options)) {
    for (const option of element.options) {
      if (isRecord(option) && typeof option.value === 'string') {
        options.set(option.value, typeof option.label === 'string' ? option.label : option.value);
      }
    }
  }
  return {
    label: nonEmpty(element.label) ?? nonEmpty(title) ?? element.field,
    control: typeof element.control === 'string' ? element.control : null,
    options,
  };
}

function displayOf(value: unknown, facts: FieldFacts | undefined, names: ReadonlyMap<string, string>): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (Array.isArray(value)) {
    return value
      .map((item) => displayOf(item, facts, names))
      .filter((text) => text.length > 0)
      .join(', ');
  }
  if (typeof value !== 'string') return '';
  if (facts?.control === 'user') return names.get(value) ?? value;
  return facts?.options.get(value) ?? value;
}

function nonEmpty(text: string | undefined): string | undefined {
  return typeof text === 'string' && text.trim().length > 0 ? text : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
