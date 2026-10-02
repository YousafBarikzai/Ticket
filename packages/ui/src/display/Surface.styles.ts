import { css, layer, mq } from '../styles/css.js';
import { moreContrast } from './tone.js';

/**
 * `Surface`: the fill, edge, corner, padding and depth every card-like thing
 * shares. `Card` renders with this class too, so a card and a plain surface
 * of the same settings are the same object.
 *
 * **Depth is border-first** (v3 §2.9, superseding v2's "depth from
 * elevation"): the light canvas and a raised surface differ by only 1.07:1,
 * so a raised surface draws a 1 px `border.subtle` edge and rests with no
 * shadow; elevation is for what is lifted — a hovered card, a popover. The
 * edge is a real border on every tone (transparent where the tone has none),
 * so switching tone never moves the content by a pixel, and forced colours
 * draw it as a system-colour line with no special case.
 *
 * The shadow is assembled from two component-local layers — the elevation and
 * the edge highlight — so the settings compose instead of overwriting each
 * other: a raised surface keeps the dark theme's one-pixel top highlight
 * (`edgeHighlight`, transparent in the other themes) whatever its elevation.
 * `none` is not a value that can sit in a shadow list, so "no elevation" is
 * a transparent layer.
 *
 * `lg` padding is 24 px on a wide screen and eases to 16 on a phone, where
 * 24 either side of a card is a sixth of the width.
 *
 * In the high-contrast themes a raised surface's edge darkens to
 * `border.strong`, so white-on-white never hides where it starts.
 */
export const surfaceStyles = layer(
  'components',
  css`
.itsm-Surface {
  --_itsm-surface-elevation: 0 0 0 0 transparent;
  --_itsm-surface-edge: 0 0 0 0 transparent;
  box-sizing: border-box;
  min-inline-size: 0;
  border: var(--itsm-border-hair) solid transparent;
  color: var(--itsm-colour-text-primary);
  box-shadow: var(--_itsm-surface-elevation), var(--_itsm-surface-edge);
}

.itsm-Surface[data-tone="raised"] {
  --_itsm-surface-edge: var(--itsm-edge-highlight);
  border-color: var(--itsm-colour-border-subtle);
  background: var(--itsm-colour-surface-raised);
}

.itsm-Surface[data-tone="sunken"] {
  background: var(--itsm-colour-surface-sunken);
}

.itsm-Surface[data-tone="outline"] {
  border-color: var(--itsm-colour-border-subtle);
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
  (scope) => `${scope} .itsm-Surface:is([data-tone="raised"], [data-tone="outline"]) {
  border-color: var(--itsm-colour-border-strong);
}`,
)}

${mq.forcedColors} {
  .itsm-Surface:is([data-tone="raised"], [data-tone="outline"]) {
    border-color: CanvasText;
  }
}
`,
);
