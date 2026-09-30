import { css, layer } from '../styles/css.js';

/**
 * `ViewMenu`: the trigger is a ghost button ("View", the sliders glyph and a
 * chevron); the menu is `Menu`'s. The chevron turns while the menu is open.
 */
export const viewMenuStyles = layer(
  'components',
  css`
.itsm-ViewMenu__trigger .itsm-Button__icon:last-child {
  transition: transform var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-ViewMenu__trigger[data-state="open"] {
  background-image: linear-gradient(var(--itsm-colour-fill-pressed), var(--itsm-colour-fill-pressed));
}
.itsm-ViewMenu__trigger[data-state="open"] .itsm-Button__icon:last-child {
  transform: rotate(180deg);
}
`,
);
