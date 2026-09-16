'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { installAnnouncer } from '../a11y/announcer.js';
import { themeAttribute } from '../tokens/css.js';
import { uiStylesheet } from './stylesheet.js';
import type { ThemeName } from '../tokens/tokens.js';

/**
 * Theme context and stylesheet installation.
 *
 * `system` is the default because the operating system already knows whether
 * the user wants dark or high contrast; a profile setting overrides it, and the
 * override is what `data-itsm-theme` expresses.
 */
export type ThemeSetting = ThemeName | 'system';

export interface ThemeContextValue {
  readonly theme: ThemeSetting;
  setTheme: (theme: ThemeSetting) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STYLE_ELEMENT_ID = 'itsm-ui-styles';

function installStylesheet(doc: Document): void {
  if (doc.getElementById(STYLE_ELEMENT_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = uiStylesheet();
  // Prepended so that application styles, which load later, win ties without
  // needing `!important`.
  doc.head.prepend(style);
}

export interface ThemeProviderProps {
  readonly children: ReactNode;
  readonly defaultTheme?: ThemeSetting;
  /** Set false where the app emits `uiStylesheet()` itself (SSR without a flash of unstyled content). */
  readonly injectStyles?: boolean;
}

export function ThemeProvider({ children, defaultTheme = 'system', injectStyles = true }: ThemeProviderProps): ReactNode {
  const [theme, setThemeState] = useState<ThemeSetting>(defaultTheme);

  useEffect(() => {
    if (injectStyles) installStylesheet(document);
    installAnnouncer(document);
  }, [injectStyles]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute(themeAttribute);
    else root.setAttribute(themeAttribute, theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeSetting) => setThemeState(next), []);
  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Returns the current setting. Falls back to `system` rather than throwing:
 * a component must still render inside a Storybook story or a test that has
 * not wrapped it, and the CSS defaults cover that case.
 */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? { theme: 'system', setTheme: () => undefined };
}
