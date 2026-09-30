/**
 * The shortcut notation: `mod+k`, `shift+j`, `g m`, `?`, `mod+shift+enter`.
 *
 * One notation, read in one place, because four things have to agree on it:
 * `useHotkey`, which matches it against key presses; `Kbd`, which draws it as
 * key caps; the tooltips and the shortcuts dialog, which list it; and
 * `aria-keyshortcuts`, which tells assistive technology about it. When each
 * parsed the string itself, `Kbd` showed "⌘K" for a shortcut that only fired
 * with Ctrl.
 *
 * Server-safe and pure — no directive, no DOM at import time — so `Kbd` can
 * draw a shortcut in a server component.
 *
 * The grammar:
 *
 *   - Steps of a chord are separated by spaces: `g m` is G, then M.
 *   - Keys pressed together are joined by `+`: `mod+shift+k`. A literal plus
 *     is the last key of a combination (`mod++`) or written `plus`.
 *   - `mod` is ⌘ on Apple devices and Ctrl everywhere else — the one modifier
 *     whose meaning depends on the platform.
 *   - Named keys: `enter`, `escape`, `tab`, `space`, `backspace`, `delete`,
 *     the arrows (`up`, `down`, `left`, `right`), `home`, `end`, `pageup`,
 *     `pagedown`, `f1`–`f12`, `contextmenu`. Anything else is one character,
 *     matched against `KeyboardEvent.key`, so `/`, `?`, `[` and `]` mean the
 *     character typed, whatever key produced it on the person's layout.
 */
import type { OsName } from '../theme/prefs.js';

export type Modifier = 'mod' | 'ctrl' | 'meta' | 'alt' | 'shift';

/** One step: the modifiers held and the key pressed. */
export interface KeyCombo {
  readonly modifiers: readonly Modifier[];
  /** Lower-case: a named key (`enter`, `arrowdown`, `f6`) or a single character (`k`, `?`, `/`). */
  readonly key: string;
}

/** A shortcut: one combination, or several pressed one after another (a chord). */
export type Shortcut = readonly KeyCombo[];

const modifierAliases: Readonly<Record<string, Modifier>> = {
  mod: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta',
  win: 'meta',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
};

const keyAliases: Readonly<Record<string, string>> = {
  esc: 'escape',
  return: 'enter',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
  spacebar: 'space',
  ' ': 'space',
  plus: '+',
  pgup: 'pageup',
  pgdn: 'pagedown',
  menu: 'contextmenu',
};

const namedKeys = new Set([
  'enter',
  'escape',
  'tab',
  'space',
  'backspace',
  'delete',
  'insert',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'home',
  'end',
  'pageup',
  'pagedown',
  'contextmenu',
  ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
]);

/** Display order of modifiers: Control, Option, Shift, Command on a Mac (Apple's order); Ctrl, Alt, Shift elsewhere. */
const modifierOrder: readonly Modifier[] = ['ctrl', 'alt', 'shift', 'meta'];

function parseCombo(text: string): KeyCombo | null {
  // Split on `+` except a trailing one, so `mod++` is mod and the plus key.
  const parts = text.split(/\+(?!$)/).map((part) => part.trim().toLowerCase());
  const keyPart = parts.pop();
  if (keyPart === undefined || keyPart === '') return null;
  const modifiers = new Set<Modifier>();
  for (const part of parts) {
    const modifier = modifierAliases[part];
    if (!modifier) return null;
    modifiers.add(modifier);
  }
  const key = keyAliases[keyPart] ?? keyPart;
  if (!namedKeys.has(key) && [...key].length !== 1) return null;
  return { modifiers: [...modifiers], key };
}

/**
 * Reads the notation. An unreadable shortcut — a typo such as `mdo+k` — comes
 * back empty rather than throwing: a hint that draws nothing is a smaller
 * failure than a page that does not render, and `useHotkey` warns about it in
 * development.
 */
export function parseShortcut(notation: string): Shortcut {
  const steps = notation.trim().split(/\s+/).filter(Boolean);
  const combos: KeyCombo[] = [];
  for (const step of steps) {
    const combo = parseCombo(step);
    if (!combo) return [];
    combos.push(combo);
  }
  return combos;
}

/** A key that types a character: a letter, digit or symbol, or Space. What WCAG 2.1.4 calls a character key. */
export function isCharacterKey(key: string): boolean {
  return key === 'space' || [...key].length === 1;
}

/**
 * A shortcut made only of character keys (Shift allowed): `c`, `?`, `g m`,
 * `shift+j`. These are the shortcuts a person can switch off, and the ones
 * that never fire while typing or inside a menu, list or grid.
 */
export function isSingleKeyShortcut(shortcut: Shortcut): boolean {
  return (
    shortcut.length > 0 &&
    shortcut.every(
      (combo) => isCharacterKey(combo.key) && combo.modifiers.every((modifier) => modifier === 'shift'),
    )
  );
}

/** The modifiers a combination really means on this platform: `mod` resolved to Command or Control. */
export function resolveModifiers(combo: KeyCombo, os: OsName): ReadonlySet<Exclude<Modifier, 'mod'>> {
  const resolved = new Set<Exclude<Modifier, 'mod'>>();
  for (const modifier of combo.modifiers) {
    if (modifier === 'mod') resolved.add(os === 'apple' ? 'meta' : 'ctrl');
    else resolved.add(modifier);
  }
  return resolved;
}

/* -------------------------------------------------------------------------
 * Matching
 * ---------------------------------------------------------------------- */

/** The parts of a `KeyboardEvent` matching reads, so the rule can be tested without one. */
export interface KeyPress {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

const eventKeyNames: Readonly<Record<string, string>> = {
  ' ': 'space',
  esc: 'escape',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
  apps: 'contextmenu',
};

/** `KeyboardEvent.key`, lower-cased and named the way the notation names it. */
export function eventKeyName(key: string): string {
  const lower = key.toLowerCase();
  return eventKeyNames[lower] ?? lower;
}

const asciiLetterOrDigit = /^[a-z0-9]$/;

/**
 * Whether a key press is this combination.
 *
 * Matched on `event.key`, the character the layout produced, so `?` and `/`
 * work on a German or French keyboard where they sit elsewhere. Shift is
 * therefore not checked for symbols — it is how `?` is typed on one layout
 * and not on another — but it is for letters and named keys, where `shift+j`
 * and `j` are different shortcuts.
 *
 * A symbol bound on its own (`[`, `/`) is typed with whatever the layout
 * needs — Option on a German Mac, AltGr (reported as Ctrl and Alt together)
 * on a German PC — so those are allowed for it too. Command never is.
 *
 * Two fallbacks to the physical key (`event.code`), for letters and digits
 * only: with Option held a Mac types `˚` for K, and a Cyrillic or Greek layout
 * types its own letter, and in both cases the person still expects the
 * shortcut printed on the key cap to work.
 */
export function matchesCombo(press: KeyPress, combo: KeyCombo, os: OsName): boolean {
  const wanted = resolveModifiers(combo, os);
  const symbol = [...combo.key].length === 1 && !/^[a-z0-9]$/.test(combo.key);
  const typedSymbol = symbol && !wanted.has('ctrl') && !wanted.has('alt') && !wanted.has('meta');
  if (typedSymbol) {
    if (press.metaKey) return false;
    const altGraph = os !== 'apple' && press.ctrlKey && press.altKey;
    if (press.ctrlKey && !altGraph) return false;
    if (press.altKey && !altGraph && os !== 'apple') return false;
  } else {
    if (press.ctrlKey !== wanted.has('ctrl')) return false;
    if (press.metaKey !== wanted.has('meta')) return false;
    if (press.altKey !== wanted.has('alt')) return false;
  }
  if (!symbol && press.shiftKey !== wanted.has('shift')) return false;
  if (symbol && wanted.has('shift') && !press.shiftKey) return false;

  const name = eventKeyName(press.key);
  if (name === combo.key) return true;

  if (asciiLetterOrDigit.test(combo.key) && press.code) {
    const produced = [...press.key].length === 1 ? press.key : '';
    const nonAscii = produced !== '' && !/^[\x20-\x7e]$/.test(produced);
    if (press.altKey || nonAscii) {
      const code = /^[0-9]$/.test(combo.key) ? `Digit${combo.key}` : `Key${combo.key.toUpperCase()}`;
      return press.code === code;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------
 * Describing
 * ---------------------------------------------------------------------- */

type Platform = 'apple' | 'other';

const glyphs: Readonly<Record<Platform, Readonly<Record<string, string>>>> = {
  apple: {
    ctrl: '⌃',
    alt: '⌥',
    shift: '⇧',
    meta: '⌘',
    enter: '↩',
    escape: 'esc',
    tab: '⇥',
    space: 'Space',
    backspace: '⌫',
    delete: '⌦',
    insert: 'Ins',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    home: 'Home',
    end: 'End',
    pageup: 'Page Up',
    pagedown: 'Page Down',
    contextmenu: 'Menu',
  },
  other: {
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    meta: 'Win',
    enter: 'Enter',
    escape: 'Esc',
    tab: 'Tab',
    space: 'Space',
    backspace: 'Backspace',
    delete: 'Del',
    insert: 'Ins',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    home: 'Home',
    end: 'End',
    pageup: 'PgUp',
    pagedown: 'PgDn',
    contextmenu: 'Menu',
  },
};

const spokenNames: Readonly<Record<Platform, Readonly<Record<string, string>>>> = {
  apple: {
    ctrl: 'Control',
    alt: 'Option',
    shift: 'Shift',
    meta: 'Command',
    enter: 'Return',
    escape: 'Escape',
    backspace: 'Delete',
    delete: 'Forward Delete',
  },
  other: {
    ctrl: 'Control',
    alt: 'Alt',
    shift: 'Shift',
    meta: 'Windows',
    enter: 'Enter',
    escape: 'Escape',
    backspace: 'Backspace',
    delete: 'Delete',
  },
};

const sharedSpoken: Readonly<Record<string, string>> = {
  tab: 'Tab',
  space: 'Space',
  insert: 'Insert',
  arrowup: 'Up Arrow',
  arrowdown: 'Down Arrow',
  arrowleft: 'Left Arrow',
  arrowright: 'Right Arrow',
  home: 'Home',
  end: 'End',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  contextmenu: 'Menu key',
  '/': 'Slash',
  '?': 'Question mark',
  '[': 'Left bracket',
  ']': 'Right bracket',
  '.': 'Full stop',
  ',': 'Comma',
  '+': 'Plus',
  '-': 'Minus',
  '=': 'Equals',
  ';': 'Semicolon',
  ':': 'Colon',
  "'": 'Apostrophe',
  '`': 'Backtick',
  '\\': 'Backslash',
  '#': 'Hash',
};

/** What a platform's key caps read, in their order, for one combination. */
function combination(combo: KeyCombo, platform: Platform): { caps: string[]; spoken: string[] } {
  const modifiers = resolveModifiers(combo, platform === 'apple' ? 'apple' : 'other');
  const caps: string[] = [];
  const spoken: string[] = [];
  for (const modifier of modifierOrder) {
    if (!modifiers.has(modifier as Exclude<Modifier, 'mod'>)) continue;
    caps.push(glyphs[platform][modifier]!);
    spoken.push(spokenNames[platform][modifier]!);
  }
  const { key } = combo;
  const letter = /^[a-z]$/.test(key);
  caps.push(glyphs[platform][key] ?? (/^f\d+$/.test(key) ? key.toUpperCase() : letter ? key.toUpperCase() : key));
  spoken.push(
    spokenNames[platform][key] ?? sharedSpoken[key] ?? (/^f\d+$/.test(key) ? key.toUpperCase() : letter ? key.toUpperCase() : key),
  );
  return { caps, spoken };
}

/** One platform's rendering of a shortcut: the key caps of each step, and the sentence a screen reader says. */
export interface ShortcutDescription {
  /** One array of key caps per step of the chord. */
  readonly steps: readonly (readonly string[])[];
  /** "Command K", "G, then M". */
  readonly spoken: string;
  /** "⌘K", "Ctrl+K", "G then M": for tooltips, menus and other plain text. */
  readonly text: string;
}

/**
 * How a shortcut reads on Apple devices or elsewhere. `mod` is the only part
 * that differs by platform in meaning; the glyphs differ in form (⌥ or Alt).
 */
export function describeShortcut(notation: string | Shortcut, os: OsName): ShortcutDescription {
  const shortcut = typeof notation === 'string' ? parseShortcut(notation) : notation;
  const platform: Platform = os === 'apple' ? 'apple' : 'other';
  const described = shortcut.map((combo) => combination(combo, platform));
  const joiner = platform === 'apple' ? '' : '+';
  return {
    steps: described.map((step) => step.caps),
    spoken: described.map((step) => step.spoken.join(' ')).join(', then '),
    text: described.map((step) => step.caps.join(joiner)).join(' then '),
  };
}

/** Whether a shortcut reads the same on every platform, so one rendering serves all. */
export function isPlatformNeutral(notation: string | Shortcut): boolean {
  const shortcut = typeof notation === 'string' ? parseShortcut(notation) : notation;
  const apple = describeShortcut(shortcut, 'apple');
  const other = describeShortcut(shortcut, 'other');
  return apple.spoken === other.spoken && apple.text === other.text;
}

const ariaKeyNames: Readonly<Record<string, string>> = {
  ctrl: 'Control',
  alt: 'Alt',
  shift: 'Shift',
  meta: 'Meta',
  enter: 'Enter',
  escape: 'Escape',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  contextmenu: 'ContextMenu',
};

function ariaCombination(modifiers: ReadonlySet<Exclude<Modifier, 'mod'>>, key: string): string {
  const parts = modifierOrder.filter((modifier) => modifiers.has(modifier as Exclude<Modifier, 'mod'>)).map((m) => ariaKeyNames[m]!);
  const name = ariaKeyNames[key] ?? (/^f\d+$/.test(key) ? key.toUpperCase() : /^[a-z]$/.test(key) ? key.toUpperCase() : key);
  return [...parts, name].join('+');
}

/**
 * The value for `aria-keyshortcuts`, or `undefined` for a chord, which the
 * attribute cannot express. `mod` becomes both alternatives, "Meta+K
 * Control+K", because the server renders the attribute without knowing the
 * platform.
 */
export function ariaKeyShortcuts(notation: string | Shortcut): string | undefined {
  const shortcut = typeof notation === 'string' ? parseShortcut(notation) : notation;
  if (shortcut.length !== 1) return undefined;
  const combo = shortcut[0]!;
  if (!combo.modifiers.includes('mod')) return ariaCombination(resolveModifiers(combo, 'other'), combo.key);
  const apple = ariaCombination(resolveModifiers(combo, 'apple'), combo.key);
  const other = ariaCombination(resolveModifiers(combo, 'other'), combo.key);
  return apple === other ? apple : `${apple} ${other}`;
}
