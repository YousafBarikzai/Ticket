'use client';

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { detectOs, type OsName } from '../theme/prefs.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { isSingleKeyShortcut, matchesCombo, parseShortcut, type Shortcut } from './keys.js';

/** What a handler learns besides the event: who pressed it, and how to give focus back to them. */
export interface HotkeyContext {
  /** The element that had focus when the shortcut was pressed (a list row, say). */
  readonly invoker: HTMLElement | null;
  /** Focuses `invoker` again if it is still on the page — for a menu or dialog the shortcut opened, on close. */
  restoreFocus(): void;
}

export interface HotkeyOptions {
  /** `mod+k`, `g m` (a chord), `/`, `?`, `shift+j`. Matched on `event.key`, so `/` and `?` work on every layout. */
  readonly keys: string;
  handler(event: KeyboardEvent, context: HotkeyContext): void;
  /** The whole document (default), or only while focus is inside an element. */
  readonly scope?: 'global' | RefObject<HTMLElement | null>;
  /**
   * Also fire while typing in a field. Only for `mod+k`, `mod+enter`,
   * `mod+shift+enter`, `mod+s` and `escape` — a single-key shortcut that fires
   * inside a text field eats the letter the person meant to type.
   */
  readonly allowInFields?: boolean;
  /** Listed in the shortcuts dialog. */
  readonly description: string;
  readonly group: string;
  readonly enabled?: boolean;
  /**
   * Fires even where the application has switched single-key shortcuts off
   * (`features.singleKeyShortcuts`) — the portal's `/` on Home and Knowledge.
   * The person's own switch (`prefs.shortcuts`) still wins.
   */
  readonly essential?: boolean;
  /** Left out of the shortcuts dialog (a second binding for something already listed). */
  readonly hidden?: boolean;
  /** Let a held key repeat the shortcut. Off by default: a held `?` must not open and close the dialog forty times. */
  readonly repeat?: boolean;
}

/** A shortcut as the shortcuts dialog lists it. */
export interface HotkeyListing {
  readonly keys: string;
  readonly description: string;
  readonly group: string;
}

/** How long a chord waits for its second key. */
export const CHORD_TIMEOUT_MS = 1200;

interface Entry {
  readonly id: number;
  shortcut: Shortcut;
  options: HotkeyOptions;
  /** Whether single-key shortcuts may fire for this entry: the app's switch and the person's. */
  singleKeysAllowed: boolean;
}

/* -------------------------------------------------------------------------
 * Where focus is
 * ---------------------------------------------------------------------- */

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
]);

/** Somewhere typing produces text: a character key here is the person writing, not a command. */
export function isTextEntry(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(element.type);
  if (element.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  const role = element.getAttribute('role');
  return role === 'textbox' || role === 'searchbox' || role === 'combobox';
}

/**
 * The widgets whose own keyboard model uses character keys — typeahead in a
 * menu or listbox, letters in a grid, arrows in a slider (SPEC §4.1, X-63).
 * A single-key shortcut pressed in one of them belongs to the widget.
 */
const COMPOSITE_WIDGETS = [
  'input',
  'select',
  '[role="menu"]',
  '[role="menubar"]',
  '[role^="menuitem"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="grid"]',
  '[role="treegrid"]',
  '[role="tree"]',
  '[role="radiogroup"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="combobox"]',
].join(',');

function insideCompositeWidget(element: Element | null): boolean {
  return element?.closest(COMPOSITE_WIDGETS) != null;
}

/**
 * Inside a modal dialog or sheet: the page's global shortcuts stay quiet
 * there, since the page behind is not what the person is working on. A
 * non-modal surface (the workbench inspector as a sheet) says so with
 * `aria-modal="false"` and lets them through — Radix leaves `aria-modal` off
 * modal dialogs, so absence has to mean modal.
 */
function insideDialog(element: Element | null): boolean {
  return element?.closest('[role="alertdialog"], [aria-modal="true"], [role="dialog"]:not([aria-modal="false"])') != null;
}

/** A subtree that has asked for no shortcuts at all — a code editor, an embedded tool. */
function insideOptOut(element: Element | null): boolean {
  return element?.closest('[data-itsm-hotkeys="off"]') != null;
}

/* -------------------------------------------------------------------------
 * The registry and the one listener
 * ---------------------------------------------------------------------- */

const entries = new Map<number, Entry>();
let nextId = 1;
let chord: { readonly steps: number; readonly candidates: readonly Entry[]; readonly timer: ReturnType<typeof setTimeout> } | null = null;
let invoker: HTMLElement | null = null;
let cachedOs: OsName | null = null;

const registryListeners = new Set<() => void>();
let listing: readonly HotkeyListing[] = Object.freeze([]);

function os(): OsName {
  cachedOs ??= typeof navigator === 'undefined' ? 'other' : detectOs(navigator);
  return cachedOs;
}

function rebuildListing(): void {
  const seen = new Set<string>();
  const next: HotkeyListing[] = [];
  for (const entry of entries.values()) {
    const { keys, description, group, hidden, enabled } = entry.options;
    if (hidden || enabled === false || entry.shortcut.length === 0) continue;
    const key = `${group}\u0000${keys}\u0000${description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({ keys, description, group });
  }
  listing = Object.freeze(next);
  for (const listener of [...registryListeners]) listener();
}

function clearChord(): void {
  if (chord) clearTimeout(chord.timer);
  chord = null;
}

/** Whether an entry may fire for a key press with focus on `target`. */
function eligible(entry: Entry, target: Element | null): boolean {
  const { options } = entry;
  if (options.enabled === false || entry.shortcut.length === 0) return false;
  if (insideOptOut(target)) return false;

  const scope = options.scope ?? 'global';
  if (scope !== 'global') {
    const root = scope.current;
    if (!root || !target || !root.contains(target)) return false;
  } else if (!options.allowInFields && insideDialog(target)) {
    return false;
  }

  if (!options.allowInFields && isTextEntry(target)) return false;
  if (isSingleKeyShortcut(entry.shortcut)) {
    if (!entry.singleKeysAllowed) return false;
    if (isTextEntry(target) || insideCompositeWidget(target)) return false;
  }
  return true;
}

/**
 * Which of several matching entries wins: one scoped to where focus is over
 * a global one, then the most recently registered — a page's `c` over the
 * shell's, a drawer's `escape` over the page's.
 */
function pick(candidates: readonly Entry[]): Entry | undefined {
  const scoped = candidates.filter((entry) => (entry.options.scope ?? 'global') !== 'global');
  const pool = scoped.length > 0 ? scoped : candidates;
  return pool.reduce<Entry | undefined>((best, entry) => (!best || entry.id > best.id ? entry : best), undefined);
}

function fire(entry: Entry, event: KeyboardEvent): void {
  event.preventDefault();
  const active = document.activeElement;
  invoker = active instanceof HTMLElement && active !== document.body ? active : null;
  const origin = invoker;
  entry.options.handler(event, {
    invoker: origin,
    restoreFocus: () => {
      if (origin?.isConnected) origin.focus();
    },
  });
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'OS', 'Hyper', 'Super']);

function onKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  if (MODIFIER_KEYS.has(event.key)) return;
  const target = event.target instanceof Element ? event.target : document.activeElement;
  const platform = os();

  if (chord) {
    const step = chord.steps;
    const completing = chord.candidates.filter(
      (entry) => entry.shortcut.length > step && matchesCombo(event, entry.shortcut[step]!, platform) && eligible(entry, target),
    );
    clearChord();
    const finished = completing.filter((entry) => entry.shortcut.length === step + 1);
    if (finished.length > 0) {
      fire(pick(finished)!, event);
      return;
    }
    if (completing.length > 0) {
      startChord(completing, step + 1);
      event.preventDefault();
      return;
    }
    // Not a continuation: the key is judged on its own below.
  }

  if (event.repeat) {
    const repeating = [...entries.values()].filter(
      (entry) => entry.options.repeat && entry.shortcut.length === 1 && matchesCombo(event, entry.shortcut[0]!, platform) && eligible(entry, target),
    );
    const winner = pick(repeating);
    if (winner) fire(winner, event);
    return;
  }

  const starting: Entry[] = [];
  const single: Entry[] = [];
  for (const entry of entries.values()) {
    if (!matchesCombo(event, entry.shortcut[0] ?? { key: '', modifiers: [] }, platform)) continue;
    if (!eligible(entry, target)) continue;
    if (entry.shortcut.length > 1) starting.push(entry);
    else single.push(entry);
  }
  // A chord's first key wins over a one-key shortcut on the same key: the
  // chord cannot be typed otherwise, and nothing in the keyboard map binds
  // both (`g` alone is free).
  if (starting.length > 0) {
    startChord(starting, 1);
    return;
  }
  const winner = pick(single);
  if (winner) fire(winner, event);
}

function startChord(candidates: readonly Entry[], steps: number): void {
  clearChord();
  chord = { steps, candidates, timer: setTimeout(clearChord, CHORD_TIMEOUT_MS) };
}

function register(entry: Entry): () => void {
  entries.set(entry.id, entry);
  if (entries.size === 1) document.addEventListener('keydown', onKeyDown);
  rebuildListing();
  return () => {
    entries.delete(entry.id);
    if (chord?.candidates.includes(entry)) clearChord();
    if (entries.size === 0) {
      document.removeEventListener('keydown', onKeyDown);
      clearChord();
    }
    rebuildListing();
  };
}

/* -------------------------------------------------------------------------
 * Hooks
 * ---------------------------------------------------------------------- */

/** A layout effect in the browser (before other effects), nothing on the server. */
const useLatestEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Binds a keyboard shortcut and lists it in the shortcuts dialog.
 *
 * Single-character shortcuts (`c`, `/`, `g m`) never fire inside text fields,
 * selects, `contenteditable`, or menus, listboxes, grids, radio groups,
 * sliders and comboboxes — where the character belongs to the widget — nor
 * when the person has switched single-key shortcuts off, nor in an app that
 * has them off (the portal) unless `essential` (WCAG 2.1.4, X-63). Any
 * shortcut without `allowInFields` stays quiet in a text field, and global
 * ones stay quiet inside a dialog or sheet: a dialog's own shortcuts are
 * scoped to it.
 *
 * The matched key press is `preventDefault`ed: `/` that focuses a search
 * field must not also type a slash into it, and `mod+k` must not open the
 * browser's own search.
 *
 * Chords (`g m`) wait 1.2 s for their second key. The handler may be a new
 * function on every render; the binding follows the latest one without
 * re-registering.
 */
export function useHotkey(options: HotkeyOptions): void {
  const { prefs } = useTheme();
  const itsm = useOptionalItsm();
  const singleKeysAllowed =
    prefs.shortcuts !== 'off' && (options.essential === true || (itsm?.features.singleKeyShortcuts ?? true));

  const entryRef = useRef<Entry | null>(null);
  entryRef.current ??= { id: nextId++, shortcut: parseShortcut(options.keys), options, singleKeysAllowed };
  const entry = entryRef.current;
  // The latest options for the one listener to read, updated before any
  // effect runs so the registration below never sees an older handler.
  useLatestEffect(() => {
    entry.options = options;
    entry.singleKeysAllowed = singleKeysAllowed;
  });

  const { keys, description, group, enabled, hidden } = options;
  useEffect(() => {
    entry.shortcut = parseShortcut(keys);
    // An empty `keys` is a field with no shortcut (`SearchField` without one), not a typo.
    if (entry.shortcut.length === 0 && keys !== '' && typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
      console.warn(`@itsm/ui: useHotkey could not read the shortcut "${keys}".`);
    }
    return register(entry);
    // Re-registered when what the dialog lists changes; the handler and scope
    // are read live from `entry.options`.
  }, [entry, keys, description, group, enabled, hidden]);
}

function subscribeListing(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

const NO_LISTING: readonly HotkeyListing[] = Object.freeze([]);

/**
 * Every shortcut currently bound, for the shortcuts dialog: registration
 * order, duplicates (same group, keys and description) listed once, disabled
 * and hidden ones left out. Empty on the server.
 */
export function useHotkeyRegistry(): readonly HotkeyListing[] {
  return useSyncExternalStore(subscribeListing, () => listing, () => NO_LISTING);
}

/**
 * Gives focus back to the element that had it when the last shortcut fired —
 * the row a `.` menu or an `a` (assignee) menu was opened from — if it is
 * still on the page. For overlays that cannot hold the handler's `context`.
 */
export function restoreHotkeyFocus(): boolean {
  const target = invoker;
  invoker = null;
  if (!target?.isConnected) return false;
  target.focus();
  return true;
}
