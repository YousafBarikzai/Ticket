import { css, layer, mq } from '../styles/css.js';
import { moreContrast, toneRules } from './tone.js';

/**
 * `Banner`, and the reason text any feedback action can carry.
 *
 * `inline` (v3, A1 §7.15) is the tone's tint behind primary text, edged by
 * the tone's border at 40 % — the edge is decoration, which is what
 * `color-mix` is allowed for — with the 16 px icon in the tone's own text
 * colour; every pair is audited (§2.11). `subtle` is an opaque sunken well
 * with a hairline, and only the icon in colour, for a notice that should not
 * compete with the content round it. Both take the full tone border where
 * the person asked for more contrast.
 *
 * Radius 12 (`xl`), padding 10 / 12 / 10 / 14, 13/20 text: the title 600 in
 * `text.primary`, the body in `text.secondary`, and an optional kicker over
 * them — 11/16 600 uppercase in the tone's text colour, one of the five
 * places D6 allows capitals (`uppercase-guard.test.ts`).
 *
 * The body sits beside its action on a wide banner and wraps under it on a
 * narrow one — flex wrapping rather than a breakpoint, because a banner's
 * width is its container's, not the window's.
 */
export const bannerStyles = layer(
  'components',
  css`
${toneRules('.itsm-Banner')}

.itsm-Banner {
  display: flex;
  align-items: flex-start;
  gap: calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
  padding: calc(var(--itsm-space-xs) + var(--itsm-space-3xs)) var(--itsm-space-sm) calc(var(--itsm-space-xs) + var(--itsm-space-3xs)) calc(var(--itsm-space-sm) + var(--itsm-space-3xs));
  border: var(--itsm-border-hair) solid color-mix(in srgb, var(--_itsm-tone-border) 40%, transparent);
  border-radius: var(--itsm-radius-xl);
  background: var(--_itsm-tone-subtle);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}

.itsm-Banner[data-variant="subtle"] {
  border-color: var(--itsm-colour-border-subtle);
  background: var(--itsm-colour-surface-sunken);
}

.itsm-Banner__icon {
  flex: none;
  margin-block: calc((var(--itsm-text-callout-line) - var(--itsm-icon-sm)) / 2);
  color: var(--_itsm-tone-text);
}

.itsm-Banner__main {
  flex: 1;
  min-inline-size: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs) var(--itsm-space-md);
}

.itsm-Banner__content {
  flex: 1 1 16rem;
  min-inline-size: 0;
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  overflow-wrap: anywhere;
}

.itsm-Banner__kicker {
  margin: 0;
  font-family: var(--itsm-text-kicker-family);
  font-size: var(--itsm-text-kicker-size);
  line-height: var(--itsm-text-kicker-line);
  font-weight: var(--itsm-text-kicker-weight);
  letter-spacing: var(--itsm-text-kicker-tracking);
  text-transform: uppercase;
  color: var(--_itsm-tone-text);
}

.itsm-Banner__title {
  margin: 0;
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-Banner__body {
  color: var(--itsm-colour-text-secondary);
}

.itsm-Banner__body > :where(p) {
  margin: 0;
}

.itsm-Banner__body > :where(p + p) {
  margin-block-start: var(--itsm-space-2xs);
}

.itsm-Banner__body :where(a:any-link) {
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

.itsm-Banner__actions {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs);
}

.itsm-Banner__dismiss {
  flex: none;
  display: inline-grid;
  place-items: center;
  inline-size: var(--itsm-control-height-sm);
  block-size: var(--itsm-control-height-sm);
  margin-block: calc((var(--itsm-text-callout-line) - var(--itsm-control-height-sm)) / 2);
  margin-inline-end: calc(var(--itsm-space-2xs) * -1);
  padding: 0;
  border: 0;
  border-radius: var(--itsm-radius-md);
  background: transparent;
  color: var(--itsm-colour-text-secondary);
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-Banner__dismiss:hover {
  background: var(--itsm-colour-fill-hover);
  color: var(--itsm-colour-text-primary);
}

.itsm-Banner__dismiss:active {
  background: var(--itsm-colour-fill-pressed);
}

/* The visible reason beside an unavailable action (X-80), for every feedback component's actions row. */
.itsm-FeedbackAction__reason {
  flex-basis: 100%;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
}

${moreContrast((scope) => `${scope} .itsm-Banner { border-color: var(--_itsm-tone-border); }`)}

${mq.forcedColors} {
  .itsm-Banner {
    border-color: CanvasText;
  }

  .itsm-Banner__dismiss {
    border: var(--itsm-hairline) solid ButtonText;
  }
}
`,
);
