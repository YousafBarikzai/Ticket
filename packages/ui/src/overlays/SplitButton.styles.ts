import { css, layer } from '../styles/css.js';

/**
 * `SplitButton`: two `Button`s drawn as one. The inner corners are square,
 * the outer ones keep the button's radius, and a hairline in the button's
 * own text colour (at low strength, via `color-mix` — decoration, never
 * text) divides them, so the join reads on every variant from primary to
 * ghost. The chevron segment is square: as wide as the button is tall.
 * Each segment keeps its own focus ring, raised above its neighbour so the
 * ring is never clipped by it.
 */
export const splitButtonStyles = layer(
  'components',
  css`
.itsm-SplitButton {
  display: inline-flex;
  align-items: stretch;
  vertical-align: middle;
}
.itsm-SplitButton > .itsm-Button { position: relative; }
.itsm-SplitButton > .itsm-Button:focus-visible { z-index: 1; }
.itsm-SplitButton__main {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
}
.itsm-SplitButton__more {
  inline-size: var(--itsm-control-height-md);
  min-inline-size: var(--itsm-control-height-md);
  padding-inline: 0;
  border-start-start-radius: 0;
  border-end-start-radius: 0;
  border-inline-start: var(--itsm-hairline) solid color-mix(in srgb, currentColor 28%, transparent);
}
.itsm-SplitButton--sm .itsm-SplitButton__more {
  inline-size: var(--itsm-control-height-sm);
  min-inline-size: var(--itsm-control-height-sm);
}
.itsm-SplitButton--lg .itsm-SplitButton__more {
  inline-size: var(--itsm-control-height-lg);
  min-inline-size: var(--itsm-control-height-lg);
}
.itsm-SplitButton__more[data-state="open"] {
  background-image: linear-gradient(var(--itsm-colour-fill-pressed), var(--itsm-colour-fill-pressed));
}
`,
);
