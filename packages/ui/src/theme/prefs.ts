/**
 * Display preferences: the model, its storage, and how it becomes attributes.
 *
 * One object per origin in `localStorage['itsm-prefs']`, read before first
 * paint by the inline script (`theme-script.ts`) and kept in sync afterwards by
 * `ThemeProvider`. Both turn it into `data-itsm-*` attributes on `<html>`,
 * and the stylesheet does the rest — so a preference never waits for React.
 *
 * Server-safe: no hooks, no DOM access at import time. Everything here is a
 * pure function of its arguments, which is what lets the tests hold the inline
 * script to exactly the same answers.
 *
 * Preferences do not follow a person between the three apps or between
 * devices: each origin remembers its own. Keeping them on the server
 * (`/me/preferences`) is a later piece of work.
 */
import type { ThemeName } from '../tokens/tokens.js';

export interface Prefs {
  /** Light or dark, or whatever the device says. */
  appearance: 'system' | 'light' | 'dark';
  /** "Increase contrast": follows the device until the person touches it. */
  contrast: 'system' | 'standard' | 'more';
  density: 'comfortable' | 'compact';
  /** `reduced` adds to the operating system's setting; it cannot turn the OS setting off. */
  motion: 'system' | 'reduced';
  transparency: 'system' | 'reduced';
  /** Single-key shortcuts (WCAG 2.1.4). */
  shortcuts: 'on' | 'off';
  /** Polite live announcements of incoming work in the workbench. */
  announceLive: 'on' | 'off';
  /** Admin: show technical keys (permission, setting, action keys) beside their names. */
  showKeys: boolean;
  /** Sidebar apps: `rail` when the person has collapsed the sidebar (applies at 1280px and up). */
  nav: 'auto' | 'rail';
  /** Workbench: the inspector column. */
  inspector: 'open' | 'closed';
}

export type AppName = 'admin' | 'workbench' | 'portal';
export type OsName = 'apple' | 'windows' | 'other';

/** The key everything is stored under. */
export const prefsStorageKey = 'itsm-prefs';

/**
 * Where the theme used to be stored, as a bare theme name. Read once, migrated
 * into `itsm-prefs`, and removed.
 */
export const legacyThemeStorageKey = 'itsm-theme';

export const defaultPrefs: Readonly<Prefs> = {
  appearance: 'system',
  contrast: 'system',
  density: 'comfortable',
  motion: 'system',
  transparency: 'system',
  shortcuts: 'on',
  announceLive: 'on',
  showKeys: false,
  nav: 'auto',
  inspector: 'open',
};

/**
 * The values each preference may take. Anything else in storage — a value from
 * a later release, a hand edit, a different app's key — reads as the default
 * rather than as an error.
 */
export const prefValues: { readonly [K in keyof Prefs]: readonly Prefs[K][] } = {
  appearance: ['system', 'light', 'dark'],
  contrast: ['system', 'standard', 'more'],
  density: ['comfortable', 'compact'],
  motion: ['system', 'reduced'],
  transparency: ['system', 'reduced'],
  shortcuts: ['on', 'off'],
  announceLive: ['on', 'off'],
  showKeys: [false, true],
  nav: ['auto', 'rail'],
  inspector: ['open', 'closed'],
};

/**
 * The preferences in a stored value that are recognisably ours, and nothing
 * else. Anything unexpected — a value from a later release, a hand edit —
 * is dropped, so it reads as the default rather than as an error.
 */
export function sanitisePrefs(stored: unknown): Partial<Prefs> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  const source = stored as Record<string, unknown>;
  const result: Partial<Record<keyof Prefs, unknown>> = {};
  for (const key of Object.keys(prefValues) as (keyof Prefs)[]) {
    if ((prefValues[key] as readonly unknown[]).includes(source[key])) result[key] = source[key];
  }
  return result as Partial<Prefs>;
}

/** A complete `Prefs`: what was stored, then the app's defaults, then the system's. */
export function normalisePrefs(stored: unknown, defaults: Partial<Prefs> = {}): Prefs {
  return { ...defaultPrefs, ...sanitisePrefs(defaults), ...sanitisePrefs(stored) };
}

/**
 * What a stored legacy theme name means in the new model. `apple` and `light`
 * were light, `apple-dark` and `dark` were dark, `high-contrast` was the
 * contrast switch; `system`, or anything unrecognised, means "follow the
 * device" on both axes.
 */
export function migrateLegacyTheme(legacy: string): Partial<Prefs> {
  switch (legacy) {
    case 'apple':
    case 'light':
      return { appearance: 'light' };
    case 'apple-dark':
    case 'dark':
      return { appearance: 'dark' };
    case 'high-contrast':
      return { contrast: 'more' };
    default:
      return {};
  }
}

/**
 * The choices this person has made, as stored — only the ones they made, so
 * that a default changed in a later release still reaches everybody who never
 * chose otherwise. Migrates the legacy key the first time it finds it.
 *
 * Never throws: storage can be denied outright (private mode, a blocked
 * third-party context, a full quota), and a preference is not worth an
 * exception. A value that is not JSON reads as no choices at all.
 */
export function readStoredPrefs(storage: Storage | undefined, key: string = prefsStorageKey): Partial<Prefs> {
  if (!storage) return {};
  try {
    const stored = storage.getItem(key);
    if (stored) return sanitisePrefs(JSON.parse(stored));
    const legacy = storage.getItem(legacyThemeStorageKey);
    if (legacy === null) return {};
    const migrated = migrateLegacyTheme(legacy);
    storage.setItem(key, JSON.stringify(migrated));
    storage.removeItem(legacyThemeStorageKey);
    return migrated;
  } catch {
    return {};
  }
}

/** Stores the choices. Returns false when storage refused; the choice still applies to this page. */
export function writeStoredPrefs(storage: Storage | undefined, stored: Partial<Prefs>, key: string = prefsStorageKey): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(sanitisePrefs(stored)));
    return true;
  } catch {
    return false;
  }
}

/** What the operating system says, as far as the theme is concerned. */
export interface MediaState {
  readonly dark: boolean;
  readonly moreContrast: boolean;
}

/** The theme in force: each axis the person set, and the device's answer for each axis they did not. */
export function resolveTheme(prefs: Pick<Prefs, 'appearance' | 'contrast'>, media: MediaState): ThemeName {
  const dark = prefs.appearance === 'dark' || (prefs.appearance === 'system' && media.dark);
  const more = prefs.contrast === 'more' || (prefs.contrast === 'system' && media.moreContrast);
  if (more) return dark ? 'high-contrast-dark' : 'high-contrast';
  return dark ? 'apple-dark' : 'apple';
}

/**
 * The value for `data-itsm-theme`, or `null` for none. With both axes on
 * "follow the device" the attribute stays off and the stylesheet's own media
 * queries answer, live, as the device changes — no script involved.
 */
export function pinnedTheme(prefs: Pick<Prefs, 'appearance' | 'contrast'>, media: MediaState): ThemeName | null {
  return prefs.appearance === 'system' && prefs.contrast === 'system' ? null : resolveTheme(prefs, media);
}

/** Every attribute the preferences own on `<html>`. */
export const preferenceAttributeNames = [
  'data-itsm-theme',
  'data-itsm-density',
  'data-itsm-motion',
  'data-itsm-transparency',
  'data-itsm-os',
  'data-itsm-nav',
  'data-itsm-inspector',
] as const;
export type PreferenceAttribute = (typeof preferenceAttributeNames)[number];

/**
 * The attributes for a set of preferences, `null` meaning "absent". The inline
 * script computes the same thing by hand; the tests compare the two.
 */
export function preferenceAttributes(
  prefs: Prefs,
  context: { readonly media: MediaState; readonly os: OsName; readonly app?: AppName },
): Record<PreferenceAttribute, string | null> {
  return {
    'data-itsm-theme': pinnedTheme(prefs, context.media),
    'data-itsm-density': prefs.density,
    'data-itsm-motion': prefs.motion === 'reduced' ? 'reduced' : null,
    'data-itsm-transparency': prefs.transparency === 'reduced' ? 'reduced' : null,
    'data-itsm-os': context.os,
    'data-itsm-nav': prefs.nav === 'rail' ? 'rail' : null,
    // Only the workbench has an inspector; elsewhere the attribute would be a
    // claim about a column that does not exist.
    'data-itsm-inspector': context.app === 'workbench' ? prefs.inspector : null,
  };
}

/**
 * The platform, for keyboard glyphs (⌘ or Ctrl) chosen in CSS. `platform`
 * rather than client hints: it is synchronous, present in every browser, and
 * still names the operating system family ("MacIntel", "Win32"); the user
 * agent is the fallback where it is empty. An iPad reports itself as a Mac,
 * which is the right answer here — it has a ⌘ key.
 */
export function detectOs(nav: Pick<Navigator, 'platform' | 'userAgent'>): OsName {
  const platform = nav.platform || nav.userAgent || '';
  // `iPhone`, `iPad`, `iPod` — and `MacIntel`, which iPadOS also reports.
  if (/mac|^ip/i.test(platform)) return 'apple';
  if (/win/i.test(platform)) return 'windows';
  return 'other';
}

/* -------------------------------------------------------------------------
 * The single-setting model, kept for the release
 * ---------------------------------------------------------------------- */

/**
 * @deprecated One theme name or `system`. Replaced by `Prefs`, where
 * appearance and contrast are separate choices; kept while applications still
 * offer a single "Appearance" radio group.
 */
export type ThemeSetting = ThemeName | 'system';

/** The preferences a single-setting choice stands for: exactly that theme, whatever the device says. */
export function themeSettingToPrefs(setting: ThemeSetting): Pick<Prefs, 'appearance' | 'contrast'> {
  switch (setting) {
    case 'system':
      return { appearance: 'system', contrast: 'system' };
    case 'apple':
      return { appearance: 'light', contrast: 'standard' };
    case 'apple-dark':
      return { appearance: 'dark', contrast: 'standard' };
    case 'high-contrast':
      return { appearance: 'light', contrast: 'more' };
    case 'high-contrast-dark':
      return { appearance: 'dark', contrast: 'more' };
  }
}
