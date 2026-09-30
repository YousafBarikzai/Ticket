import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `Menu`, and every menu drawn from the same parts (`ContextMenu`, submenus,
 * `SplitButton`'s chevron, the account menu).
 *
 * - **Material:** `material.popover` with its blur — one of the few glass
 *   surfaces D6 allows, and only because the tokens keep it at ≥ 0.96 alpha
 *   and turn it solid where transparency is reduced or contrast raised. A
 *   `border.subtle` hairline defines the edge on a light canvas; in the
 *   high-contrast themes the `lg` elevation is itself a 2 px ring.
 * - **Geometry:** radius `xl` (14) with 6 px padding, so an item's radius
 *   `md` (8) is concentric with the surface. Items are the nav-item height
 *   (32, 28 compact, 44 on touch) in `callout`.
 * - **Highlight:** `surface.selected` with `text.primary`, never link blue.
 *   Radix focuses the item under the pointer as well as the one the keyboard
 *   reached, so the inset ring is drawn for `:focus-visible` only: arrowing
 *   gets a ring, hovering does not. Danger items are `danger.subtleText` and
 *   highlight on `danger.subtle`. An unavailable item keeps its place and its
 *   focus but reads in `text.disabled`, with its reason underneath.
 * - **Motion:** opacity and a 0.97 scale from the trigger's side over `fast`
 *   on the entrance curve, out over `fast` on the exit curve; no overshoot.
 *   Reduced motion keeps the fade only.
 */
export const menuStyles = layer(
  'components',
  css`
.itsm-Menu__content {
  z-index: var(--itsm-z-dropdown);
  box-sizing: border-box;
  min-inline-size: 13.75rem;
  max-inline-size: min(22.5rem, calc(100vw - 2 * var(--itsm-space-xs)));
  max-block-size: min(32rem, var(--radix-dropdown-menu-content-available-height, var(--radix-context-menu-content-available-height, 32rem)));
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
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
  transform-origin: var(--radix-dropdown-menu-content-transform-origin, var(--radix-context-menu-content-transform-origin, top));
  animation: itsm-overlay-zoom-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}
.itsm-Menu__content[data-state="closed"] {
  animation: itsm-overlay-zoom-out var(--itsm-duration-fast) var(--itsm-easing-exit) forwards;
}

.itsm-Menu__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  min-block-size: var(--itsm-nav-item-height);
  padding: var(--itsm-space-2xs) var(--itsm-space-xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-primary);
  text-decoration: none;
  cursor: default;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  outline: none;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Menu__item[data-highlighted] {
  background: var(--itsm-colour-surface-selected);
  color: var(--itsm-colour-text-primary);
}
.itsm-Menu__item:focus-visible {
  outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus);
  outline-offset: calc(-1 * var(--itsm-focus-width));
  box-shadow: none;
}
.itsm-Menu__item[data-state="open"]:not([data-highlighted]) {
  background: var(--itsm-colour-surface-hover);
}

.itsm-Menu__item--danger,
.itsm-Menu__item--danger .itsm-Menu__leading {
  color: var(--itsm-colour-danger-subtleText);
}
.itsm-Menu__item--danger[data-highlighted] {
  background: var(--itsm-colour-danger-subtle);
  color: var(--itsm-colour-danger-subtleText);
}

.itsm-Menu__item[data-unavailable],
.itsm-Menu__item[data-unavailable] .itsm-Menu__leading,
.itsm-Menu__item[data-disabled] {
  color: var(--itsm-colour-text-disabled);
}
.itsm-Menu__item[data-unavailable][data-highlighted] {
  background: var(--itsm-colour-fill-hover);
  color: var(--itsm-colour-text-disabled);
}

.itsm-Menu__leading {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  inline-size: var(--itsm-icon-sm);
  block-size: var(--itsm-icon-sm);
  color: var(--itsm-colour-text-secondary);
}
.itsm-Menu__indicator {
  display: inline-flex;
  color: var(--itsm-colour-accent);
}
.itsm-Menu__text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-inline-size: 0;
}
.itsm-Menu__itemLabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-Menu__description {
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
  color: var(--itsm-colour-text-muted);
  white-space: normal;
  text-wrap: pretty;
}
.itsm-Menu__shortcut {
  flex: none;
  margin-inline-start: auto;
  padding-inline-start: var(--itsm-space-md);
  color: var(--itsm-colour-text-muted);
}
.itsm-Menu__chevron {
  flex: none;
  margin-inline-start: auto;
  color: var(--itsm-colour-text-muted);
}

.itsm-Menu__heading {
  padding: var(--itsm-space-xs) var(--itsm-space-xs) var(--itsm-space-2xs);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  color: var(--itsm-colour-text-secondary);
}
.itsm-Menu__group + .itsm-Menu__group .itsm-Menu__heading {
  padding-block-start: var(--itsm-space-sm);
}
.itsm-Menu__separator {
  block-size: var(--itsm-hairline);
  margin: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs) / 2) var(--itsm-space-xs);
  background: var(--itsm-colour-border-subtle);
}

${mq.coarse} {
  .itsm-Menu__item { padding-block: var(--itsm-space-xs); }
}

${mq.reducedMotion} {
  .itsm-Menu__content { animation-name: itsm-overlay-fade-in; }
  .itsm-Menu__content[data-state="closed"] { animation-name: itsm-overlay-fade-out; }
}
${prefers.reducedMotion} .itsm-Menu__content { animation-name: itsm-overlay-fade-in; }
${prefers.reducedMotion} .itsm-Menu__content[data-state="closed"] { animation-name: itsm-overlay-fade-out; }

${mq.forcedColors} {
  .itsm-Menu__content { border-color: CanvasText; }
  .itsm-Menu__item[data-highlighted] {
    forced-color-adjust: none;
    background: Highlight;
    color: HighlightText;
  }
  .itsm-Menu__item[data-unavailable],
  .itsm-Menu__item[data-disabled] { color: GrayText; }
  .itsm-Menu__separator { background: CanvasText; }
}
`,
);
