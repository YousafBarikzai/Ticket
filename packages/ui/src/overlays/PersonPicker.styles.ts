import { css, layer } from '../styles/css.js';

/**
 * `PersonPicker`: a `Combobox` (web/Combobox styles) whose options lead with
 * a 24 px avatar. The avatar sits on the option's first line, aligned with
 * the name rather than centred on the two lines, so a list of people reads
 * down one edge of faces.
 */
export const personPickerStyles = layer(
  'components',
  css`
.itsm-Combobox__option .itsm-Avatar.itsm-Combobox__lead {
  align-self: flex-start;
  margin-block-start: var(--itsm-space-3xs);
}
`,
);
