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

/**
 * Letters that Unicode does not decompose into a base letter and a mark, so
 * NFD alone would drop them: `Straße` must become `strasse`, not `strae`.
 */
const LIGATURES: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};

/**
 * The words of a label, folded to plain ASCII the way a person would spell
 * them without accents (F29): `Café access` is `cafe access`, not `caf
 * access`. NFD splits `é` into `e` and a combining accent, and the accent is
 * the part that is dropped; the few letters NFD cannot split are spelled out.
 * Anything still outside `a-z0-9` (punctuation, other scripts) is removed.
 */
function words(label: string): string[] {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[ßæœøłđðþı]/g, (letter) => LIGATURES[letter] ?? '')
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

/**
 * Keys that would collide with a route: `/rules/new` is the new-rule page and
 * `/workflows/runs` the runs list, so a rule, workflow or form keyed `new` or
 * `runs` could never be opened by its own URL. The static segment wins in the
 * router, so the API accepting the key is not enough (B §1.2).
 */
export const RESERVED_KEYS: readonly string[] = ['new', 'runs'];

export type KeyRule = 'slug' | 'field';

/** Why a key can or cannot be used — each state has its own words in `KeyField`. */
export type KeyState = 'ok' | 'empty' | 'invalid' | 'reserved' | 'taken';

/**
 * Whether `key` can be saved: well-formed for its rule, not a reserved word
 * (slug keys only — field keys do not appear in a URL) and not already used.
 * Pure, so the component and its test agree on every case.
 */
export function keyState(
  key: string,
  { rule, taken = [], reserved = rule === 'slug' ? RESERVED_KEYS : [] }: { rule: KeyRule; taken?: readonly string[]; reserved?: readonly string[] },
): KeyState {
  if (key === '') return 'empty';
  if (!(rule === 'slug' ? SLUG_KEY : FIELD_KEY).test(key)) return 'invalid';
  if (reserved.includes(key)) return 'reserved';
  if (taken.includes(key)) return 'taken';
  return 'ok';
}

/** The key a name would produce under a rule. */
export function deriveKey(label: string, rule: KeyRule): string {
  return rule === 'slug' ? slugFor(label) : keyFor(label);
}
