/**
 * Deriving a machine key from something a person typed.
 *
 * Two rules, because this codebase has two, and they are not interchangeable:
 *
 *   field definitions  `^[a-z][a-zA-Z0-9]{0,63}$`   camelCase, 1–64
 *   everything else    `^[a-z][a-z0-9-]{1,62}$`     kebab-case, 2–63
 *
 * The second covers rule keys, SLA policy and calendar keys, service and
 * request-type keys, form keys and workflow keys. Using the camelCase helper
 * for one of those mints a key the API refuses, and the refusal arrives as a
 * message about a regular expression — which is the exact fault ADR-0049
 * records `keyFor` having for "1st line", found only because a test was
 * written as a tautology and proved nothing.
 *
 * So both live here, beside each other, tested against the real expressions
 * rather than against a copy of them. Both return an empty string when they
 * cannot produce something valid, and every caller is expected to ask the
 * person for different wording rather than submit a key the API will reject.
 */

/** `^[a-z][a-zA-Z0-9]{0,63}$` — the key of a custom field definition. */
export const FIELD_KEY = /^[a-z][a-zA-Z0-9]{0,63}$/;

/** `^[a-z][a-z0-9-]{1,62}$` — the key of a rule, policy, service, form or workflow. */
export const SLUG_KEY = /^[a-z][a-z0-9-]{1,62}$/;

function words(label: string): string[] {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * camelCase, for a custom field. `Cost centre` becomes `costCentre`.
 *
 * Shown before saving, never applied silently, and empty when it cannot
 * produce a key the API would accept — rather than one that looks fine and is
 * refused on save. A label starting with a digit, "1st line", has no camelCase
 * form this can honestly guess: `firstLine` is an invention and `stLine` is
 * nonsense. The editor asks for different wording instead, which is a question
 * somebody can answer.
 */
export function keyFor(label: string): string {
  const parts = words(label);
  if (parts.length === 0) return '';

  const key = parts
    .map((word, index) => (index === 0 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join('')
    .slice(0, 64);

  return FIELD_KEY.test(key) ? key : '';
}

/**
 * kebab-case, for everything else. `Order a laptop` becomes `order-a-laptop`.
 *
 * Truncated to 63 and then trimmed of a trailing hyphen, because slicing a
 * kebab key mid-word leaves one — and `order-a-lapt-` is both ugly and, for a
 * key ending in a hyphen right on the boundary, still valid, so nothing would
 * have complained.
 */
export function slugFor(label: string): string {
  const parts = words(label);
  if (parts.length === 0) return '';

  const key = parts.join('-').slice(0, 63).replace(/-+$/, '');
  return SLUG_KEY.test(key) ? key : '';
}
