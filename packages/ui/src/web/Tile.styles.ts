import { css, layer, mq } from '../styles/css.js';

/** At most `n` tiles to a row, fewer as the container narrows below 14 rem a tile. */
function columns(n: number): string {
  return `.itsm-TileGrid[data-columns="${n}"] {
  grid-template-columns: repeat(auto-fill, minmax(max(min(14rem, 100%), calc((100% - ${n - 1} * var(--itsm-space-md)) / ${n})), 1fr));
}`;
}

/**
 * `Tile` and `TileGrid`.
 *
 * A tile is a raised card at the card radius (`2xl`) whose whole surface is
 * the target. It carries the one gradient the product allows beyond the
 * brand mark (SPEC §1.2): an icon squircle from a lighter blue into the
 * accent, mixed from the theme's own tokens exactly as `BrandMark` mixes it,
 * with a white glyph (black in high-contrast dark, as filled buttons are).
 *
 * Hover and keyboard focus look the same — `accentHover`, elevation `xs` →
 * `md`, a 2 px rise, `normal`/`entrance` (SPEC §1.9) — because somebody on a
 * keyboard is pointing at it too; focus also keeps the base layer's two-tone
 * ring, whose inner half is part of this shadow list. Pressing settles it.
 * Reduced motion zeroes the lift token, so the tint and shadow still answer
 * and nothing moves.
 *
 * In a grid, tiles in a row share a height and the meta line sits at the
 * bottom of each, so a row reads as a set.
 */
export const tileStyles = layer(
  'components',
  css`
.itsm-Tile {
  --_itsm-tile-shadow: var(--itsm-elevation-xs);
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--itsm-space-sm);
  box-sizing: border-box;
  inline-size: 100%;
  min-block-size: var(--itsm-control-height-lg);
  margin: 0;
  padding: var(--itsm-space-ml);
  border: 0;
  border-radius: var(--itsm-radius-2xl);
  background: var(--itsm-colour-surface-raised);
  box-shadow: var(--_itsm-tile-shadow), var(--itsm-edge-highlight);
  color: var(--itsm-colour-text-primary);
  font: inherit;
  text-align: start;
  text-decoration: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    background-color var(--itsm-duration-normal) var(--itsm-easing-entrance),
    box-shadow var(--itsm-duration-normal) var(--itsm-easing-entrance),
    transform var(--itsm-duration-normal) var(--itsm-easing-entrance);
}

.itsm-Tile:hover,
.itsm-Tile:focus-visible {
  --_itsm-tile-shadow: var(--itsm-elevation-md);
  background: var(--itsm-colour-surface-accentHover);
  transform: translateY(calc(-1 * var(--itsm-lift-sm)));
}

.itsm-Tile:focus-visible {
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap), var(--_itsm-tile-shadow), var(--itsm-edge-highlight);
}

.itsm-Tile:active {
  --_itsm-tile-shadow: var(--itsm-elevation-xs);
  transform: none;
}

.itsm-Tile__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--itsm-space-sm);
}

.itsm-Tile__icon {
  display: grid;
  place-items: center;
  flex: none;
  inline-size: 2.5rem;
  block-size: 2.5rem;
  border-radius: 22.5%;
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--itsm-colour-accent) 66%, var(--itsm-colour-brand-solidText)),
    var(--itsm-colour-accent)
  );
  box-shadow: inset 0 0 0 var(--itsm-hairline) color-mix(in srgb, var(--itsm-colour-brand-solidText) 14%, transparent);
  color: var(--itsm-colour-brand-solidText);
  font-size: var(--itsm-text-headline-size);
  line-height: 1;
}

@supports (corner-shape: squircle) {
  .itsm-Tile__icon {
    border-radius: 32%;
    corner-shape: squircle;
  }
}

.itsm-Tile__badge {
  flex: none;
  margin-inline-start: auto;
}

.itsm-Tile__text {
  display: grid;
  gap: var(--itsm-space-2xs);
  min-inline-size: 0;
}

.itsm-Tile__title {
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  letter-spacing: var(--itsm-text-headline-tracking);
  font-weight: var(--itsm-text-headline-weight);
  text-wrap: balance;
  overflow-wrap: break-word;
}

.itsm-Tile__description {
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  text-wrap: pretty;
}

.itsm-Tile__meta {
  margin-block-start: auto;
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
}

.itsm-TileGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(15rem, 100%), 1fr));
  gap: var(--itsm-space-md);
}

${columns(2)}
${columns(3)}
${columns(4)}

${mq.forcedColors} {
  .itsm-Tile {
    border: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-Tile:hover {
    border-color: Highlight;
  }
  .itsm-Tile__icon {
    forced-color-adjust: none;
    background: CanvasText;
    color: Canvas;
  }
}
`,
);
