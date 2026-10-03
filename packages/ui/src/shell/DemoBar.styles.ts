import { css, layer, mq } from '../styles/css.js';

/**
 * The demo bar's own parts (v3 §3.8, A2 §9.2–§9.4). The bar's surface — the
 * navy strip, its two-line static phone layout, the sticky desktop line, the
 * busy and warning states and the one rule that publishes the frame offset —
 * is `SystemBar.styles.ts`, and nothing here draws a second one: this module
 * only styles the islands inside it and the popover, the reason and the
 * notice outside it.
 *
 * - **The countdown** is a flex row of the timer icon, "Resets in" and the
 *   time; the bar's status rules already set the time bright and tabular.
 * - **End demo** is the ghost action: no outline, and from 48rem its words
 *   show beside the icon (A2 §9.2: icon only below 768 px), while Reset's
 *   words wait for 64rem like every other bar action.
 * - **On a phone** the session bar's second line is the persona (A2 §9.2,
 *   "Phone line 2"): the reset sentence, which the countdown and the details
 *   already carry, gives way to it.
 * - **Demo details** sit on the ordinary popover surface, in the ordinary
 *   text colours: the popover is not part of the navy strip.
 */
export const demoBarStyles = layer(
  'components',
  css`
.itsm-DemoCountdown,
.itsm-DemoBar__paused {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-inline-size: 0;
}

.itsm-DemoCountdown__lead {
  white-space: nowrap;
}

.itsm-DemoBar__eta {
  white-space: nowrap;
}

.itsm-DemoBar__end {
  border-color: transparent;
}

.itsm-DemoBar__reset[aria-disabled="true"] {
  cursor: default;
}

${mq.belowMd} {
  .itsm-DemoBar[data-variant="session"] .itsm-SystemBar__message,
  .itsm-DemoBar[data-variant="session"] .itsm-SystemBar__separator {
    display: none;
  }
}

${mq.md} {
  .itsm-DemoBar__end .itsm-SystemBar__actionLabel {
    position: static;
    inline-size: auto;
    block-size: auto;
    overflow: visible;
    clip-path: none;
  }
}

/* Demo details: the light popover. */
.itsm-DemoDetails {
  display: grid;
  gap: var(--itsm-space-xs);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}

.itsm-DemoDetails :where(p, ul, h2, h3) {
  margin: 0;
}

.itsm-DemoDetails__heading {
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-caption-size);
  line-height: var(--itsm-text-caption-line);
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-DemoDetails__when {
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-DemoDetails__local {
  color: var(--itsm-colour-text-muted);
  font-weight: var(--itsm-font-weight-regular);
}

.itsm-DemoDetails__countdown {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  color: var(--itsm-colour-text-muted);
}

.itsm-DemoDetails__countdown time {
  color: var(--itsm-colour-text-primary);
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.itsm-DemoDetails__you {
  color: var(--itsm-colour-text-primary);
}

.itsm-DemoDetails__subheading {
  margin-block-start: var(--itsm-space-2xs);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-caption-size);
  line-height: var(--itsm-text-caption-line);
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-DemoDetails__explore {
  display: grid;
  gap: var(--itsm-space-3xs);
  padding: 0;
  list-style: none;
}

.itsm-DemoDetails__row {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-block-size: 2rem;
  padding-inline: var(--itsm-space-xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-primary);
  text-decoration: none;
}

.itsm-DemoDetails__row :where(svg) {
  flex: none;
  color: var(--itsm-colour-text-muted);
}

a.itsm-DemoDetails__row:hover {
  background: var(--itsm-colour-surface-hover);
}

.itsm-DemoDetails__row[data-current] {
  color: var(--itsm-colour-text-secondary);
}

.itsm-DemoDetails__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs) var(--itsm-space-sm);
  margin-block-start: var(--itsm-space-2xs);
}

.itsm-DemoDetails__link {
  color: var(--itsm-colour-text-link);
  font-weight: var(--itsm-font-weight-medium);
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

.itsm-DemoDetails__footer {
  padding-block-start: var(--itsm-space-xs);
  border-block-start: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-caption-size);
  line-height: var(--itsm-text-caption-line);
}

/* The reason Reset is unavailable, in a small popover on the button. */
.itsm-DemoReset__reasonText {
  margin: 0;
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}

/* The notice under the bars: the frame's slot positions it; it keeps to a readable width and floats. */
.itsm-DemoNotice {
  inline-size: min(40rem, 100%);
  box-shadow: var(--itsm-elevation-md);
}
`,
);
