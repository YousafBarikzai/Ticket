import { css, layer } from './css.js';

/**
 * The reset: the lowest layer, so anything written anywhere else wins.
 *
 * Deliberately small. It replaces what the old global rule
 * `[class^="itsm-"], [class*=" itsm-"]` did — border-box sizing and the family
 * on controls — without that rule's specificity, and without reaching only
 * the elements that happened to carry a design-system class.
 *
 * Form controls inherit only the font *family* for now. The full `font:
 * inherit` a modern reset uses would also hand every button and field its
 * parent's size, and several of today's components (`IconButton`, the
 * interactive `Card`) rely on the browser's control size. That belongs with
 * the components that set their own size, not with a change meant to leave
 * every pixel where it was. There is no blanket `margin: 0` for the same
 * reason: the applications' pages lean on the browser's heading and paragraph
 * margins, and only `body`'s is removed (in the base layer).
 */
export const resetStyles = layer(
  'reset',
  css`
*,
::before,
::after {
  box-sizing: border-box;
}

:where(button, input, select, textarea) {
  font-family: inherit;
}
`,
);
