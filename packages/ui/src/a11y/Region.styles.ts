import { css, layer } from '../styles/css.js';

/**
 * `Region`: where F6 lands when a region has no remembered focus.
 *
 * A pane is as tall as the window and usually clipped by its column, so the
 * base layer's ring — drawn two pixels outside the element — would be cut
 * off or hidden under the next pane. Here it is drawn inside the edge
 * instead, with no gap fill (there is no gap), rounded to the pane's own
 * corners. Only for keyboard arrival (`:focus-visible`); a click into a pane
 * that happens to land on its background draws nothing.
 */
export const regionStyles = layer(
  'components',
  css`
.itsm-Region:focus {
  outline: none;
}

.itsm-Region:focus-visible {
  outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus);
  outline-offset: calc(var(--itsm-focus-width) * -1);
  box-shadow: none;
}
`,
);
