/**
 * Where the theme provider used to live, kept as a re-export so existing
 * imports (`web/index.ts`, the root barrel's deprecated block) keep working.
 * The provider, the preferences model and the pre-paint script are in
 * `theme/`, and applications import them from `@itsm/ui/theme`.
 */
export {
  ThemeProvider,
  useTheme,
  type Prefs,
  type ThemeContextValue,
  type ThemeProviderProps,
  type ThemeSetting,
} from '../theme/ThemeProvider.js';
