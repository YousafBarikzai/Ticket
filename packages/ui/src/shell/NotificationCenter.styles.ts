import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `NotificationCenter`: the bell, its count and its panel.
 *
 * The count is an accent capsule on the bell's corner ("99+" at most); an
 * emergency adds a danger dot with its own ring, so it reads even beside the
 * count and never by colour alone (the bell's name says "urgent").
 *
 * The panel is a popover on `material.popover` (glass at 0.96, solid where
 * transparency is reduced), 400 px, radius `xl`, elevation `lg`, scaling in
 * from the bell over `fast` — or a bottom sheet on a phone. Rows are grouped
 * by day under sentence-case `subheadline` headings; unread rows have an
 * accent dot and a semibold subject; the pinned emergency uses the danger
 * text colour and icon.
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
  inset-block-start: calc(-1 * var(--itsm-space-3xs));
  inset-inline-end: calc(-1 * var(--itsm-space-3xs));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-inline-size: var(--itsm-icon-sm);
  block-size: var(--itsm-icon-sm);
  padding: 0 var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-brand-solid);
  color: var(--itsm-colour-brand-solidText);
  box-shadow: 0 0 0 var(--itsm-border-thick) var(--itsm-colour-focusGap);
  font-size: var(--itsm-text-caption-size);
  line-height: 1;
  font-weight: var(--itsm-font-weight-semibold);
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
  box-sizing: border-box;
  inline-size: min(25rem, calc(100vw - 2 * var(--itsm-space-xs)));
  max-block-size: min(36rem, var(--radix-popover-content-available-height, 36rem));
  overflow-y: auto;
  overscroll-behavior: contain;
  border: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-xl);
  background: var(--itsm-colour-material-popover);
  -webkit-backdrop-filter: var(--itsm-material-popover-filter);
  backdrop-filter: var(--itsm-material-popover-filter);
  box-shadow: var(--itsm-elevation-lg), var(--itsm-edge-highlight);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-sans);
  outline: none;
  transform-origin: var(--radix-popover-content-transform-origin, top);
  animation: itsm-overlay-zoom-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}
.itsm-NotificationPanel__popover[data-state="closed"] {
  animation: itsm-overlay-zoom-out var(--itsm-duration-fast) var(--itsm-easing-exit) forwards;
}

.itsm-NotificationPanel {
  display: flex;
  flex-direction: column;
  padding-block-end: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
}
.itsm-NotificationPanel__header {
  position: sticky;
  inset-block-start: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--itsm-space-xs);
  min-block-size: var(--itsm-control-height-lg);
  padding: var(--itsm-space-xs) var(--itsm-space-xs) var(--itsm-space-2xs) var(--itsm-space-md);
  background: var(--itsm-colour-material-popover);
}
.itsm-NotificationPanel__header:empty {
  display: none;
}
.itsm-NotificationPanel__title {
  margin: 0;
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  font-weight: var(--itsm-text-headline-weight);
  letter-spacing: var(--itsm-text-headline-tracking);
}
.itsm-NotificationPanel__markAll {
  margin-inline-start: auto;
}

.itsm-NotificationPanel__group + .itsm-NotificationPanel__group {
  margin-block-start: var(--itsm-space-2xs);
}
.itsm-NotificationPanel__day {
  margin: 0;
  padding: var(--itsm-space-xs) var(--itsm-space-md) var(--itsm-space-2xs);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
}
.itsm-NotificationPanel__group[data-urgent] .itsm-NotificationPanel__day {
  color: var(--itsm-colour-danger-subtleText);
}
.itsm-NotificationPanel__list {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  margin: 0;
  padding: 0 calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  list-style: none;
}
.itsm-NotificationPanel__item {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-xs);
  padding: var(--itsm-space-xs) var(--itsm-space-xs) var(--itsm-space-xs) var(--itsm-space-2xs);
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
.itsm-NotificationPanel__marker {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  inline-size: var(--itsm-icon-sm);
  block-size: var(--itsm-text-callout-line);
}
.itsm-NotificationPanel__dot {
  inline-size: var(--itsm-space-xs);
  block-size: var(--itsm-space-xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-accent);
}
.itsm-NotificationPanel__item[data-urgent] .itsm-NotificationPanel__marker {
  color: var(--itsm-colour-danger-subtleText);
}
.itsm-NotificationPanel__text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
}
.itsm-NotificationPanel__subject {
  overflow-wrap: anywhere;
}
.itsm-NotificationPanel__item[data-unread] .itsm-NotificationPanel__subject {
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-NotificationPanel__item[data-urgent] .itsm-NotificationPanel__subject {
  color: var(--itsm-colour-danger-subtleText);
}
.itsm-NotificationPanel__body {
  display: -webkit-box;
  overflow: hidden;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
.itsm-NotificationPanel__time {
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-variant-numeric: tabular-nums;
}

.itsm-NotificationPanel__skeleton {
  padding: var(--itsm-space-sm) var(--itsm-space-md) var(--itsm-space-md);
}

.itsm-NotificationPanel__problem {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs);
  padding: var(--itsm-space-md);
  color: var(--itsm-colour-text-secondary);
}
.itsm-NotificationPanel__problem > svg {
  color: var(--itsm-colour-danger-subtleText);
}
.itsm-NotificationPanel__stale {
  margin: var(--itsm-space-xs) var(--itsm-space-md) 0;
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}

.itsm-NotificationPanel__sheet .itsm-NotificationPanel__header {
  position: static;
  padding-inline: var(--itsm-space-xs);
  background: transparent;
}
.itsm-NotificationPanel__sheet .itsm-NotificationPanel__day {
  padding-inline: var(--itsm-space-xs);
}
.itsm-NotificationPanel__sheet .itsm-NotificationPanel__list {
  padding-inline: 0;
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
    border: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-NotificationPanel__dot {
    background: Highlight;
  }
}
`,
);
