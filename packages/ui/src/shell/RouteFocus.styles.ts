import { css, layer } from '../styles/css.js';

/**
 * `RouteFocus` moves focus to the page's `<h1 tabindex="-1">` after a
 * navigation. A heading is not a control and cannot be reached with Tab, so
 * a ring around it would be a mark for nothing to act on: it takes focus
 * silently (SPEC §1.10). Zero specificity, so any page that wants a ring can
 * still draw one.
 */
export const routeFocusStyles = layer(
  'components',
  css`
:where(main h1[tabindex="-1"]):focus {
  outline: none;
  box-shadow: none;
}
`,
);
