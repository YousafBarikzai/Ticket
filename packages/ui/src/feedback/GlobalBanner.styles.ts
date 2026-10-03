import { css, layer, mq, prefers } from '../styles/css.js';
import { moreContrast, toneRules } from './tone.js';

/**
 * `GlobalBanner`: an edge-to-edge strip in the tone's tint, its content set in
 * from the page gutter so it lines up with the page below it, at least a
 * large control's height (44) tall so its action and close button have room.
 *
 * A 3 px bar in the tone's border colour marks its inline start (v3, A1
 * §7.15), drawn by `::before` so it mirrors in a right-to-left locale and
 * moves nothing; `emphasis="strong"` (a major incident) paints it in the
 * tone's solid colour and the title in the tone's text colour. A hairline of
 * the tone at 40 % along the bottom edge separates the strip from the page
 * without a shadow (it is part of the column, not floating over it); the
 * line is decoration, which is what `color-mix` is allowed for. The kicker is
 * the uppercase `kicker` style in the tone's text colour, one of the five
 * places D6 allows capitals. One that appears while somebody is working
 * (`data-live`) fades in — opacity only, so nothing below it moves twice.
 */
export const globalBannerStyles = layer(
  'components',
  css`
${toneRules('.itsm-GlobalBanner')}

.itsm-GlobalBanner {
  position: relative;
  background: var(--_itsm-tone-subtle);
  color: var(--itsm-colour-text-primary);
  box-shadow: inset 0 calc(var(--itsm-hairline) * -1) 0 color-mix(in srgb, var(--_itsm-tone-border) 40%, transparent);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-medium);
  letter-spacing: var(--itsm-text-callout-tracking);
}

.itsm-GlobalBanner::before {
  content: "";
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  inline-size: 3px;
  background: var(--_itsm-tone-border);
}

.itsm-GlobalBanner[data-emphasis="strong"]::before {
  background: var(--_itsm-tone-solid);
}

.itsm-GlobalBanner[data-emphasis="strong"] .itsm-GlobalBanner__title {
  color: var(--_itsm-tone-text);
}

.itsm-GlobalBanner[data-live] {
  animation: itsm-fade-in var(--itsm-duration-normal) var(--itsm-easing-entrance);
}

.itsm-GlobalBanner__inner {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-sm);
  min-block-size: var(--itsm-control-height-lg);
  padding: var(--itsm-space-xs) var(--itsm-page-gutter);
}

.itsm-GlobalBanner__icon {
  flex: none;
  margin-block: calc((var(--itsm-control-height-sm) - var(--itsm-icon-sm)) / 2);
  color: var(--_itsm-tone-text);
}

.itsm-GlobalBanner__main {
  flex: 1;
  min-inline-size: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-2xs) var(--itsm-space-md);
}

.itsm-GlobalBanner__text {
  flex: 1 1 20rem;
  min-inline-size: 0;
  margin: 0;
  padding-block: calc((var(--itsm-control-height-sm) - var(--itsm-text-callout-line)) / 2);
  overflow-wrap: anywhere;
}

.itsm-GlobalBanner__kicker {
  margin-inline-end: var(--itsm-space-2xs);
  font-family: var(--itsm-text-kicker-family);
  font-size: var(--itsm-text-kicker-size);
  line-height: var(--itsm-text-kicker-line);
  font-weight: var(--itsm-text-kicker-weight);
  letter-spacing: var(--itsm-text-kicker-tracking);
  text-transform: uppercase;
  color: var(--_itsm-tone-text);
}

.itsm-GlobalBanner__title {
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-GlobalBanner__body {
  color: var(--itsm-colour-text-secondary);
}

.itsm-GlobalBanner__actions {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs);
}

.itsm-GlobalBanner__dismiss {
  flex: none;
  display: inline-grid;
  place-items: center;
  inline-size: var(--itsm-control-height-sm);
  block-size: var(--itsm-control-height-sm);
  margin-inline-end: calc(var(--itsm-space-2xs) * -1);
  padding: 0;
  border: 0;
  border-radius: var(--itsm-radius-md);
  background: transparent;
  color: var(--itsm-colour-text-secondary);
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-GlobalBanner__dismiss:hover {
  background: var(--itsm-colour-fill-hover);
  color: var(--itsm-colour-text-primary);
}

.itsm-GlobalBanner__dismiss:active {
  background: var(--itsm-colour-fill-pressed);
}

${mq.reducedMotion} {
  .itsm-GlobalBanner[data-live] {
    animation: none;
  }
}

${prefers.reducedMotion} .itsm-GlobalBanner[data-live] {
  animation: none;
}

${moreContrast((scope) => `${scope} .itsm-GlobalBanner { box-shadow: inset 0 calc(var(--itsm-hairline) * -2) 0 var(--_itsm-tone-border); }`)}

${mq.forcedColors} {
  .itsm-GlobalBanner {
    border-block-end: var(--itsm-hairline) solid CanvasText;
  }

  .itsm-GlobalBanner::before {
    background: CanvasText;
  }

  .itsm-GlobalBanner__dismiss {
    border: var(--itsm-hairline) solid ButtonText;
  }
}
`,
);
