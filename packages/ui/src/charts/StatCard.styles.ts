import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `StatCard` (and the deprecated `Metric`, which draws one).
 *
 * A card in the resting elevation, radius `2xl`: the label in `subheadline`
 * secondary, the value in `statValue` — 32/36, stepping up to 40 once the
 * card itself is wide (a container query, not the viewport) — with
 * proportional figures, because a big standalone number looks loose in
 * tabular ones. The delta chip is a pill tinted by whether the change is
 * good, with its arrow and sign; the period after it in muted text; the
 * sparkline at the end of the same row, wrapping under it in a narrow card.
 *
 * A linked card is one target: the label's link is stretched over the card,
 * the card lifts on hover (`accentHover`, elevation `md`, 2 px, `normal` /
 * `entrance`), and the focus ring is drawn around the whole card. Under
 * reduced motion the lift goes and the colour stays.
 *
 * `attention` and `critical` tint the card's edge and add their icon — never
 * colour alone.
 */
export const statCardStyles = layer(
  'components',
  css`
.itsm-StatCard {
  --_itsm-chart-surface: var(--itsm-colour-surface-raised);
  container: itsm-stat / inline-size;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-2xs);
  min-inline-size: 9rem;
  padding: var(--itsm-space-md);
  border-radius: var(--itsm-radius-2xl);
  background: var(--itsm-colour-surface-raised);
  box-shadow: var(--itsm-elevation-xs), var(--itsm-edge-highlight);
  color: var(--itsm-colour-text-primary);
  transition:
    background-color var(--itsm-duration-normal) var(--itsm-easing-entrance),
    box-shadow var(--itsm-duration-normal) var(--itsm-easing-entrance),
    transform var(--itsm-duration-normal) var(--itsm-easing-entrance);
}

@supports (corner-shape: squircle) {
  .itsm-StatCard:not([data-interactive]) {
    corner-shape: squircle;
  }
}

.itsm-StatCard[data-surface="sunken"] {
  --_itsm-chart-surface: var(--itsm-colour-surface-sunken);
  background: var(--itsm-colour-surface-sunken);
  box-shadow: none;
}

.itsm-StatCard[data-status="attention"] {
  box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-warning-border), var(--itsm-elevation-xs);
}

.itsm-StatCard[data-status="critical"] {
  box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-danger-border), var(--itsm-elevation-xs);
}

.itsm-StatCard__head {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
}

.itsm-StatCard__icon {
  flex: none;
  color: var(--itsm-colour-text-muted);
}

.itsm-StatCard__label {
  flex: 1 1 auto;
  min-inline-size: 0;
  margin: 0;
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  color: var(--itsm-colour-text-secondary);
  overflow-wrap: anywhere;
}

.itsm-StatCard__status {
  flex: none;
}

.itsm-StatCard[data-status="attention"] .itsm-StatCard__status { color: var(--itsm-colour-warning-subtleText); }
.itsm-StatCard[data-status="critical"] .itsm-StatCard__status { color: var(--itsm-colour-danger-subtleText); }

/* The stretched link: its hit area and its focus ring are the whole card. */
.itsm-StatCard__link {
  color: inherit;
  text-decoration: none;
}

.itsm-StatCard__link::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: var(--itsm-radius-2xl);
}

.itsm-StatCard__link:focus-visible {
  outline: none;
  box-shadow: none;
}

.itsm-StatCard__link:focus-visible::after {
  outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus);
  outline-offset: var(--itsm-focus-offset);
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap);
}

@media (hover: hover) {
  .itsm-StatCard[data-interactive]:hover {
    background: var(--itsm-colour-surface-accentHover);
    box-shadow: var(--itsm-elevation-md), var(--itsm-edge-highlight);
    transform: translateY(calc(-1 * var(--itsm-lift-sm)));
  }
  .itsm-StatCard[data-interactive]:hover .itsm-StatCard__label {
    color: var(--itsm-colour-text-primary);
  }
}

.itsm-StatCard[data-interactive]:active {
  transform: none;
  box-shadow: var(--itsm-elevation-xs), var(--itsm-edge-highlight);
}

.itsm-StatCard__value {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: var(--itsm-space-2xs);
  margin: var(--itsm-space-2xs) 0 0;
  font-size: var(--itsm-text-statValue-size);
  line-height: var(--itsm-text-statValue-line);
  font-weight: var(--itsm-text-statValue-weight);
  letter-spacing: var(--itsm-text-statValue-tracking);
  color: var(--itsm-colour-text-primary);
}

.itsm-StatCard__number {
  white-space: nowrap;
}

.itsm-StatCard__unit {
  font-size: var(--itsm-text-headline-size);
  font-weight: var(--itsm-font-weight-medium);
  letter-spacing: var(--itsm-text-headline-tracking);
  color: var(--itsm-colour-text-secondary);
}

.itsm-StatCard__secondary {
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-regular);
  letter-spacing: var(--itsm-text-callout-tracking);
  color: var(--itsm-colour-text-secondary);
}

@container itsm-stat (min-width: 15rem) {
  .itsm-StatCard__value {
    font-size: var(--itsm-font-size-5xl);
    line-height: calc(var(--itsm-text-statValue-line) + var(--itsm-space-xs));
  }
}

.itsm-StatCard__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
  margin-block-start: var(--itsm-space-2xs);
}

.itsm-StatCard__delta {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-2xs) var(--itsm-space-xs);
  min-inline-size: 0;
  margin: 0;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
}

.itsm-StatCard__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-3xs);
  padding: var(--itsm-space-3xs) var(--itsm-space-xs) var(--itsm-space-3xs) var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-neutral-subtle);
  font-weight: var(--itsm-font-weight-medium);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-neutral-subtleText);
  white-space: nowrap;
}

.itsm-StatCard__delta[data-sentiment="good"] .itsm-StatCard__chip {
  background: var(--itsm-colour-success-subtle);
  color: var(--itsm-colour-success-subtleText);
}

.itsm-StatCard__delta[data-sentiment="bad"] .itsm-StatCard__chip {
  background: var(--itsm-colour-danger-subtle);
  color: var(--itsm-colour-danger-subtleText);
}

.itsm-StatCard__period {
  white-space: nowrap;
}

.itsm-StatCard__trend {
  margin-inline-start: auto;
}

.itsm-StatCard__footnote {
  margin: var(--itsm-space-2xs) 0 0;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
}

.itsm-StatCard__footnote[data-tone="good"] { color: var(--itsm-colour-success-subtleText); }
.itsm-StatCard__footnote[data-tone="bad"] { color: var(--itsm-colour-danger-subtleText); }

.itsm-StatCard__loading {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
  margin-block-start: var(--itsm-space-2xs);
}

.itsm-StatCard__problem {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-2xs) var(--itsm-space-xs);
  margin-block-start: var(--itsm-space-2xs);
}

.itsm-StatCard__problemText {
  display: inline-flex;
  align-items: flex-start;
  gap: var(--itsm-space-2xs);
  margin: 0;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  color: var(--itsm-colour-text-secondary);
}

.itsm-StatCard__problemIcon {
  flex: none;
  margin-block-start: var(--itsm-space-3xs);
  color: var(--itsm-colour-danger-subtleText);
}

/* Above the stretched link, so it takes its own clicks. */
.itsm-StatCard__retry {
  position: relative;
  z-index: 1;
}

${moreContrast(
  (scope) => `${scope} .itsm-StatCard__chip { box-shadow: inset 0 0 0 var(--itsm-hairline) currentColor; }
${scope} .itsm-StatCard[data-status="attention"],
${scope} .itsm-StatCard[data-status="critical"] { outline: var(--itsm-border-thick) solid; outline-offset: calc(-1 * var(--itsm-border-thick)); }
${scope} .itsm-StatCard[data-status="attention"] { outline-color: var(--itsm-colour-warning-border); }
${scope} .itsm-StatCard[data-status="critical"] { outline-color: var(--itsm-colour-danger-border); }`,
)}

${mq.reducedMotion} {
  .itsm-StatCard {
    transition: none;
  }
  .itsm-StatCard[data-interactive]:hover {
    transform: none;
  }
}

${prefers.reducedMotion} .itsm-StatCard {
  transition: none;
}

${prefers.reducedMotion} .itsm-StatCard[data-interactive]:hover {
  transform: none;
}

${mq.forcedColors} {
  .itsm-StatCard {
    border: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-StatCard__chip {
    border: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-StatCard__link:focus-visible::after {
    outline-color: Highlight;
  }
}
`,
);
