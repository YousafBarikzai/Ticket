import { iconSize } from '../tokens/tokens.js';
import { css, layer } from '../styles/css.js';

/**
 * `Icon`: sized from the icon tokens in `rem`, so an icon keeps pace with the
 * text beside it when a person enlarges their default font; stroked in the
 * text colour (`currentColor`), which is also what forced-colours mode
 * replaces, so icons follow the system palette with no rule of their own.
 *
 * Directional icons (arrows, chevrons, reply) mirror in right-to-left text.
 * Two rules rather than one selector list, because a browser that does not
 * know `:dir()` would discard the whole list, attribute form included.
 */
const sizes = Object.keys(iconSize)
  .map(
    (token) => `.itsm-Icon[data-size="${token}"] {
  inline-size: var(--itsm-icon-${token});
  block-size: var(--itsm-icon-${token});
}`,
  )
  .join('\n\n');

export const iconStyles = layer(
  'components',
  css`
.itsm-Icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
  overflow: visible;
}

${sizes}

:where([dir="rtl"]) .itsm-Icon[data-directional] {
  transform: scaleX(-1);
}

.itsm-Icon[data-directional]:dir(rtl) {
  transform: scaleX(-1);
}
`,
);
