import { css, layer, mq } from '../styles/css.js';

/**
 * `FilterChip`, and the yes/no toggle capsule `FilterBar` draws in the same
 * shape (v3 §2.14 "Active-filter chips", A1 §7.6).
 *
 * A 26 px capsule. Inactive it is quiet: `surface.raised` with a 1 px
 * `border.soft`, 500 12/16 in `text.secondary`, the filter's name and a
 * chevron. Active it is the one tinted thing in the row, because it is the
 * one thing narrowing the list: `surface.accentHover` with an accent edge at
 * 28 % and its value named in semibold; a `danger` chip ("SLA: Breached")
 * takes `danger.subtle` with a danger edge instead. The × is a 20 px round
 * button inside the capsule's end (padding `0 3px 0 10px`), a sibling of the
 * chip button, never inside it. "Clear all" after the chips is a 600 12 link
 * button in `text.link`.
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
  --_chip-bg: var(--itsm-colour-surface-raised);
  --_chip-fg: var(--itsm-colour-text-secondary);
  --_chip-edge: var(--itsm-colour-border-soft);
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  max-inline-size: 100%;
  min-block-size: 1.625rem;
  border: var(--itsm-border-hair) solid var(--_chip-edge);
  border-radius: var(--itsm-radius-pill);
  background-color: var(--_chip-bg);
  color: var(--_chip-fg);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: 0;
  font-weight: var(--itsm-font-weight-medium);
  vertical-align: middle;
}
.itsm-FilterChip[data-active],
.itsm-FilterBar__toggle[aria-pressed="true"] {
  --_chip-bg: var(--itsm-colour-surface-accentHover);
  --_chip-edge: color-mix(in srgb, var(--itsm-colour-accent) 28%, transparent);
}
.itsm-FilterChip[data-active][data-tone="danger"] {
  --_chip-bg: var(--itsm-colour-danger-subtle);
  --_chip-fg: var(--itsm-colour-danger-subtleText);
  --_chip-edge: color-mix(in srgb, var(--itsm-colour-danger-border) 28%, transparent);
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
  min-block-size: calc(1.625rem - 2 * var(--itsm-border-hair));
  padding-block: 0;
  padding-inline: calc(var(--itsm-space-xs) + var(--itsm-space-3xs)) var(--itsm-space-xs);
  border-radius: var(--itsm-radius-pill);
  background-color: transparent;
  white-space: nowrap;
}
.itsm-FilterChip[data-active] .itsm-FilterChip__trigger {
  padding-inline-end: var(--itsm-space-3xs);
}
.itsm-FilterChip__label {
  flex: none;
}
.itsm-FilterChip__value {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--itsm-colour-text-primary);
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-FilterChip[data-tone="danger"] .itsm-FilterChip__value {
  color: inherit;
}
.itsm-FilterChip__chevron {
  flex: none;
  opacity: 0.72;
  transition: transform var(--itsm-duration-fast) var(--itsm-easing-standard);
}
/* An active chip ends in its ×; the chevron goes where there is one. */
.itsm-FilterChip[data-active]:has(.itsm-FilterChip__clear) .itsm-FilterChip__chevron {
  display: none;
}
.itsm-FilterChip__trigger[data-state="open"] .itsm-FilterChip__chevron {
  transform: rotate(180deg);
}

.itsm-FilterChip__clear {
  display: inline-grid;
  place-items: center;
  flex: none;
  inline-size: 1.25rem;
  block-size: 1.25rem;
  margin-inline: var(--itsm-space-3xs) calc(var(--itsm-space-3xs) + 1px);
  padding: 0;
  border-radius: var(--itsm-radius-pill);
  background-color: transparent;
}

/*
 * The toggle is the capsule and the button at once, so the reset above
 * (\`font: inherit\`, there for the chip's inner buttons) would take it back to
 * the page's body size — a yes/no filter set larger than the chips beside it.
 * Its own type and edge come back here, after the reset.
 */
.itsm-FilterBar__toggle {
  gap: var(--itsm-space-2xs);
  padding-block: 0;
  padding-inline: calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
  border: var(--itsm-border-hair) solid var(--_chip-edge);
  white-space: nowrap;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: 0;
  font-weight: var(--itsm-font-weight-medium);
}

/* "Clear all", after the chips: a link-coloured button, not a fourth chip. */
.itsm-FilterBar__clearAll {
  color: var(--itsm-colour-text-link);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-semibold);
}

:is(.itsm-FilterChip__trigger, .itsm-FilterChip__clear, .itsm-FilterBar__toggle):hover {
  background-image: linear-gradient(var(--itsm-colour-fill-hover), var(--itsm-colour-fill-hover));
}
:is(.itsm-FilterChip__trigger, .itsm-FilterChip__clear, .itsm-FilterBar__toggle):active,
.itsm-FilterChip__trigger[data-state="open"] {
  background-image: linear-gradient(var(--itsm-colour-fill-pressed), var(--itsm-colour-fill-pressed));
}

.itsm-FilterChip:not([data-active]):hover,
.itsm-FilterBar__toggle:not([aria-pressed="true"]):hover {
  --_chip-edge: var(--itsm-colour-border-interactive);
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
