import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `TabNav`, and the count badge every navigation part shares (`NavBadge`).
 *
 * Route tabs sit on a hairline; each is `callout` 500 in `text.secondary`,
 * the current one `text.primary` 600 — its label reserves the bold width so
 * its neighbours never shift. One 2 px accent indicator slides between tabs
 * on the spring (`transform` only); before it has been placed, and without
 * script, the current tab draws its own underline, so nothing slides in on
 * load. Reduced motion: it simply moves. The row scrolls sideways on narrow
 * screens with its scrollbar hidden.
 *
 * `NavBadge`: a capsule of `footnote` 600 tabular figures — neutral on
 * `fill.secondary`, accent and danger solid with their solid text.
 */
export const tabNavStyles = layer(
  'components',
  css`
.itsm-NavBadge {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-inline-size: var(--itsm-space-ml);
  block-size: var(--itsm-space-ml);
  padding: 0 var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-fill-secondary);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: 1;
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}
.itsm-NavBadge[data-tone="accent"] {
  background: var(--itsm-colour-brand-solid);
  color: var(--itsm-colour-brand-solidText);
}
.itsm-NavBadge[data-tone="danger"] {
  background: var(--itsm-colour-danger-solid);
  color: var(--itsm-colour-danger-solidText);
}

.itsm-TabNav {
  min-inline-size: 0;
  border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}
.itsm-TabNav__track {
  position: relative;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.itsm-TabNav__track::-webkit-scrollbar {
  display: none;
}
.itsm-TabNav__list {
  display: flex;
  gap: var(--itsm-space-lg);
  margin: 0;
  padding: 0;
  list-style: none;
}
.itsm-TabNav__entry {
  display: flex;
  flex: none;
}
.itsm-TabNav__link {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-block-size: var(--itsm-control-height-lg);
  border-radius: var(--itsm-radius-sm);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-medium);
  letter-spacing: var(--itsm-text-callout-tracking);
  text-decoration: none;
  white-space: nowrap;
  transition: color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-TabNav__link:hover {
  color: var(--itsm-colour-text-primary);
}
.itsm-TabNav__link:focus-visible {
  outline-offset: calc(-1 * var(--itsm-focus-width));
  box-shadow: none;
}
.itsm-TabNav__link[aria-current="page"] {
  color: var(--itsm-colour-text-primary);
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-TabNav__label {
  display: inline-grid;
}
.itsm-TabNav__label::after {
  content: attr(data-text);
  grid-area: 1 / 1;
  block-size: 0;
  overflow: hidden;
  visibility: hidden;
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-TabNav__link[aria-current="page"]::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  block-size: var(--itsm-border-thick);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-accent);
}
.itsm-TabNav__track[data-placed] .itsm-TabNav__link[aria-current="page"]::after {
  display: none;
}
.itsm-TabNav__indicator {
  position: absolute;
  inset-block-end: 0;
  left: 0;
  inline-size: 1px;
  block-size: var(--itsm-border-thick);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-accent);
  opacity: 0;
  pointer-events: none;
  transform-origin: 0 0;
  transform: translateX(var(--_indicator-x, 0px)) scaleX(var(--_indicator-w, 0));
}
.itsm-TabNav__track[data-placed] .itsm-TabNav__indicator {
  opacity: 1;
}
.itsm-TabNav__track[data-animate] .itsm-TabNav__indicator {
  transition: transform var(--itsm-duration-normal) var(--itsm-easing-spring);
}

${mq.reducedMotion} {
  .itsm-TabNav__track[data-animate] .itsm-TabNav__indicator {
    transition: none;
  }
}
${prefers.reducedMotion} .itsm-TabNav__track[data-animate] .itsm-TabNav__indicator {
  transition: none;
}

${mq.forcedColors} {
  .itsm-TabNav__indicator,
  .itsm-TabNav__link[aria-current="page"]::after {
    background: Highlight;
  }
  .itsm-NavBadge {
    border: var(--itsm-hairline) solid CanvasText;
  }
}
`,
);
