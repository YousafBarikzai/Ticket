/**
 * `@itsm/ui/theme` — display preferences, the pre-paint script and the provider.
 *
 * `themeInitScript` and everything from `prefs.ts` are server-safe: a root
 * layout calls `themeInitScript()` while rendering `<head>`. `ThemeProvider`
 * and `useTheme` are client components; importing them from a server
 * component is fine, calling them is not.
 */
export { themeInitScript, type ThemeInitScriptOptions } from './theme-script.js';
export {
  defaultPrefs,
  detectOs,
  legacyThemeStorageKey,
  migrateLegacyTheme,
  normalisePrefs,
  pinnedTheme,
  preferenceAttributeNames,
  preferenceAttributes,
  prefValues,
  prefsStorageKey,
  readStoredPrefs,
  resolveTheme,
  sanitisePrefs,
  themeSettingToPrefs,
  writeStoredPrefs,
  type AppName,
  type MediaState,
  type OsName,
  type PreferenceAttribute,
  type Prefs,
  type ThemeSetting,
} from './prefs.js';
export { ThemeProvider, useTheme, type ThemeContextValue, type ThemeProviderProps } from './ThemeProvider.js';
