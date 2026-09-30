import { css, layer, mq } from '../styles/css.js';
import { moreContrast } from './tone.js';

/**
 * `Surface`: the fill, corner, padding and depth every card-like thing shares.
 * `Card` renders with this class too, so a card and a plain surface of the
 * same settings are the same object.
 *
 * The shadow is assembled from two component-local layers — the elevation and
 * the edge — so the settings compose instead of overwriting each other: a
 * raised surface always keeps the dark theme's one-pixel top highlight (SPEC
 * §1.2 `edgeHighlight`, transparent in the other themes) whatever its
 * elevation, and an outline surface keeps its hairline. `none` is not a value
 * that can sit in a shadow list, so "no elevation" is a transparent layer.
 *
 * `lg` padding is 24 px on a wide screen and eases to 16 on a phone, where
 * 24 either side of a card is a sixth of the width.
 *
 * In the high-contrast themes the elevation tokens are already an outline in
 * `border.strong`; a raised surface with no elevation gets the same hairline
 * so white-on-white never hides where it starts. In forced colours shadows
 * are dropped by the browser, so the surface draws a system-colour outline.
 */
export const surfaceStyles = layer(
  'components',
  css`
.itsm-Surface {
  --_itsm-surface-elevation: 0 0 0 0 transparent;
  --_itsm-surface-edge: 0 0 0 0 transparent;
  box-sizing: border-box;
  min-inline-size: 0;
  color: var(--itsm-colour-text-primary);
  box-shadow: var(--_itsm-surface-elevation), var(--_itsm-surface-edge);
}

.itsm-Surface[data-tone="raised"] {
  --_itsm-surface-edge: var(--itsm-edge-highlight);
  background: var(--itsm-colour-surface-raised);
}

.itsm-Surface[data-tone="sunken"] {
  background: var(--itsm-colour-surface-sunken);
}

.itsm-Surface[data-tone="outline"] {
  --_itsm-surface-edge: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-border-subtle);
  background: transparent;
}

.itsm-Surface[data-elevation="xs"] { --_itsm-surface-elevation: var(--itsm-elevation-xs); }
.itsm-Surface[data-elevation="sm"] { --_itsm-surface-elevation: var(--itsm-elevation-sm); }
.itsm-Surface[data-elevation="md"] { --_itsm-surface-elevation: var(--itsm-elevation-md); }

.itsm-Surface[data-radius="lg"] { border-radius: var(--itsm-radius-lg); }
.itsm-Surface[data-radius="xl"] { border-radius: var(--itsm-radius-xl); }
.itsm-Surface[data-radius="2xl"] { border-radius: var(--itsm-radius-2xl); }
.itsm-Surface[data-radius="3xl"] { border-radius: var(--itsm-radius-3xl); }

.itsm-Surface[data-padding="none"] { padding: 0; }
.itsm-Surface[data-padding="sm"] { padding: var(--itsm-space-sm); }
.itsm-Surface[data-padding="md"] { padding: var(--itsm-space-md); }
.itsm-Surface[data-padding="lg"] { padding: clamp(var(--itsm-space-md), 5vw, var(--itsm-space-lg)); }

${moreContrast(
  (scope) => `${scope} .itsm-Surface[data-tone="raised"][data-elevation="none"] {
  --_itsm-surface-edge: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-border-strong);
}`,
)}

${mq.forcedColors} {
  .itsm-Surface:not([data-tone="sunken"]) {
    outline: var(--itsm-hairline) solid CanvasText;
    outline-offset: calc(-1 * var(--itsm-hairline));
  }
}
`,
);
