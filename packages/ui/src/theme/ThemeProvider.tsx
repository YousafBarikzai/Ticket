'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { installAnnouncer } from '../a11y/announcer.js';
import type { ThemeName } from '../tokens/tokens.js';
import {
  defaultPrefs,
  detectOs,
  legacyThemeStorageKey,
  normalisePrefs,
  pinnedTheme,
  preferenceAttributeNames,
  preferenceAttributes,
  prefsStorageKey,
  readStoredPrefs,
  resolveTheme,
  sanitisePrefs,
  themeSettingToPrefs,
  writeStoredPrefs,
  type AppName,
  type MediaState,
  type OsName,
  type Prefs,
  type ThemeSetting,
} from './prefs.js';

/**
 * Theme and display preferences, after first paint.
 *
 * The inline script (`theme-script.ts`) has already put the right attributes
 * on `<html>` before anything was drawn. This provider takes over from there:
 * it holds the preferences in React state, writes them back to storage and to
 * the attributes when they change, follows the device when a preference is on
 * "system", and keeps two open tabs in step through the `storage` event.
 *
 * The first render on the client is the server's render — default
 * preferences, `resolvedTheme: 'system'` — because anything else would fail
 * hydration: the server cannot know what this browser stored. The stored
 * values arrive in an effect a moment later. Nothing is written to `<html>`
 * until they have, so the script's attributes are never replaced by defaults
 * for a frame.
 */

export interface ThemeContextValue {
  readonly prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  /** The theme in force; `system` until the provider has read this browser's settings (and on the server). */
  readonly resolvedTheme: ThemeName | 'system';
  readonly os: OsName;
  /** @deprecated The single-setting view of `prefs`: `system` when both appearance and contrast follow the device. */
  readonly theme: ThemeSetting;
  /** @deprecated Use `setPrefs({ appearance, contrast })`. */
  setTheme: (theme: ThemeSetting) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  readonly children: ReactNode;
  /** Which app this is: the workbench also manages the inspector column. */
  readonly app?: AppName;
  /** Where the preferences are stored; `itsm-prefs` by default, as in `themeInitScript`. */
  readonly storageKey?: string;
  /** This app's defaults, where they differ from the system's. Pass the same to `themeInitScript`. */
  readonly defaults?: Partial<Prefs>;
  /** @deprecated Use `defaults`. */
  readonly defaultTheme?: ThemeSetting;
  /**
   * @deprecated Ignored. The stylesheet is delivered by the document — a
   * `<link>` to `/itsm-ui.css`, or inlined — and never by this provider, which
   * would otherwise carry the whole sheet in every page's JavaScript.
   */
  readonly injectStyles?: boolean;
}

interface State {
  /** Only the choices the person made; see `readStoredPrefs`. */
  readonly stored: Partial<Prefs>;
  readonly media: MediaState;
  readonly os: OsName;
  /** False until this browser's storage and media have been read. */
  readonly ready: boolean;
}

const COLOR_SCHEME_DARK = '(prefers-color-scheme: dark)';
const CONTRAST_MORE = '(prefers-contrast: more)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function query(q: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia(q);
  } catch {
    return null;
  }
}

function readMedia(): MediaState {
  return { dark: query(COLOR_SCHEME_DARK)?.matches ?? false, moreContrast: query(CONTRAST_MORE)?.matches ?? false };
}

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    // Merely reading `localStorage` throws where storage is blocked.
    return undefined;
  }
}

function applyAttributes(attributes: Record<string, string | null>): void {
  const root = document.documentElement;
  for (const name of preferenceAttributeNames) {
    const value = attributes[name];
    if (value === null || value === undefined) root.removeAttribute(name);
    else if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  }
}

/**
 * Cross-fades a theme change where the browser can and motion is welcome.
 * The change happens inside the transition's callback, which the browser
 * calls once it has snapshotted the page as it was.
 */
function withTransition(change: () => void, prefs: Prefs): void {
  const reduced = prefs.motion === 'reduced' || (query(REDUCED_MOTION)?.matches ?? false);
  const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown };
  if (reduced || typeof doc.startViewTransition !== 'function') {
    change();
    return;
  }
  try {
    doc.startViewTransition(change);
  } catch {
    change();
  }
}

export function ThemeProvider({
  children,
  app,
  storageKey,
  defaults,
  defaultTheme,
}: ThemeProviderProps): ReactNode {
  // Applications written before preferences passed the legacy key here. It
  // now names only what the migration reads, so it maps to the new key rather
  // than storing JSON where a bare theme name used to be.
  const key = storageKey === undefined || storageKey === legacyThemeStorageKey ? prefsStorageKey : storageKey;
  const appDefaults = useMemo<Partial<Prefs>>(
    () => ({ ...(defaultTheme ? themeSettingToPrefs(defaultTheme) : {}), ...sanitisePrefs(defaults) }),
    // A caller passing an object literal gets a new one every render; the
    // contents are what matter.
    [defaultTheme, JSON.stringify(defaults ?? {})],
  );

  const [state, setState] = useState<State>({
    stored: {},
    media: { dark: false, moreContrast: false },
    os: 'other',
    ready: false,
  });
  // The latest state, for `setPrefs`: two calls in one event handler must
  // both land, and the second cannot wait for the render between them.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const prefs = useMemo(() => normalisePrefs(state.stored, appDefaults), [state.stored, appDefaults]);

  // Read this browser: storage, the device's settings, the platform.
  useEffect(() => {
    installAnnouncer(document);
    setState({ stored: readStoredPrefs(storage(), key), media: readMedia(), os: detectOs(navigator), ready: true });
  }, [key]);

  // Follow the device while a preference is on "system", and another tab's changes.
  useEffect(() => {
    const lists = [query(COLOR_SCHEME_DARK), query(CONTRAST_MORE)].filter((list): list is MediaQueryList => list !== null);
    const onMedia = (): void => setState((current) => ({ ...current, media: readMedia() }));
    for (const list of lists) list.addEventListener?.('change', onMedia);
    const onStorage = (event: StorageEvent): void => {
      // A null key is `localStorage.clear()` in the other tab.
      if (event.key !== key && event.key !== null) return;
      setState((current) => ({ ...current, stored: readStoredPrefs(storage(), key) }));
    };
    window.addEventListener('storage', onStorage);
    return () => {
      for (const list of lists) list.removeEventListener?.('change', onMedia);
      window.removeEventListener('storage', onStorage);
    };
  }, [key]);

  // Keep `<html>` in step with the state.
  useEffect(() => {
    if (!state.ready) return;
    applyAttributes(preferenceAttributes(prefs, { media: state.media, os: state.os, app }));
  }, [prefs, state.ready, state.media, state.os, app]);

  const setPrefs = useCallback(
    (patch: Partial<Prefs>) => {
      const current = stateRef.current;
      const stored = { ...current.stored, ...sanitisePrefs(patch) };
      const next = normalisePrefs(stored, appDefaults);
      writeStoredPrefs(storage(), stored, key);
      stateRef.current = { ...current, stored };
      const commit = (): void => setState((latest) => ({ ...latest, stored }));
      // Before the first read there is nothing on `<html>` of ours to change;
      // the read will find what was just stored.
      if (!current.ready) return commit();

      // The attributes and the state change together, in one step: a view
      // transition calls its callback only after it has captured the old
      // state, so nothing may change the theme before that — not even the
      // effect that the state change would otherwise run first.
      const attributes = preferenceAttributes(next, { media: current.media, os: current.os, app });
      const change = (): void => {
        applyAttributes(attributes);
        commit();
      };
      if (attributes['data-itsm-theme'] !== document.documentElement.getAttribute('data-itsm-theme')) withTransition(change, next);
      else change();
    },
    [appDefaults, key, app],
  );

  const setTheme = useCallback((theme: ThemeSetting) => setPrefs(themeSettingToPrefs(theme)), [setPrefs]);

  const value = useMemo<ThemeContextValue>(() => {
    const resolvedTheme = state.ready ? resolveTheme(prefs, state.media) : 'system';
    return {
      prefs,
      setPrefs,
      resolvedTheme,
      os: state.os,
      theme: pinnedTheme(prefs, state.media) === null ? 'system' : resolvedTheme,
      setTheme,
    };
  }, [prefs, setPrefs, setTheme, state.media, state.os, state.ready]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const outsideProvider: ThemeContextValue = {
  prefs: defaultPrefs,
  setPrefs: () => undefined,
  resolvedTheme: 'system',
  os: 'other',
  theme: 'system',
  setTheme: () => undefined,
};

/**
 * The preferences and the theme in force. Never throws: outside a provider it
 * returns the defaults with setters that do nothing, so a component still
 * renders inside a test or a story that has not wrapped it, and the CSS
 * defaults cover the rest.
 */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? outsideProvider;
}

export type { Prefs, ThemeSetting };
