import { css, layer, mq } from '../styles/css.js';

/**
 * `BrandMark`: the rounded square in the brand gradient.
 *
 * The gradient runs from a lighter blue into the theme's accent at 145°, the
 * lighter stop mixed from the accent and the colour of text on a filled brand
 * button — white in three themes, black in high-contrast dark, where the mark
 * is pale blue with a dark glyph exactly as the filled buttons are. In the
 * light theme that is the SPEC's `#57A8FF → #007AFF`, to within a unit.
 *
 * The corner is a continuous "squircle" where the browser can draw one
 * (`corner-shape`, SPEC §1.5 — a static surface, never focusable), and a
 * plain 22.5 % radius elsewhere, which is what the icon grid of the platform
 * the mark imitates approximates. The glyph takes 60 % of the square.
 *
 * In forced-colours mode it is a solid square in the system's text colour
 * with the glyph in its canvas colour: a logo should stay a recognisable
 * shape, not become an outlined box or a gradient the browser drops, and the
 * system colours are the only ones guaranteed to read in the person's
 * palette. `forced-color-adjust: none` stops the browser repainting it.
 */
export const brandMarkStyles = layer(
  'components',
  css`
.itsm-BrandMark {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  box-sizing: border-box;
  vertical-align: middle;
  border-radius: 22.5%;
  color: var(--itsm-colour-brand-solidText);
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--itsm-colour-accent) 66%, var(--itsm-colour-brand-solidText)),
    var(--itsm-colour-accent)
  );
  box-shadow: inset 0 0 0 var(--itsm-hairline) color-mix(in srgb, var(--itsm-colour-brand-solidText) 14%, transparent);
  forced-color-adjust: none;
}

@supports (corner-shape: squircle) {
  .itsm-BrandMark {
    border-radius: 32%;
    corner-shape: squircle;
  }
}

.itsm-BrandMark__glyph {
  inline-size: 60%;
  block-size: 60%;
  overflow: visible;
}

${mq.forcedColors} {
  .itsm-BrandMark {
    color: Canvas;
    background: CanvasText;
  }
}
`,
);
