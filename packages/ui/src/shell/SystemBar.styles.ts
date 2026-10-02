import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `SystemBar`: the navy strip above the frame (SPEC-v3 §2.15, X-B1).
 *
 * **Phones first, in the flow.** Below 48rem the bar is two lines in a grid —
 * badge, status and 36 px icon actions on the first, the message (then the
 * persona) on the second at 12/16 — and `position: static`, so it scrolls
 * away and a phone keeps only the top bar and the tab bar fixed.
 *
 * **Desktop, sticky.** From 48rem it is one 40 px line, sticky at the top
 * above the top bar (`z-index` systemBar 160 over header 150), and the one
 * rule that gives the frame its offset lives here:
 * `:root:has(.itsm-SystemBar)` publishes the bar's height as
 * `--itsm-system-bar-h`, which every sticky bar below adds to its own `top`.
 * No other rule anywhere declares that variable except the tokens' `0px`
 * default (`system-bar.test.tsx` greps for it). A browser without `:has()`
 * never publishes the height, so there the bar stays in the flow too
 * (`@supports not selector(:has(*))`) rather than covering the top bar.
 *
 * Everything is a navy token: the `--itsm-hero-bar-background` composite, its
 * `hero.line` edge, `hero.text` and its quieter steps, all audited against
 * every glow at full strength (§2.11). The only `color-mix` is the decorative
 * amber behind the warning pill, as §2.15 states it. The badge's halo is the
 * bar glow itself, which high contrast sets to transparent.
 *
 * The live dot pulses on its own `::after` (transform and opacity only),
 * never under reduced motion; the busy line and the warning pill are drawn
 * from `data-state` alone, so an island can switch them on the element.
 */
export const systemBarStyles = layer(
  'components',
  css`
@keyframes itsm-SystemBar-pulse {
  0% { opacity: 0.6; transform: scale(1); }
  70%, 100% { opacity: 0; transform: scale(2.6); }
}

.itsm-SystemBar {
  box-sizing: border-box;
  position: static;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: "lead actions" "text text";
  align-items: center;
  column-gap: var(--itsm-space-sm);
  min-block-size: var(--itsm-system-bar-height);
  padding: var(--itsm-space-2xs) var(--itsm-space-sm);
  border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-hero-line);
  background: var(--itsm-hero-bar-background);
  color: var(--itsm-colour-hero-text);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-medium);
  letter-spacing: 0;
}

.itsm-SystemBar[data-align="center"] {
  justify-content: center;
  justify-items: center;
}

.itsm-SystemBar__lead {
  grid-area: lead;
  display: flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  min-inline-size: 0;
  white-space: nowrap;
}

/* "● Demo": a 22 px pill with the accent dot and its glow. */
.itsm-SystemBar__badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  box-sizing: border-box;
  block-size: 1.375rem;
  padding-inline: var(--itsm-space-xs);
  border: var(--itsm-border-hair) solid var(--itsm-colour-hero-lineStrong);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-hero-fill);
  color: var(--itsm-colour-hero-text);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-semibold);
  white-space: nowrap;
}

.itsm-SystemBar__dot {
  position: relative;
  flex: none;
  inline-size: 0.375rem;
  block-size: 0.375rem;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-hero-accent);
  box-shadow: 0 0 0 0.1875rem var(--itsm-colour-hero-glowBar);
}

.itsm-SystemBar__badge[data-live] .itsm-SystemBar__dot::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--itsm-colour-hero-accent);
  opacity: 0;
  animation: itsm-SystemBar-pulse 2s var(--itsm-easing-standard) infinite;
}

/* The countdown: a quiet "Resets in" and the time bright and tabular, so it does not jitter. */
.itsm-SystemBar__status {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-inline-size: 0;
  color: var(--itsm-colour-hero-textSecondary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.itsm-SystemBar__status :where(svg) {
  flex: none;
  color: var(--itsm-colour-hero-textMuted);
}

.itsm-SystemBar__status :where(time) {
  display: inline-block;
  min-inline-size: 5.2em;
  color: var(--itsm-colour-hero-text);
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

/* The last ten minutes: the status becomes an amber pill. */
.itsm-SystemBar[data-state="warning"] .itsm-SystemBar__status {
  padding-inline: var(--itsm-space-xs);
  border-radius: var(--itsm-radius-pill);
  background: color-mix(in srgb, var(--itsm-colour-hero-warning) 20%, transparent);
  color: var(--itsm-colour-hero-warning);
}

.itsm-SystemBar[data-state="warning"] .itsm-SystemBar__status :where(svg, time) {
  color: inherit;
}

/* A reset running: the spinner and its words stand in for the countdown. */
.itsm-SystemBar__busy {
  display: none;
  align-items: center;
  gap: var(--itsm-space-xs);
  color: var(--itsm-colour-hero-textSecondary);
  white-space: nowrap;
}

.itsm-SystemBar__busy .itsm-Spinner {
  color: var(--itsm-colour-hero-textSecondary);
}

.itsm-SystemBar[data-state="busy"] .itsm-SystemBar__busy {
  display: inline-flex;
}

.itsm-SystemBar[data-state="busy"] .itsm-SystemBar__status {
  display: none;
}

.itsm-SystemBar__text {
  grid-area: text;
  min-inline-size: 0;
  overflow: hidden;
  color: var(--itsm-colour-hero-textSecondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.itsm-SystemBar__separator {
  padding-inline: var(--itsm-space-xs);
  color: var(--itsm-colour-hero-textMuted);
}

.itsm-SystemBar__persona :where(strong, b) {
  color: var(--itsm-colour-hero-text);
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-SystemBar :where(.itsm-SystemBar__text, .itsm-SystemBar__note) :where(a:any-link) {
  color: var(--itsm-colour-hero-link);
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

/* Wide screens only: the shared-data note, set off by a hairline. */
.itsm-SystemBar__note {
  display: none;
  flex: 0 1 auto;
  min-inline-size: 0;
  padding-inline-start: var(--itsm-space-sm);
  border-inline-start: var(--itsm-border-hair) solid var(--itsm-colour-hero-line);
  overflow: hidden;
  color: var(--itsm-colour-hero-textMuted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.itsm-SystemBar__actions {
  grid-area: actions;
  display: flex;
  flex: none;
  align-items: center;
  gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
}

/* Outlined navy buttons: 36 px squares on a phone, 30 px from 48rem, with words from 64rem. */
.itsm-SystemBar__action {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  box-sizing: border-box;
  min-inline-size: 2.25rem;
  block-size: 2.25rem;
  margin: 0;
  padding-block: 0;
  padding-inline: var(--itsm-space-xs);
  border: var(--itsm-border-hair) solid var(--itsm-colour-hero-lineStrong);
  border-radius: var(--itsm-radius-lg);
  background: transparent;
  color: var(--itsm-colour-hero-text);
  font: inherit;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-semibold);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-SystemBar__action:hover {
  background: var(--itsm-colour-hero-fill);
}

.itsm-SystemBar__action:active {
  background: var(--itsm-colour-hero-fillStrong);
}

.itsm-SystemBar__action[aria-disabled="true"] {
  color: var(--itsm-colour-hero-textMuted);
}

/* The words stay the button's name at every width; below 64rem only the icon shows. */
.itsm-SystemBar__actionLabel {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

${mq.md} {
  :root:has(.itsm-SystemBar) {
    --itsm-system-bar-h: var(--itsm-system-bar-height);
  }

  .itsm-SystemBar {
    position: sticky;
    inset-block-start: 0;
    z-index: var(--itsm-z-systemBar);
    display: flex;
    align-items: center;
    gap: calc(var(--itsm-space-sm) + var(--itsm-space-3xs));
    padding-block: 0;
    padding-inline: var(--itsm-space-md) calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
  }

  /* The badge and the countdown never give up width: the sentences after them truncate instead. */
  .itsm-SystemBar__lead {
    flex: none;
  }

  .itsm-SystemBar__text {
    flex: 1 1 auto;
    font-size: var(--itsm-text-callout-size);
    line-height: var(--itsm-text-callout-line);
  }

  .itsm-SystemBar[data-align="center"] .itsm-SystemBar__text {
    flex-grow: 0;
  }

  .itsm-SystemBar__actions {
    margin-inline-start: auto;
  }

  .itsm-SystemBar[data-align="center"] .itsm-SystemBar__actions {
    margin-inline-start: 0;
  }

  .itsm-SystemBar__action {
    min-inline-size: 1.875rem;
    block-size: 1.875rem;
  }
}

${mq.lg} {
  .itsm-SystemBar__actionLabel {
    position: static;
    inline-size: auto;
    block-size: auto;
    overflow: visible;
    clip-path: none;
  }
}

${mq.xl} {
  .itsm-SystemBar__note {
    display: block;
  }
}

${mq.reducedMotion} {
  .itsm-SystemBar__badge[data-live] .itsm-SystemBar__dot::after {
    animation: none;
  }
}

${prefers.reducedMotion} .itsm-SystemBar__badge[data-live] .itsm-SystemBar__dot::after {
  animation: none;
}

${mq.forcedColors} {
  .itsm-SystemBar {
    background: Canvas;
    color: CanvasText;
    border-block-end-color: CanvasText;
  }

  .itsm-SystemBar__badge,
  .itsm-SystemBar__action {
    border-color: ButtonText;
  }

  .itsm-SystemBar__dot {
    background: CanvasText;
    box-shadow: none;
  }
}

@media print {
  .itsm-SystemBar {
    display: none;
  }
}

/* Without :has() the height is never published, so the bar must not stick over the top bar. */
@supports not selector(:has(*)) {
  .itsm-SystemBar {
    position: static;
  }
}
`,
);
