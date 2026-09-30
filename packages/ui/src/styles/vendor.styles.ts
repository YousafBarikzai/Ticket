import { css } from './css.js';

/**
 * Overrides of third-party selectors — sonner's `[data-sonner-toaster]` and
 * `[data-sonner-toast]` — and nothing else.
 *
 * Unlayered on purpose, and so not wrapped with `layer()`. Those libraries
 * inject their own unlayered `<style>`, and an unlayered rule beats every
 * layered one: an override inside `itsm.components` would lose to the very
 * rule it was written to change. Sonner's sheet is also inserted after ours,
 * so every rule here is scoped under the toaster's own class
 * (`.itsm-Toaster`) to win on specificity rather than on order. Kept to one
 * module so the exception stays small and visible.
 *
 * What is overridden, and why:
 *
 * - **Stacking and type:** the toast layer's z-index (above dialogs, below
 *   tooltips) instead of sonner's nine nines; the product's font.
 * - **Motion (SPEC §1.9):** toasts rise 8 px and fade in over `normal`, the
 *   stack reflows over `normal` on the standard curve, and a dismissed toast
 *   sinks 8 px as it fades — sonner's 400 ms full-height slides are replaced.
 *   The durations are tokens, so reduced motion collapses them; sonner also
 *   turns its transitions off under the operating system's setting.
 * - **Width:** the card width from 601 px up (below that sonner spans the
 *   screen less its mobile offsets, which is what a phone wants).
 * - **The collapsed pile:** the cards behind the front one show their
 *   surface only, not their words.
 * - **Focus:** the design system's two-tone ring on a focused toast, in
 *   place of sonner's grey halo.
 *
 * `react-remove-scroll` (Radix's scroll lock) marks `body[data-scroll-locked]`
 * and keeps the scrollbar's gutter with a margin; nothing in the product
 * needs that changed, so there is no rule for it.
 */
export const vendorStyles = css`
.itsm-Toaster[data-sonner-toaster] {
  z-index: var(--itsm-z-toast);
  font-family: var(--itsm-font-family-sans);
  transition: transform var(--itsm-duration-normal) var(--itsm-easing-standard);
}
.itsm-Toaster[data-sonner-toaster] [data-sonner-toast] {
  transition:
    transform var(--itsm-duration-normal) var(--itsm-easing-standard),
    opacity var(--itsm-duration-normal) var(--itsm-easing-standard),
    height var(--itsm-duration-normal) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Toaster[data-sonner-toaster] [data-sonner-toast][data-y-position="bottom"]:not([data-mounted="true"]),
.itsm-Toaster[data-sonner-toaster] [data-sonner-toast][data-removed="true"][data-front="true"][data-swipe-out="false"] {
  --y: translateY(var(--itsm-space-xs));
}
.itsm-Toaster[data-sonner-toaster] [data-sonner-toast][data-expanded="false"][data-front="false"] {
  overflow: hidden;
}
.itsm-Toaster[data-sonner-toaster] [data-sonner-toast][data-expanded="false"][data-front="false"] > * {
  opacity: 0;
}
.itsm-Toaster[data-sonner-toaster] [data-sonner-toast]:focus-visible {
  outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus);
  outline-offset: var(--itsm-focus-offset);
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap), var(--itsm-elevation-lg);
}
@media (min-width: 37.5625rem) {
  .itsm-Toaster[data-sonner-toaster] [data-sonner-toast] {
    width: var(--width);
  }
}
@media (forced-colors: active) {
  .itsm-Toaster[data-sonner-toaster] [data-sonner-toast]:focus-visible {
    outline-color: Highlight;
  }
}
`;
