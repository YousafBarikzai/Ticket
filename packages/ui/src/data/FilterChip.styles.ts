import { css, layer, mq } from '../styles/css.js';

/**
 * `FilterChip`, and the yes/no toggle capsule `FilterBar` draws in the same
 * shape.
 *
 * A capsule the height of a small control (28, 24 compact, 40 on touch):
 * inactive it is the quiet `fill.secondary` with the filter's name and a
 * chevron; active it takes `brand.subtle` with `brand.subtleText` — the one
 * tinted thing in the row, because it is the one thing narrowing the list —
 * and names its value in semibold. The × is a round button inside the
 * capsule's end, a sibling of the chip button, never inside it.
 *
 * Hover and press lay `fill.hover`/`fill.pressed` over whichever base, so the
 * text never changes colour under the pointer. The high-contrast themes add
 * a `border.strong` edge, since there a tint alone is not a boundary.
 */
export const filterChipStyles = layer(
  'components',
  css`
.itsm-FilterChip,
.itsm-FilterBar__toggle {
  --_chip-bg: var(--itsm-colour-fill-secondary);
  --_chip-fg: var(--itsm-colour-text-primary);
  display: inline-flex;
  align-items: center;
  max-inline-size: 100%;
  min-block-size: var(--itsm-control-height-sm);
  border-radius: var(--itsm-radius-pill);
  background-color: var(--_chip-bg);
  color: var(--_chip-fg);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  font-weight: var(--itsm-font-weight-medium);
  vertical-align: middle;
}
.itsm-FilterChip[data-active],
.itsm-FilterBar__toggle[aria-pressed="true"] {
  --_chip-bg: var(--itsm-colour-brand-subtle);
  --_chip-fg: var(--itsm-colour-brand-subtleText);
}

.itsm-FilterChip__trigger,
.itsm-FilterChip__clear,
.itsm-FilterBar__toggle {
  margin: 0;
  border: 0;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-FilterChip__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-inline-size: 0;
  max-inline-size: 20rem;
  min-block-size: var(--itsm-control-height-sm);
  padding-block: 0;
  padding-inline: var(--itsm-space-sm) var(--itsm-space-xs);
  border-radius: var(--itsm-radius-pill);
  background-color: transparent;
  white-space: nowrap;
}
.itsm-FilterChip[data-active] .itsm-FilterChip__trigger {
  padding-inline-end: var(--itsm-space-2xs);
}
.itsm-FilterChip__label {
  flex: none;
}
.itsm-FilterChip__value {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-FilterChip__chevron {
  flex: none;
  opacity: 0.72;
  transition: transform var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-FilterChip__trigger[data-state="open"] .itsm-FilterChip__chevron {
  transform: rotate(180deg);
}

.itsm-FilterChip__clear {
  display: inline-grid;
  place-items: center;
  flex: none;
  inline-size: calc(var(--itsm-control-height-sm) - 2 * var(--itsm-space-3xs));
  block-size: calc(var(--itsm-control-height-sm) - 2 * var(--itsm-space-3xs));
  margin-inline-end: var(--itsm-space-3xs);
  padding: 0;
  border-radius: var(--itsm-radius-pill);
  background-color: transparent;
}

/*
 * The toggle is the capsule and the button at once, so the reset above
 * (\`font: inherit\`, there for the chip's inner buttons) would take it back to
 * the page's body size — a yes/no filter set larger than the chips beside it.
 * Its own type comes back here, after the reset.
 */
.itsm-FilterBar__toggle {
  gap: var(--itsm-space-2xs);
  padding-block: 0;
  padding-inline: var(--itsm-space-sm);
  white-space: nowrap;
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  font-weight: var(--itsm-font-weight-medium);
}

:is(.itsm-FilterChip__trigger, .itsm-FilterChip__clear, .itsm-FilterBar__toggle):hover {
  background-image: linear-gradient(var(--itsm-colour-fill-hover), var(--itsm-colour-fill-hover));
}
:is(.itsm-FilterChip__trigger, .itsm-FilterChip__clear, .itsm-FilterBar__toggle):active,
.itsm-FilterChip__trigger[data-state="open"] {
  background-image: linear-gradient(var(--itsm-colour-fill-pressed), var(--itsm-colour-fill-pressed));
}

[data-itsm-theme^="high-contrast"] :is(.itsm-FilterChip, .itsm-FilterBar__toggle) {
  box-shadow: inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-border-strong);
}
@media (prefers-contrast: more) {
  :root:not([data-itsm-theme]) :is(.itsm-FilterChip, .itsm-FilterBar__toggle) {
    box-shadow: inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-border-strong);
  }
}
${mq.reducedMotion} {
  .itsm-FilterChip__chevron {
    transition: none;
  }
}
${mq.forcedColors} {
  .itsm-FilterChip,
  .itsm-FilterBar__toggle {
    border: 1px solid ButtonText;
  }
  .itsm-FilterChip[data-active],
  .itsm-FilterBar__toggle[aria-pressed="true"] {
    border-color: Highlight;
  }
}
`,
);
