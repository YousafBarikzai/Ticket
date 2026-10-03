import { css, layer, mq, prefers } from '../styles/css.js';

// Keyboard focus marks the card anywhere; the pointer only where it can hover
// (`mq.hover`), so a card tapped on a touch screen does not stay marked.
const focused = '.itsm-Card[data-interactive]:has(.itsm-Card__link:focus-visible)';
const hovered = '.itsm-Card[data-interactive]:hover';
const raised = `
  --_itsm-surface-elevation: var(--itsm-elevation-sm);
  border-color: var(--itsm-colour-border-soft);
`;

/**
 * `Card` v3 (v3 §2.13, §2.9; A1 §7.1). The fill, corner and edge are
 * `Surface`'s (the card carries its class); this module lays out the head,
 * headline, body and foot, and adds the navigable card's behaviour.
 *
 * **Border-first.** A card is `surface.raised` with a 1 px `border.subtle`
 * edge and no resting shadow — the canvas and the card differ by 1.07:1, so
 * the edge is what separates them (the stylesheet test greps for it). Radius
 * 12; padding `--itsm-card-padding` (20), and 16 when the card itself is
 * narrower than 35 rem: the card is a container (`itsm-card`), so a card in
 * a narrow column tightens however wide the window is.
 *
 * Padding lives on the parts rather than the card, so the hairline under a
 * divided header runs edge to edge and a `bleed` child can reach the edges
 * with one negative margin. The head is a row — tile, title and ⓘ, meta,
 * actions — with the headline 2 px under the title; the body starts 16 under
 * the head; the foot is 16 under the body, set off by a `border.divider` rule
 * inset to the padding, with the caption at the start and the foot link at
 * the end, its arrow nudging 2 px towards where it goes when motion is
 * allowed.
 *
 * A navigable card (`href`) is the stretched-link pattern: the title's
 * `::after` covers the card, so the whole card is the target while the
 * heading stays a heading. It no longer lifts (v3 §2.9 motion): hover and
 * keyboard focus give it the `border.soft` edge and elevation `sm`, colour
 * and shadow only, at `fast`. The focus ring is drawn on that `::after`,
 * round the whole card. Anything interactive inside — the ⓘ, the actions, a
 * link in the body or the foot — sits above the covering layer.
 */
export const cardStyles = layer(
  'components',
  css`
.itsm-Card {
  --_itsm-card-pad: var(--itsm-card-padding);
  --_itsm-card-radius: var(--itsm-radius-2xl);
  position: relative;
  container: itsm-card / inline-size;
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  color: var(--itsm-colour-text-primary);
}

.itsm-Card[data-space="none"] { --_itsm-card-pad: 0px; }
.itsm-Card[data-space="sm"] { --_itsm-card-pad: var(--itsm-space-sm); }
.itsm-Card[data-space="md"] { --_itsm-card-pad: var(--itsm-space-md); }

.itsm-Card[data-radius="lg"] { --_itsm-card-radius: var(--itsm-radius-lg); }
.itsm-Card[data-radius="xl"] { --_itsm-card-radius: var(--itsm-radius-xl); }
.itsm-Card[data-radius="3xl"] { --_itsm-card-radius: var(--itsm-radius-3xl); }

/* ------------------------------------------------------------- Head */

.itsm-Card__header {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-xs);
  padding: var(--_itsm-card-pad) var(--_itsm-card-pad) 0;
}

.itsm-Card__header:last-child {
  padding-block-end: var(--_itsm-card-pad);
}

.itsm-Card[data-divider] > .itsm-Card__header {
  padding-block-end: var(--itsm-space-sm);
  border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-divider);
}

/* The 28 px tile centred on the title's first line. */
.itsm-Card__icon {
  margin-block: calc((var(--itsm-text-title3-line) - 1.75rem) / 2);
}

/*
 * The title block and the meta share a wrapping row: the title block asks
 * for 12 rem before anything else, so in a narrow card the meta wraps under
 * the title instead of pressing it into broken words. The actions are
 * outside this row and stay on the title's line.
 */
.itsm-Card__heading {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: flex-start;
  column-gap: var(--itsm-space-sm);
  row-gap: var(--itsm-space-3xs);
  min-inline-size: 0;
  min-block-size: 1.75rem;
}

.itsm-Card__titles {
  display: grid;
  flex: 1 1 12rem;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
}

.itsm-Card__titleRow {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-inline-size: 0;
}

.itsm-Card__title {
  min-inline-size: 0;
  margin: 0;
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-text-title3-family);
  font-size: var(--itsm-text-title3-size);
  line-height: var(--itsm-text-title3-line);
  letter-spacing: var(--itsm-text-title3-tracking);
  word-spacing: var(--itsm-text-title3-word-spacing);
  font-weight: var(--itsm-text-title3-weight);
  text-wrap: balance;
  overflow-wrap: break-word;
}

h4.itsm-Card__title {
  font-family: var(--itsm-text-headline-family);
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  letter-spacing: var(--itsm-text-headline-tracking);
  word-spacing: var(--itsm-text-headline-word-spacing);
}

.itsm-Card__info {
  flex: none;
}

.itsm-Card__headline {
  margin: 0;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-medium);
  text-wrap: pretty;
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

/* A trailing ⋯ sits on the padding's edge, so its glyph, not its hit area, lines up with the card's content. */
.itsm-Card__actions > .itsm-IconButton:last-child {
  margin-inline-end: calc(-1 * (var(--itsm-space-2xs) + var(--itsm-space-3xs)));
}

.itsm-Card__chevron {
  flex: none;
  margin-block-start: calc((var(--itsm-text-title3-line) - var(--itsm-icon-sm)) / 2);
  color: var(--itsm-colour-text-muted);
}

/* ------------------------------------------------------------- Body */

.itsm-Card__body {
  flex: 1;
  min-inline-size: 0;
  padding: var(--_itsm-card-pad);
}

.itsm-Card__header + .itsm-Card__body {
  padding-block-start: var(--itsm-space-md);
}

.itsm-Card[data-divider] > .itsm-Card__header + .itsm-Card__body {
  padding-block-start: var(--_itsm-card-pad);
}

.itsm-Card__skeleton {
  display: block;
}

/* A bleeding child (a table, a list) runs to the card's edges and gives up its own frame to the card's. */
.itsm-Card[data-bleed] > .itsm-Card__body > [data-bleed] {
  margin-inline: calc(-1 * var(--_itsm-card-pad));
  border-inline-width: 0;
  border-radius: 0;
  box-shadow: none;
}

.itsm-Card[data-bleed] > .itsm-Card__body:last-child > [data-bleed]:last-child {
  margin-block-end: calc(-1 * var(--_itsm-card-pad));
  border-block-end-width: 0;
  border-end-start-radius: calc(var(--_itsm-card-radius) - var(--itsm-border-hair));
  border-end-end-radius: calc(var(--_itsm-card-radius) - var(--itsm-border-hair));
}

/* ------------------------------------------------------------- Foot */

.itsm-Card__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: var(--itsm-space-sm);
  row-gap: var(--itsm-space-2xs);
  margin-inline: var(--_itsm-card-pad);
  padding-block: var(--itsm-space-sm) var(--_itsm-card-pad);
  border-block-start: var(--itsm-border-hair) solid var(--itsm-colour-border-divider);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}

.itsm-Card__body + .itsm-Card__footer {
  margin-block-start: calc(var(--itsm-space-md) - var(--_itsm-card-pad));
}

.itsm-Card__header + .itsm-Card__footer {
  margin-block-start: var(--itsm-space-md);
}

.itsm-Card__footer:first-child {
  border-block-start: 0;
  padding-block-start: var(--_itsm-card-pad);
}

.itsm-Card__caption {
  margin: 0;
  min-inline-size: 0;
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}

.itsm-Card__footerLink {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  margin-inline-start: auto;
  border-radius: var(--itsm-radius-sm);
  color: var(--itsm-colour-text-link);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-semibold);
  text-decoration: none;
}

.itsm-Card__footerLink:hover {
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

.itsm-Card__footerArrow {
  flex: none;
  transition: translate var(--itsm-duration-fast) var(--itsm-easing-standard);
}

@media (prefers-reduced-motion: no-preference) {
  :root:not([data-itsm-motion="reduced"]) .itsm-Card__footerLink:hover .itsm-Card__footerArrow {
    translate: var(--itsm-space-3xs) 0;
  }

  :root:not([data-itsm-motion="reduced"]) .itsm-Card__footerLink:hover .itsm-Card__footerArrow:dir(rtl) {
    translate: calc(-1 * var(--itsm-space-3xs)) 0;
  }
}

/* ------------------------------------------------------------- Narrow cards */

@container itsm-card (width < 35rem) {
  .itsm-Card[data-space="lg"] > :is(.itsm-Card__header, .itsm-Card__body, .itsm-Card__footer) {
    --_itsm-card-pad: var(--itsm-space-md);
  }
}

/* ------------------------------------------------------------- Navigable: the stretched link */

.itsm-Card[data-interactive] {
  transition:
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard);
}

${focused} {${raised}}
${mq.hover} {
  ${hovered} {${raised}}
}

.itsm-Card[data-interactive]:active {
  --_itsm-surface-elevation: 0 0 0 0 transparent;
}

.itsm-Card__link {
  color: inherit;
  text-decoration: none;
}

.itsm-Card__link::after {
  content: '';
  position: absolute;
  inset: calc(-1 * var(--itsm-border-hair));
  border-radius: var(--_itsm-card-radius);
}

.itsm-Card__link:focus-visible {
  outline: none;
  box-shadow: none;
}

.itsm-Card__link:focus-visible::after {
  outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus);
  outline-offset: var(--itsm-focus-offset);
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap);
}

.itsm-Card[data-interactive] .itsm-Card__info,
.itsm-Card[data-interactive] :where(.itsm-Card__body, .itsm-Card__footer, .itsm-Card__meta) :where(a, button, input, select, textarea, summary, [tabindex]) {
  position: relative;
  z-index: 1;
}

${mq.reducedMotion} {
  .itsm-Card[data-interactive],
  .itsm-Card__footerArrow {
    transition: none;
  }
}

${prefers.reducedMotion} :is(.itsm-Card[data-interactive], .itsm-Card__footerArrow) {
  transition: none;
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
