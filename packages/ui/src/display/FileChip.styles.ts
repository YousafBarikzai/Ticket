import { css, layer, mq } from '../styles/css.js';

/**
 * `FileChip`: a compact, hairline-framed chip on the raised surface — the
 * file glyph in a small sunken square, the name in `callout` 500 and the
 * size and state in `footnote`, muted.
 *
 * The name's base truncates and its extension does not, so two long names
 * that differ only in type stay distinguishable. A chip that opens is a
 * single link filling the chip: it takes the row hover (`surface.hover`, an
 * audited background for the text on it) and the base layer's focus ring
 * following the chip's corners. The remove button is a round ghost control
 * beside it, 28 px — 40 px on a touch screen.
 *
 * A blocked file turns its glyph and state words to the danger pair, so the
 * refusal is readable without the colour.
 */
export const fileChipStyles = layer(
  'components',
  css`
.itsm-FileChip {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  max-inline-size: min(100%, 20rem);
  border-radius: var(--itsm-radius-lg);
  background: var(--itsm-colour-surface-raised);
  box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-border-subtle);
  color: var(--itsm-colour-text-primary);
  vertical-align: middle;
}

.itsm-FileChip__main {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  min-inline-size: 0;
  min-block-size: 2.5rem;
  padding: var(--itsm-space-2xs) var(--itsm-space-sm) var(--itsm-space-2xs) var(--itsm-space-2xs);
  border-radius: inherit;
  color: inherit;
  text-decoration: none;
}

a.itsm-FileChip__main {
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

a.itsm-FileChip__main:hover,
a.itsm-FileChip__main:active {
  background: var(--itsm-colour-surface-hover);
}

.itsm-FileChip__icon {
  display: grid;
  place-items: center;
  flex: none;
  inline-size: 1.75rem;
  block-size: 1.75rem;
  border-radius: var(--itsm-radius-md);
  background: var(--itsm-colour-surface-sunken);
  color: var(--itsm-colour-text-secondary);
}

.itsm-FileChip[data-state="blocked"] .itsm-FileChip__icon {
  background: var(--itsm-colour-danger-subtle);
  color: var(--itsm-colour-danger-subtleText);
}

.itsm-FileChip__text {
  display: grid;
  min-inline-size: 0;
}

.itsm-FileChip__name {
  display: flex;
  min-inline-size: 0;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  font-weight: var(--itsm-font-weight-medium);
}

.itsm-FileChip__base {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itsm-FileChip__extension {
  flex: none;
  white-space: nowrap;
}

.itsm-FileChip__meta {
  overflow: hidden;
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itsm-FileChip[data-state="blocked"] .itsm-FileChip__meta {
  color: var(--itsm-colour-danger-subtleText);
}

.itsm-FileChip__remove {
  display: grid;
  place-items: center;
  flex: none;
  inline-size: 1.75rem;
  block-size: 1.75rem;
  margin-inline-end: var(--itsm-space-2xs);
  padding: 0;
  border: 0;
  border-radius: var(--itsm-radius-pill);
  background: transparent;
  color: var(--itsm-colour-text-muted);
  cursor: pointer;
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-FileChip__remove:hover {
  background: var(--itsm-colour-fill-hover);
  color: var(--itsm-colour-text-secondary);
}

.itsm-FileChip__remove:active {
  background: var(--itsm-colour-fill-pressed);
}

${mq.coarse} {
  .itsm-FileChip__remove {
    inline-size: 2.5rem;
    block-size: 2.5rem;
    margin-inline-end: 0;
  }
}

${mq.forcedColors} {
  .itsm-FileChip {
    border: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-FileChip__remove {
    color: ButtonText;
  }
}
`,
);
