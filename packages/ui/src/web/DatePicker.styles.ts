import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `DatePicker`, the calendar it opens (`overlays/Calendar`), and the popover
 * surface `DateRangePicker` shares.
 *
 * - **Field:** an `.itsm-InputGroup` (web/Input styles) with the calendar
 *   button inside its end, a ghost square that fills on hover and stays
 *   filled while its calendar is open.
 * - **Popover:** `material.popover`, radius `xl`, elevation `lg`, scaling
 *   in from the field like a menu. Presets, when given, are a column of
 *   quiet rows beside the grid (above it on a phone).
 * - **Grid:** 36 px cells, each day a 32 px circle — concentric, and every
 *   target over 24 px. Numbers are tabular so the columns never shimmer.
 *   Today is the link colour at weight 600; the chosen day is the one
 *   filled accent circle (`brand.solid`, 4.69:1 for its white number); a
 *   range's days sit on a `surface.selected` band that runs through the
 *   week. Days outside the month are muted, unavailable ones disabled. The
 *   focus ring is drawn on the circle, not the cell.
 */
export const datePickerStyles = layer(
  'components',
  css`
.itsm-DatePicker { padding-inline-end: var(--itsm-space-2xs); }
.itsm-DatePicker__toggle {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  inline-size: calc(var(--itsm-control-height-md) - 2 * var(--itsm-space-2xs));
  block-size: calc(var(--itsm-control-height-md) - 2 * var(--itsm-space-2xs));
  padding: 0;
  border: 0;
  border-radius: var(--itsm-radius-md);
  background: transparent;
  color: var(--itsm-colour-text-secondary);
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard), color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-DatePicker__toggle:hover { background: var(--itsm-colour-fill-hover); color: var(--itsm-colour-text-primary); }
.itsm-DatePicker__toggle:active,
.itsm-DatePicker__toggle[data-state="open"] { background: var(--itsm-colour-fill-pressed); color: var(--itsm-colour-text-primary); }
.itsm-DatePicker__toggle:disabled { background: transparent; color: var(--itsm-colour-text-disabled); cursor: not-allowed; }

.itsm-DatePicker__popover {
  z-index: var(--itsm-z-dropdown);
  display: flex;
  gap: var(--itsm-space-sm);
  box-sizing: border-box;
  max-inline-size: calc(100vw - 2 * var(--itsm-space-xs));
  padding: var(--itsm-space-sm);
  border: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-xl);
  background: var(--itsm-colour-material-popover);
  -webkit-backdrop-filter: var(--itsm-material-popover-filter);
  backdrop-filter: var(--itsm-material-popover-filter);
  box-shadow: var(--itsm-elevation-lg), var(--itsm-edge-highlight);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  outline: none;
  transform-origin: var(--radix-popover-content-transform-origin, top);
  animation: itsm-overlay-zoom-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}
.itsm-DatePicker__popover[data-state="closed"] {
  animation: itsm-overlay-zoom-out var(--itsm-duration-fast) var(--itsm-easing-exit) forwards;
}
.itsm-DatePicker__presets {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  min-inline-size: 8.5rem;
  padding-inline-end: var(--itsm-space-sm);
  border-inline-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}
.itsm-DatePicker__preset {
  min-block-size: var(--itsm-nav-item-height);
  padding: var(--itsm-space-2xs) var(--itsm-space-xs);
  border: 0;
  border-radius: var(--itsm-radius-md);
  background: transparent;
  color: var(--itsm-colour-text-primary);
  font: inherit;
  text-align: start;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-DatePicker__preset:hover { background: var(--itsm-colour-surface-hover); }
.itsm-DatePicker__preset[aria-pressed="true"] { background: var(--itsm-colour-surface-selected); font-weight: var(--itsm-font-weight-semibold); }
.itsm-DatePicker__preset:disabled { background: transparent; color: var(--itsm-colour-text-disabled); cursor: not-allowed; }

${mq.belowSm} {
  .itsm-DatePicker__popover { flex-direction: column; }
  .itsm-DatePicker__presets {
    flex-direction: row;
    flex-wrap: wrap;
    padding: 0 0 var(--itsm-space-sm);
    border-inline-end: 0;
    border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  }
}

.itsm-Calendar {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
}
.itsm-Calendar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--itsm-space-xs);
}
.itsm-Calendar__caption {
  flex: 1 1 auto;
  text-align: center;
  font-weight: var(--itsm-font-weight-semibold);
  color: var(--itsm-colour-text-primary);
}
.itsm-Calendar__grid {
  border-collapse: separate;
  border-spacing: 0 var(--itsm-space-3xs);
}
.itsm-Calendar__weekday {
  inline-size: 2.25rem;
  padding: 0 0 var(--itsm-space-2xs);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  color: var(--itsm-colour-text-muted);
  text-align: center;
}
.itsm-Calendar__day {
  inline-size: 2.25rem;
  block-size: 2.25rem;
  padding: 0;
  text-align: center;
  vertical-align: middle;
  color: var(--itsm-colour-text-primary);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  outline: none;
  user-select: none;
}
.itsm-Calendar__number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 2rem;
  block-size: 2rem;
  border-radius: var(--itsm-radius-pill);
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Calendar__day:hover .itsm-Calendar__number { background: var(--itsm-colour-fill-hover); }
.itsm-Calendar__day[data-outside] { color: var(--itsm-colour-text-muted); }
.itsm-Calendar__day[aria-current="date"] {
  color: var(--itsm-colour-text-link);
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-Calendar__day[data-mark="middle"] { background: var(--itsm-colour-surface-selected); }
.itsm-Calendar__day[data-mark="start"] { background: linear-gradient(90deg, transparent 50%, var(--itsm-colour-surface-selected) 50%); }
.itsm-Calendar__day[data-mark="end"] { background: linear-gradient(90deg, var(--itsm-colour-surface-selected) 50%, transparent 50%); }
.itsm-Calendar__day[data-mark="start"]:dir(rtl) { background: linear-gradient(90deg, var(--itsm-colour-surface-selected) 50%, transparent 50%); }
.itsm-Calendar__day[data-mark="end"]:dir(rtl) { background: linear-gradient(90deg, transparent 50%, var(--itsm-colour-surface-selected) 50%); }
.itsm-Calendar__day[data-mark="single"] .itsm-Calendar__number,
.itsm-Calendar__day[data-mark="start"] .itsm-Calendar__number,
.itsm-Calendar__day[data-mark="end"] .itsm-Calendar__number {
  background: var(--itsm-colour-brand-solid);
  color: var(--itsm-colour-brand-solidText);
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-Calendar__day[aria-disabled="true"] {
  color: var(--itsm-colour-text-disabled);
  cursor: not-allowed;
}
.itsm-Calendar__day[aria-disabled="true"] .itsm-Calendar__number { background: none; }
.itsm-Calendar__day:focus-visible .itsm-Calendar__number {
  outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus);
  outline-offset: var(--itsm-border-hair);
  box-shadow: 0 0 0 var(--itsm-border-hair) var(--itsm-colour-focusGap);
}
.itsm-Calendar__hint {
  margin: 0;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
  text-align: center;
}

${mq.reducedMotion} {
  .itsm-DatePicker__popover { animation-name: itsm-overlay-fade-in; }
  .itsm-DatePicker__popover[data-state="closed"] { animation-name: itsm-overlay-fade-out; }
}
${prefers.reducedMotion} .itsm-DatePicker__popover { animation-name: itsm-overlay-fade-in; }
${prefers.reducedMotion} .itsm-DatePicker__popover[data-state="closed"] { animation-name: itsm-overlay-fade-out; }

${mq.forcedColors} {
  .itsm-DatePicker__popover { border-color: CanvasText; }
  .itsm-Calendar__day[data-mark="single"] .itsm-Calendar__number,
  .itsm-Calendar__day[data-mark="start"] .itsm-Calendar__number,
  .itsm-Calendar__day[data-mark="end"] .itsm-Calendar__number {
    forced-color-adjust: none;
    background: Highlight;
    color: HighlightText;
  }
  .itsm-Calendar__day[data-mark="middle"] { forced-color-adjust: none; background: Canvas; color: CanvasText; text-decoration: underline; }
  .itsm-Calendar__day:focus-visible .itsm-Calendar__number { outline-color: Highlight; }
}
`,
);
