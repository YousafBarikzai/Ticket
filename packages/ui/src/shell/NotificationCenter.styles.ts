import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `NotificationCenter`: the bell, its count and its panel (v3 §2.15, X-M13).
 *
 * The count is a 16 px `danger.solid` capsule on the bell's corner ("99+" at
 * most) with a 2 px ring in the gap colour, so it stays a separate shape on
 * any bar (A2 §5.2.1). An emergency adds a danger dot at the other corner
 * with its own ring, so it reads even beside the count and never by colour
 * alone (the bell's name says "urgent").
 *
 * The panel is a 380 px popover on `material.popover` (glass at ≥ 0.96, solid
 * where transparency is reduced), radius `xl` (12), elevation `md`, scaling
 * in from the bell over `fast` — or a sheet from the bottom on a phone. The
 * header is the `title3` heading with its `Count` and a ghost *Mark all
 * read*; "Today" and "Earlier" are 600 12/16 `text.muted`, sentence case.
 * Rows are 56 px links: a 28 px tile, the subject 500 13/18 (600 unread), a
 * meta line 12/16 `text.muted` with the ticket number in the `id` style, and
 * a 6 px accent dot for unread. The major-incident tile is the one solid
 * tile, `danger.solid` under `danger.solidText`.
 */
export const notificationCenterStyles = layer(
  'components',
  css`
.itsm-NotificationCenter {
  position: relative;
  display: inline-flex;
  flex: none;
}
.itsm-NotificationCenter__count {
  position: absolute;
  inset-block-start: var(--itsm-space-3xs);
  inset-inline-end: 1px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-inline-size: var(--itsm-icon-sm);
  block-size: var(--itsm-icon-sm);
  padding: 0 var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-danger-solid);
  color: var(--itsm-colour-danger-solidText);
  box-shadow: 0 0 0 var(--itsm-border-thick) var(--itsm-colour-focusGap);
  /* 10/16: the one type size below the ramp, for a count that must fit a 16 px disc. */
  font-size: 0.625rem;
  line-height: 1;
  font-weight: var(--itsm-font-weight-bold);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.itsm-NotificationCenter__urgent {
  position: absolute;
  inset-block-start: var(--itsm-space-3xs);
  inset-inline-start: var(--itsm-space-3xs);
  inline-size: var(--itsm-space-xs);
  block-size: var(--itsm-space-xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-danger-solid);
  box-shadow: 0 0 0 var(--itsm-border-thick) var(--itsm-colour-focusGap);
  pointer-events: none;
  animation: itsm-pulse 2s var(--itsm-easing-standard) 3;
}

.itsm-NotificationPanel__popover {
  z-index: var(--itsm-z-dropdown);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  inline-size: min(23.75rem, calc(100vw - 2 * var(--itsm-space-xs)));
  max-block-size: min(36rem, var(--radix-popover-content-available-height, 36rem));
  overflow-y: auto;
  overscroll-behavior: contain;
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-xl);
  background: var(--itsm-colour-material-popover);
  -webkit-backdrop-filter: var(--itsm-material-popover-filter);
  backdrop-filter: var(--itsm-material-popover-filter);
  box-shadow: var(--itsm-elevation-md), var(--itsm-edge-highlight);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  outline: none;
  transform-origin: var(--radix-popover-content-transform-origin, top);
  animation: itsm-overlay-zoom-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}
.itsm-NotificationPanel__popover[data-state="closed"] {
  animation: itsm-overlay-zoom-out var(--itsm-duration-fast) var(--itsm-easing-exit) forwards;
}

.itsm-NotificationPanel__header {
  position: sticky;
  inset-block-start: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-block-size: var(--itsm-control-height-lg);
  padding: var(--itsm-space-sm) var(--itsm-space-sm) var(--itsm-space-xs) var(--itsm-space-md);
  background: var(--itsm-colour-material-popover);
}
.itsm-NotificationPanel__title {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  margin: 0;
  font-family: var(--itsm-text-title3-family);
  font-size: var(--itsm-text-title3-size);
  line-height: var(--itsm-text-title3-line);
  font-weight: var(--itsm-text-title3-weight);
  letter-spacing: var(--itsm-text-title3-tracking);
  word-spacing: var(--itsm-text-title3-word-spacing);
}
.itsm-NotificationPanel__count {
  font-family: var(--itsm-font-family-sans);
  letter-spacing: 0;
  word-spacing: 0;
}
.itsm-NotificationPanel__markAll {
  margin-inline-start: auto;
}

.itsm-NotificationPanel__body {
  display: flex;
  flex-direction: column;
  padding-block-end: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
}
.itsm-NotificationPanel__problem {
  margin: var(--itsm-space-2xs) var(--itsm-space-sm) var(--itsm-space-xs);
}

.itsm-NotificationPanel__section + .itsm-NotificationPanel__section {
  margin-block-start: var(--itsm-space-2xs);
}
.itsm-NotificationPanel__day {
  margin: 0;
  padding: var(--itsm-space-xs) var(--itsm-space-md) var(--itsm-space-2xs);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-NotificationPanel__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0 calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  list-style: none;
}
.itsm-NotificationPanel__item {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  box-sizing: border-box;
  min-block-size: 3.5rem;
  padding: var(--itsm-space-xs) var(--itsm-space-sm) var(--itsm-space-xs) calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-primary);
  text-decoration: none;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-NotificationPanel__item:hover {
  background: var(--itsm-colour-surface-hover);
}
.itsm-NotificationPanel__item:focus-visible {
  outline-offset: calc(-1 * var(--itsm-focus-width));
  box-shadow: none;
}
.itsm-NotificationPanel__tile[data-solid] {
  --_itsm-tile-fill: var(--itsm-colour-danger-solid);
  --_itsm-tile-ink: var(--itsm-colour-danger-solidText);
}
.itsm-NotificationPanel__text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-inline-size: 0;
}
.itsm-NotificationPanel__subject {
  display: -webkit-box;
  overflow: hidden;
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-font-weight-medium);
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
.itsm-NotificationPanel__item[data-unread] .itsm-NotificationPanel__subject {
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-NotificationPanel__meta {
  overflow: hidden;
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.itsm-NotificationPanel__ref {
  font-family: var(--itsm-text-id-family);
  font-size: var(--itsm-text-id-size);
  font-weight: var(--itsm-text-id-weight);
  font-variant-numeric: slashed-zero tabular-nums;
}
.itsm-NotificationPanel__dot {
  flex: none;
  inline-size: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  block-size: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-accent);
}

.itsm-NotificationPanel__skeletonRow {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  box-sizing: border-box;
  min-block-size: 3.5rem;
  padding: var(--itsm-space-xs) var(--itsm-space-sm) var(--itsm-space-xs) calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
}
.itsm-NotificationPanel__skeletonText {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--itsm-space-xs);
}
/* The panel has already waited 200 ms before drawing these, so the bones show at once. */
.itsm-NotificationPanel__skeleton .itsm-Skeleton,
.itsm-NotificationPanel__skeleton .itsm-Skeleton::after {
  animation-delay: 0ms;
}

.itsm-NotificationPanel__empty {
  padding: var(--itsm-space-lg) var(--itsm-space-md);
}

.itsm-NotificationPanel__footer {
  display: flex;
  margin-block-start: var(--itsm-space-2xs);
  padding: var(--itsm-space-xs) var(--itsm-space-md) var(--itsm-space-2xs);
  border-block-start: var(--itsm-border-hair) solid var(--itsm-colour-border-divider);
}
.itsm-NotificationPanel__settings {
  border-radius: var(--itsm-radius-xs);
  color: var(--itsm-colour-text-link);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-semibold);
  text-decoration: none;
}
.itsm-NotificationPanel__settings:hover {
  text-decoration: underline;
  text-underline-offset: 0.2em;
}

.itsm-NotificationPanel__sheet .itsm-NotificationPanel__day {
  padding-inline: var(--itsm-space-xs);
}
.itsm-NotificationPanel__sheet .itsm-NotificationPanel__list {
  padding-inline: 0;
}
.itsm-NotificationPanel__sheet .itsm-NotificationPanel__problem {
  margin-inline: 0;
}
.itsm-NotificationPanel__sheet .itsm-NotificationPanel__footer {
  padding-inline: var(--itsm-space-xs);
}

${mq.reducedMotion} {
  .itsm-NotificationCenter__urgent {
    animation: none;
  }
  .itsm-NotificationPanel__popover,
  .itsm-NotificationPanel__popover[data-state="closed"] {
    animation-name: itsm-overlay-fade-in;
  }
  .itsm-NotificationPanel__popover[data-state="closed"] {
    animation-name: itsm-overlay-fade-out;
  }
}
${prefers.reducedMotion} .itsm-NotificationCenter__urgent {
  animation: none;
}

${mq.forcedColors} {
  .itsm-NotificationPanel__popover {
    border-color: CanvasText;
  }
  .itsm-NotificationCenter__count,
  .itsm-NotificationCenter__urgent {
    border: var(--itsm-border-hair) solid CanvasText;
  }
  .itsm-NotificationPanel__dot {
    forced-color-adjust: none;
    background: Highlight;
  }
}
`,
);
