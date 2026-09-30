import { css, layer, mq } from '../styles/css.js';

const hoverOrFocus = '.itsm-Card[data-interactive]:is(:hover, :has(.itsm-Card__link:focus-visible))';

/**
 * `Card`. The fill, radius and depth are `Surface`'s (the card carries its
 * class); this module lays out the header row, body and footer, and adds the
 * navigable card's behaviour.
 *
 * Padding lives on the three parts rather than the card, so a hairline under
 * the header or over the footer runs edge to edge. `lg` (the default) is
 * 24 px, easing to 16 on a phone. The header's icon, meta and actions are
 * centred on the title's first line whatever their height.
 *
 * A navigable card (`href`) is the stretched-link pattern: the title's
 * `::after` covers the card, so the whole card is the target while the
 * heading stays a heading. It moves as SPEC §1.9 says a navigable card does —
 * `accentHover`, elevation `xs` → `md` and a 2 px rise, `normal`/`entrance` —
 * on hover and on keyboard focus alike, and settles back while pressed. The
 * focus ring is drawn on that `::after`, round the whole card and following
 * its corners. Anything interactive inside (the actions, a link in the body)
 * sits above the covering layer and stays separately clickable. Reduced
 * motion zeroes the lift token, so the colour and shadow still change and
 * nothing moves.
 */
export const cardStyles = layer(
  'components',
  css`
.itsm-Card {
  --_itsm-card-pad: clamp(var(--itsm-space-md), 5vw, var(--itsm-space-lg));
  --_itsm-card-radius: var(--itsm-radius-2xl);
  position: relative;
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
  color: var(--itsm-colour-text-primary);
}

.itsm-Card[data-space="none"] { --_itsm-card-pad: 0px; }
.itsm-Card[data-space="sm"] { --_itsm-card-pad: var(--itsm-space-sm); }
.itsm-Card[data-space="md"] { --_itsm-card-pad: var(--itsm-space-md); }

.itsm-Card[data-radius="lg"] { --_itsm-card-radius: var(--itsm-radius-lg); }
.itsm-Card[data-radius="xl"] { --_itsm-card-radius: var(--itsm-radius-xl); }
.itsm-Card[data-radius="3xl"] { --_itsm-card-radius: var(--itsm-radius-3xl); }

.itsm-Card__header {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-sm);
  padding: var(--_itsm-card-pad) var(--_itsm-card-pad) 0;
}

.itsm-Card__header:last-child {
  padding-block-end: var(--_itsm-card-pad);
}

.itsm-Card[data-divider] > .itsm-Card__header {
  padding-block-end: var(--itsm-space-sm);
  border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}

.itsm-Card__icon {
  display: grid;
  place-items: center;
  flex: none;
  inline-size: 2rem;
  block-size: 2rem;
  margin-block: calc((var(--itsm-text-title3-line) - 2rem) / 2);
  border-radius: var(--itsm-radius-md);
  background: var(--itsm-colour-fill-secondary);
  color: var(--itsm-colour-text-secondary);
}

/*
 * The title block and the meta share a wrapping row: the title block asks
 * for 12 rem before anything else, so in a narrow card the meta wraps under
 * the subtitle instead of pressing the title into broken words. The actions
 * are outside this row and stay on the title's line.
 */
.itsm-Card__heading {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: flex-start;
  column-gap: var(--itsm-space-sm);
  row-gap: var(--itsm-space-3xs);
  min-inline-size: 0;
}

.itsm-Card__titles {
  display: grid;
  flex: 1 1 12rem;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
}

.itsm-Card__title {
  margin: 0;
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-title3-size);
  line-height: var(--itsm-text-title3-line);
  letter-spacing: var(--itsm-text-title3-tracking);
  font-weight: var(--itsm-text-title3-weight);
  text-wrap: balance;
  overflow-wrap: break-word;
}

h4.itsm-Card__title {
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  letter-spacing: var(--itsm-text-headline-tracking);
}

.itsm-Card__subtitle {
  margin: 0;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  text-wrap: pretty;
}

.itsm-Card__meta {
  flex: none;
  margin-block-start: calc((var(--itsm-text-title3-line) - var(--itsm-text-footnote-line)) / 2);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
  font-variant-numeric: tabular-nums;
}

.itsm-Card__actions {
  position: relative;
  z-index: 1;
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-block-size: var(--itsm-text-title3-line);
  margin-block: calc((var(--itsm-text-title3-line) - max(var(--itsm-text-title3-line), var(--itsm-control-height-sm))) / 2);
}

.itsm-Card__chevron {
  flex: none;
  margin-block-start: calc((var(--itsm-text-title3-line) - var(--itsm-icon-sm)) / 2);
  color: var(--itsm-colour-text-muted);
}

.itsm-Card__body {
  flex: 1;
  min-inline-size: 0;
  padding: var(--_itsm-card-pad, var(--itsm-space-md));
}

.itsm-Card__header + .itsm-Card__body {
  padding-block-start: var(--itsm-space-sm);
}

.itsm-Card[data-divider] > .itsm-Card__header + .itsm-Card__body {
  padding-block-start: var(--_itsm-card-pad);
}

.itsm-Card__skeleton {
  display: block;
}

.itsm-Card__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs);
  padding: var(--itsm-space-sm) var(--_itsm-card-pad);
  border-block-start: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}

/* Navigable: the stretched link. */
.itsm-Card[data-interactive] {
  transition:
    background-color var(--itsm-duration-normal) var(--itsm-easing-entrance),
    box-shadow var(--itsm-duration-normal) var(--itsm-easing-entrance),
    transform var(--itsm-duration-normal) var(--itsm-easing-entrance);
}

${hoverOrFocus} {
  --_itsm-surface-elevation: var(--itsm-elevation-md);
  background: var(--itsm-colour-surface-accentHover);
  transform: translateY(calc(-1 * var(--itsm-lift-sm)));
}

.itsm-Card[data-interactive]:active {
  --_itsm-surface-elevation: var(--itsm-elevation-xs);
  transform: none;
}

.itsm-Card__link {
  color: inherit;
  text-decoration: none;
}

.itsm-Card__link::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--_itsm-card-radius);
}

.itsm-Card__link:focus-visible {
  outline: none;
  box-shadow: none;
}

.itsm-Card__link:focus-visible::after {
  outline: var(--itsm-focus-width) solid var(--itsm-colour-accent);
  outline-offset: var(--itsm-focus-offset);
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap);
}

.itsm-Card[data-interactive] :where(.itsm-Card__body, .itsm-Card__footer, .itsm-Card__meta) :where(a, button, input, select, textarea, summary, [tabindex]) {
  position: relative;
  z-index: 1;
}

${mq.forcedColors} {
  .itsm-Card__link:focus-visible::after {
    outline-color: Highlight;
  }
  .itsm-Card[data-interactive]:hover {
    outline: var(--itsm-border-thick) solid Highlight;
  }
}
`,
);
