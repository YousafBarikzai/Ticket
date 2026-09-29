/**
 * Where the stylesheet used to live, kept as a re-export so existing imports
 * (`ThemeProvider`, the tests, `web/index.ts`) keep working. The sheet is now
 * built from one `*.styles.ts` module per component, in `styles/`.
 */
export { componentStylesheet, uiStylesheet, uiStylesheetVersion } from '../styles/index.js';
