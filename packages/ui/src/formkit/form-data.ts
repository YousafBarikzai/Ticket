/**
 * Reading, writing and checking a form through its DOM.
 *
 * `Form` works with whatever controls its children render — the design
 * system's, a third-party editor with a hidden input, a plain `<input>` an
 * application wrote — so it cannot rely on knowing their React state. What
 * every one of them shares is the form element: named controls with values,
 * the browser's constraint validation, labels. These helpers work at that
 * level, and write values back through the same events a person typing
 * would cause, so a controlled control's `onChange` hears about a restored
 * draft exactly as it hears about a keystroke.
 *
 * No directive and no React: plain functions over DOM elements, called only
 * from event handlers and effects.
 */

/** A form's values as name/value pairs, in document order — what `FormData` holds, minus files. */
export type FormEntries = readonly (readonly [string, string])[];

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Buttons are not values: they say how the form was sent, not what was in it. */
const BUTTON_TYPES = new Set(['submit', 'button', 'reset', 'image']);

/**
 * Never written to a draft. Passwords must not sit in `localStorage`; a
 * file cannot be put back into a file input; a hidden input belongs to a
 * control that owns its own state, and writing only the hidden half of it
 * would leave the visible half saying something else.
 */
const NOT_DRAFTED = new Set(['password', 'file', 'hidden']);

function isControl(element: Element): element is Control {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

function usable(element: Element): element is Control {
  if (!isControl(element) || !element.name || element.disabled) return false;
  return !(element instanceof HTMLInputElement && BUTTON_TYPES.has(element.type));
}

/**
 * Whether a control's value may go into a draft. A subtree can opt out with
 * `data-itsm-draft="off"` — a card number, a one-time code — however it is
 * typed.
 */
function draftable(element: Element): element is Control {
  if (!usable(element)) return false;
  if (element instanceof HTMLInputElement && NOT_DRAFTED.has(element.type)) return false;
  return element.closest('[data-itsm-draft="off"]') === null;
}

/**
 * The form's values. `draft` leaves out what must never be stored (see
 * `NOT_DRAFTED`); `all` is for telling whether anything changed, where a
 * typed password counts as a change.
 */
export function readEntries(form: HTMLFormElement, purpose: 'draft' | 'all'): FormEntries {
  const out: [string, string][] = [];
  const include = purpose === 'draft' ? draftable : usable;
  for (const element of Array.from(form.elements)) {
    if (!include(element)) continue;
    if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
      if (element.checked) out.push([element.name, element.value]);
    } else if (element instanceof HTMLSelectElement && element.multiple) {
      for (const option of Array.from(element.selectedOptions)) out.push([element.name, option.value]);
    } else {
      out.push([element.name, element.value]);
    }
  }
  return out;
}

/** One string for a set of entries, to compare two of them cheaply. */
export function entriesKey(entries: FormEntries): string {
  return JSON.stringify(entries);
}

/** Validates entries that came back from storage, which may hold anything. */
export function isFormEntries(value: unknown): value is FormEntries {
  return (
    Array.isArray(value) &&
    value.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && typeof entry[1] === 'string')
  );
}

/**
 * Sets a value through the prototype's own setter and fires the events a
 * person would: React tracks the last value it rendered and ignores an event
 * whose value it already knows, so assigning `element.value` directly would
 * change the box and never reach a controlled control's `onChange`.
 */
function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  if (element.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Writes entries back into the form's draftable controls. A checkbox or
 * radio is clicked rather than set, which is the one interaction that both
 * changes it and tells React. Controls the entries do not mention keep their
 * value, except checkboxes and multiple selects, whose "nothing chosen" is
 * itself the absence of an entry.
 */
export function writeEntries(form: HTMLFormElement, entries: FormEntries): void {
  const byName = new Map<string, string[]>();
  for (const [name, value] of entries) {
    const list = byName.get(name) ?? [];
    list.push(value);
    byName.set(name, list);
  }
  const textIndex = new Map<string, number>();

  for (const element of Array.from(form.elements)) {
    if (!draftable(element)) continue;
    const values = byName.get(element.name) ?? [];

    if (element instanceof HTMLInputElement && element.type === 'checkbox') {
      if (element.checked !== values.includes(element.value)) element.click();
    } else if (element instanceof HTMLInputElement && element.type === 'radio') {
      if (values.includes(element.value) && !element.checked) element.click();
    } else if (element instanceof HTMLSelectElement && element.multiple) {
      let changed = false;
      for (const option of Array.from(element.options)) {
        const wanted = values.includes(option.value);
        if (option.selected !== wanted) {
          option.selected = wanted;
          changed = true;
        }
      }
      if (changed) element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (byName.has(element.name)) {
      // Several text controls may share a name; they take the values in order.
      const index = textIndex.get(element.name) ?? 0;
      textIndex.set(element.name, index + 1);
      const value = values[index];
      if (value === undefined) continue;
      if (element instanceof HTMLSelectElement && !Array.from(element.options).some((option) => option.value === value)) continue;
      setValue(element, value);
    }
  }
}

/* -------------------------------------------------------------------------
 * Labels and messages
 * ---------------------------------------------------------------------- */

/**
 * What the person reads as the control's name: its label's text without the
 * required star or the "(optional)" marker, else its `aria-label`, else the
 * legend of the group it is in, else its name.
 */
export function controlLabel(element: Control): string {
  const label = element.labels?.[0];
  if (label) {
    const copy = label.cloneNode(true) as HTMLElement;
    for (const extra of Array.from(copy.querySelectorAll('[aria-hidden="true"], .itsm-Field__optional, .itsm-Field__required'))) extra.remove();
    const text = copy.textContent?.replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  const aria = element.getAttribute('aria-label')?.trim();
  if (aria) return aria;
  const legend = element.closest('fieldset')?.querySelector('legend');
  if (legend) {
    const copy = legend.cloneNode(true) as HTMLElement;
    for (const extra of Array.from(copy.querySelectorAll('[aria-hidden="true"], .itsm-Field__optional'))) extra.remove();
    const text = copy.textContent?.replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return element.name || 'This field';
}

/**
 * The browser's constraint failure, in the product's words. The same
 * sentences `validateForm` uses for catalogue forms, so a required field
 * reads the same whichever of the two caught it; the browser's own message
 * (locale-dependent, "Please fill out this field") is the last resort.
 */
export function constraintMessage(element: Control): string {
  const label = controlLabel(element);
  const { validity } = element;
  if (validity.customError) return element.validationMessage;
  if (validity.valueMissing) return `${label} is required`;
  if (validity.typeMismatch) {
    if (element.type === 'email') return `${label} must be an e-mail address`;
    if (element.type === 'url') return `${label} must be a web address, starting https://`;
  }
  if (validity.badInput) return element.type === 'number' ? `${label} must be a number` : `${label} must be a real ${element.type === 'date' ? 'date' : 'value'}`;
  if (validity.tooShort && 'minLength' in element) return `${label} must be at least ${element.minLength} characters`;
  if (validity.tooLong && 'maxLength' in element) return `${label} must be ${element.maxLength} characters or fewer`;
  if (validity.rangeUnderflow && element instanceof HTMLInputElement) return `${label} must be ${element.min} or more`;
  if (validity.rangeOverflow && element instanceof HTMLInputElement) return `${label} must be ${element.max} or less`;
  if (validity.stepMismatch && element instanceof HTMLInputElement) {
    return element.step === '' || element.step === '1' ? `${label} must be a whole number` : `${label} must be in steps of ${element.step}`;
  }
  if (validity.patternMismatch) return element.title ? `${label}: ${element.title}` : `${label} is not in the expected format`;
  return element.validationMessage || `${label} is not valid`;
}

export interface ConstraintFailure {
  readonly element: Control;
  readonly message: string;
}

/**
 * Every control the browser's constraints reject, in document order, once
 * per name (a required radio group fails on each of its radios, and is one
 * question).
 */
export function constraintFailures(form: HTMLFormElement): readonly ConstraintFailure[] {
  const out: ConstraintFailure[] = [];
  const seen = new Set<string>();
  for (const element of Array.from(form.elements)) {
    if (!isControl(element) || element.disabled || !element.willValidate || element.validity.valid) continue;
    const key = element.name || element.id;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push({ element, message: constraintMessage(element) });
  }
  return out;
}

/**
 * The control a field error names: by `name` (the key a server's field
 * errors use), else by id. For a radio group, its first radio.
 */
export function controlFor(form: HTMLFormElement, key: string): HTMLElement | null {
  const named = form.elements.namedItem(key);
  if (named instanceof HTMLElement) return named;
  if (named && 'length' in named) {
    const first = Array.from(named as unknown as ArrayLike<Element>).find((item): item is HTMLElement => item instanceof HTMLElement);
    if (first) return first;
  }
  const byId = form.ownerDocument.getElementById(key);
  return byId && form.contains(byId) ? byId : null;
}

/* -------------------------------------------------------------------------
 * Focus
 * ---------------------------------------------------------------------- */

const FOCUSABLE = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]';

/** Opens every closed `<details>` around an element, so it can be seen and focused. */
export function revealDetails(element: Element | null): void {
  for (let details = element?.closest('details'); details; details = details.parentElement?.closest('details')) {
    if (!details.open) details.open = true;
  }
}

/**
 * Takes a person from an error summary to the field it is about: scrolls so
 * the field's label (or its group's legend) is in view — the question, not
 * just the box — and focuses the control, or the first control inside a
 * group. Returns whether anything took focus.
 */
export function focusField(fieldId: string, doc: Document = document): boolean {
  const target = doc.getElementById(fieldId);
  if (!target) return false;
  const control = target.matches(FOCUSABLE) ? target : target.querySelector<HTMLElement>(FOCUSABLE);
  if (!control) return false;
  revealDetails(control);
  const label =
    (isControl(control) ? control.labels?.[0] : undefined) ??
    control.closest('fieldset')?.querySelector('legend') ??
    control;
  if (typeof label.scrollIntoView === 'function') label.scrollIntoView({ block: 'center' });
  control.focus({ preventScroll: true });
  return doc.activeElement === control;
}
