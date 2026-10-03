import { css, layer, mq } from '../styles/css.js';
import { moreContrast, toneVariables } from './tone.js';

/**
 * `IconTile`: a glyph on a tinted square (v3 §2.13).
 *
 * The tint and the glyph are one audited pair per tone, read through the
 * component-local `--_itsm-tone-*` names `toneVariables` writes, so a tone
 * added to `Tone` reaches the tile with no edit here. The accent tile is the
 * one exception: `surface.accentHover` under `brand.subtleText` (6.5:1), the
 * lighter blue the PMO uses for its marks, where `brand.subtle` would read as a
 * pressed chip.
 *
 * Sizes 28 and 32 take the control corner (8 px), 36 and 40 the item corner
 * (10 px), so a tile nested in a padded card stays concentric with it. The
 * squircle is static decoration and only where `corner-shape` exists.
 *
 * On a navy hero the tile is the hero's fill with its hairline and the glyph
 * in the hero accent — the sign-in panel's points (v3 §6.3). In the
 * high-contrast themes a tint is not enough to find the tile's edge, so it
 * gains an outline in the tone's border colour; in forced colours the tile
 * is an outlined square and the glyph takes the text colour.
 */
export const iconTileStyles = layer(
  'components',
  css`
${toneVariables('.itsm-IconTile')}

.itsm-IconTile {
  --_itsm-tile-size: 1.75rem;
  --_itsm-tile-fill: var(--_itsm-tone-subtle);
  --_itsm-tile-ink: var(--_itsm-tone-text);
  display: inline-grid;
  place-items: center;
  flex: none;
  box-sizing: border-box;
  inline-size: var(--_itsm-tile-size);
  block-size: var(--_itsm-tile-size);
  border-radius: var(--itsm-radius-lg);
  background: var(--_itsm-tile-fill);
  color: var(--_itsm-tile-ink);
  vertical-align: middle;
}

.itsm-IconTile[data-tone="accent"] {
  --_itsm-tile-fill: var(--itsm-colour-surface-accentHover);
  --_itsm-tile-ink: var(--itsm-colour-brand-subtleText);
}

.itsm-IconTile[data-size="32"] { --_itsm-tile-size: 2rem; }

.itsm-IconTile[data-size="36"] {
  --_itsm-tile-size: 2.25rem;
  border-radius: var(--itsm-radius-item);
}

.itsm-IconTile[data-size="40"] {
  --_itsm-tile-size: 2.5rem;
  border-radius: var(--itsm-radius-item);
}

.itsm-IconTile[data-squircle] {
  corner-shape: squircle;
}

.itsm-IconTile__glyph {
  flex: none;
}

[data-surface="hero"] .itsm-IconTile {
  --_itsm-tile-fill: var(--itsm-colour-hero-fill);
  --_itsm-tile-ink: var(--itsm-colour-hero-accent);
  box-shadow: inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-hero-line);
}

${moreContrast(
  (scope) => `${scope} .itsm-IconTile { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--_itsm-tone-border); }
${scope} .itsm-IconTile[data-tone="accent"] { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-brand-border); }
${scope} [data-surface="hero"] .itsm-IconTile { box-shadow: inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-hero-line); }`,
)}

${mq.forcedColors} {
  .itsm-IconTile {
    border: var(--itsm-border-hair) solid CanvasText;
    color: CanvasText;
  }
}
`,
);
