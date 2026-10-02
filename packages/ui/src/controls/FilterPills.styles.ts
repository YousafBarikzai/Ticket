import { moreContrast, toneRules } from '../feedback/tone.js';
import { css, layer, mq } from '../styles/css.js';

/**
 * `FilterPills` (v3 §2.14, A1 §7.6, PMO §9.10).
 *
 * - **Pill:** 28 px (26 at `sm`), fully rounded, a 1 px `border.soft` edge on
 *   `surface.raised`, 500 13/18 in `text.secondary`; under the pointer the
 *   edge firms to `border.interactive` on `surface.raisedAlt`.
 * - **On** (current, pressed or checked): `brand.subtle` with an accent edge
 *   at 28 % and `brand.subtleText` at 600; its count turns `surface.raised`
 *   with `brand.subtleText`. The label reserves its bold width, so turning a
 *   pill on never nudges the row.
 * - **Tone:** a 14 px icon before the label in the tone's `subtleText`.
 * - **Row:** wraps, 6 px apart, and never scrolls sideways (v2 X-94's
 *   spirit: a filter scrolled out of sight is a filter nobody sees); the
 *   summary follows in 12/16 `text.muted`.
 * - **Phones:** at most two lines (the component measures and parks the rest
 *   behind "More"). A parked pill leaves the flow and the accessibility tree
 *   (`visibility: hidden`) but keeps its size, so the row can be re-planned
 *   from real widths when it is resized.
 *
 * Asking for more contrast turns the on pill's edge the full accent, because
 * a 28 % tint edge is exactly what such a person cannot see; forced colours
 * draw the on pill in `Highlight`.
 */
export const filterPillsStyles = layer(
  'components',
  css`
.itsm-FilterPills {
  --_h: var(--itsm-control-height-sm);
  --_gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--_gap) var(--itsm-space-sm);
  min-inline-size: 0;
}

.itsm-FilterPills[data-size="sm"] {
  --_h: calc(var(--itsm-control-height-sm) - var(--itsm-space-3xs));
}

.itsm-FilterPills__group {
  flex: 0 1 auto;
  min-inline-size: 0;
}

.itsm-FilterPills__list {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--_gap);
  margin: 0;
  padding: 0;
  list-style: none;
}

li.itsm-FilterPills__item {
  display: flex;
  flex: none;
}

/* Behind "More": out of the flow and out of sight, still measurable. */
.itsm-FilterPills__item[data-overflow] {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  visibility: hidden;
  pointer-events: none;
}

.itsm-FilterPills__pill {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--_gap);
  box-sizing: border-box;
  min-block-size: var(--_h);
  margin: 0;
  padding-block: 0;
  padding-inline: calc(var(--itsm-space-sm) - var(--itsm-border-hair));
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-soft);
  border-radius: var(--itsm-radius-pill);
  background-color: var(--itsm-colour-surface-raised);
  color: var(--itsm-colour-text-secondary);
  font-family: inherit;
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  font-weight: var(--itsm-font-weight-medium);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-FilterPills[data-size="sm"] .itsm-FilterPills__pill {
  padding-inline: calc(var(--itsm-space-xs) + var(--itsm-space-3xs) - var(--itsm-border-hair));
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
}

.itsm-FilterPills__pill:hover:not([data-on]):not([aria-disabled="true"]) {
  border-color: var(--itsm-colour-border-interactive);
  background-color: var(--itsm-colour-surface-raisedAlt);
}

.itsm-FilterPills__pill[data-on] {
  border-color: color-mix(in srgb, var(--itsm-colour-accent) 28%, transparent);
  background-color: var(--itsm-colour-brand-subtle);
  color: var(--itsm-colour-brand-subtleText);
  font-weight: var(--itsm-font-weight-semibold);
}

/* A count inside an on pill: the raised surface, in the pill's own text colour. */
.itsm-FilterPills__pill[data-on] .itsm-Count {
  --_itsm-count-bg: var(--itsm-colour-surface-raised);
  --_itsm-count-text: var(--itsm-colour-brand-subtleText);
}

.itsm-FilterPills__pill[aria-disabled="true"] {
  border-color: var(--itsm-colour-border-subtle);
  color: var(--itsm-colour-text-disabled);
  cursor: not-allowed;
}

.itsm-FilterPills__label {
  display: inline-flex;
  flex-direction: column;
}
.itsm-FilterPills__label[data-text]::after {
  content: attr(data-text);
  block-size: 0;
  overflow: hidden;
  visibility: hidden;
  font-weight: var(--itsm-font-weight-semibold);
  user-select: none;
  pointer-events: none;
}

.itsm-FilterPills__icon,
.itsm-FilterPills__count,
.itsm-FilterPills__chevron {
  flex: none;
}

${toneRules('.itsm-FilterPills__pill')}

.itsm-FilterPills__pill[data-tone] .itsm-FilterPills__icon {
  color: var(--_itsm-tone-text);
}
.itsm-FilterPills__pill[aria-disabled="true"] .itsm-FilterPills__icon {
  color: inherit;
}

.itsm-FilterPills__chevron {
  color: var(--itsm-colour-text-muted);
  transition: transform var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-FilterPills__more[aria-expanded="true"] .itsm-FilterPills__chevron {
  transform: scaleY(-1);
}

.itsm-FilterPills__summary {
  flex: none;
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-variant-numeric: tabular-nums;
}

${moreContrast((scope) => `${scope} .itsm-FilterPills__pill[data-on] { border-color: var(--itsm-colour-accent); }`)}

${mq.forcedColors} {
  .itsm-FilterPills__pill {
    border-color: ButtonText;
  }
  .itsm-FilterPills__pill[data-on] {
    forced-color-adjust: none;
    border-color: Highlight;
    background-color: Highlight;
    color: HighlightText;
  }
  .itsm-FilterPills__pill[aria-disabled="true"] {
    border-color: GrayText;
    color: GrayText;
  }
}
`,
);
