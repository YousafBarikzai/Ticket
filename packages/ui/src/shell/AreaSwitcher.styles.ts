import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * The area switcher and everything that lists areas (v3 §3.4, A2 §5.3.2):
 *
 * - **The Area card** (`data-variant="card"`), under the sidebar's brand
 *   block: 52 px, radius `item`, a 1 px `border.soft` edge on
 *   `surface.raised`; a 28 px accent `IconTile` with the area's glyph (the
 *   gradient mark appears once per frame, X-m9), the area in 600 13/18 over
 *   its one-liner in `text.faint`, and ⇕. Hover `surface.hover` with
 *   `border.softHover`; open `surface.selected` with an accent edge. The
 *   rail's 44 px tile with its ⇕ badge is in the frame's rail rules.
 * - **The compact switcher** (`data-variant="compact"`): the portal's 36 px
 *   "Help Portal ⌄", a 32 × 44 chevron below 375 px; the phone top bar's
 *   is always the chevron alone.
 * - **The lockup** (`data-display="lockup"`): the same words, no edge, no
 *   hover, no focus stop — one area, nowhere to go.
 * - **The area menu** (`.itsm-AreaMenu`, on the menu surface): 340 px,
 *   radius 12, `md` elevation; its rows a 28 px tile, name, one-liner, the
 *   demo persona line in `text.secondary`, and the current row on
 *   `surface.selected` with an accent check. The account menu's Switch area
 *   group uses the same rows. The generic `detail` and `current` parts of a
 *   menu item are styled here too, until the menu restyle takes them.
 * - **`AreaList`**, the sheet's and the Me page's plain list.
 * - **The leaving veil**, `html[data-itsm-leaving]`, painted as the hop
 *   card while a cross-area link loads (X-M11). Generated content with empty
 *   alternative text, so it is not read twice: the menu's live region says it.
 */
export const areaSwitcherStyles = layer(
  'components',
  css`
/* ---- the card ---- */

.itsm-AreaSwitcher {
  display: grid;
  grid-template-columns: 1.75rem minmax(0, 1fr) var(--itsm-icon-sm);
  align-items: center;
  gap: 0.625rem;
  box-sizing: border-box;
  inline-size: 100%;
  min-inline-size: 0;
  min-block-size: 3.25rem;
  margin: 0;
  padding: var(--itsm-space-xs) 0.625rem;
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-soft);
  border-radius: var(--itsm-radius-item);
  background: var(--itsm-colour-surface-raised);
  color: var(--itsm-colour-text-primary);
  font: inherit;
  text-align: start;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard), border-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
button.itsm-AreaSwitcher:hover {
  border-color: var(--itsm-colour-border-softHover);
  background: var(--itsm-colour-surface-hover);
}
button.itsm-AreaSwitcher[aria-expanded="true"] {
  border-color: var(--itsm-colour-accent);
  background: var(--itsm-colour-surface-selected);
}
.itsm-AreaSwitcher__text {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
}
.itsm-AreaSwitcher__name,
.itsm-AreaSwitcher__description {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-AreaSwitcher__name {
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-AreaSwitcher__description {
  color: var(--itsm-colour-text-faint);
  font-size: 0.71875rem;
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
}
.itsm-AreaSwitcher__chevron {
  flex: none;
  color: var(--itsm-colour-text-faint);
}

/* ---- the lockup: one area ---- */

.itsm-AreaSwitcher[data-display="lockup"] {
  grid-template-columns: 1.75rem minmax(0, 1fr);
  border-color: transparent;
  background: transparent;
  cursor: default;
}

/* ---- compact: the portal's "Help Portal ⌄", the phones' chevron ---- */

.itsm-AreaSwitcher[data-variant="compact"] {
  display: inline-flex;
  flex: none;
  gap: var(--itsm-space-2xs);
  inline-size: auto;
  min-block-size: 0;
  block-size: var(--itsm-control-height-md);
  padding: 0 0.625rem 0 var(--itsm-space-sm);
}
.itsm-AreaSwitcher[data-variant="compact"] .itsm-AreaSwitcher__name {
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-callout-line);
}
.itsm-AreaSwitcher[data-variant="compact"] .itsm-AreaSwitcher__description {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.itsm-AreaSwitcher[data-variant="compact"][data-display="lockup"] {
  padding-inline: var(--itsm-space-2xs);
}
.itsm-AreaSwitcher[data-variant="compact"]:not([data-display="lockup"]) .itsm-AreaSwitcher__chevron {
  inline-size: var(--itsm-icon-xs);
  block-size: var(--itsm-icon-xs);
}
/* The chevron alone, 32 × 44: the portal under 375 px, and the phone top bars (RV5). */
@media (max-width: 23.4375rem) {
  button.itsm-AreaSwitcher[data-variant="compact"] {
    justify-content: center;
    inline-size: 2rem;
    block-size: var(--itsm-control-height-lg);
    padding: 0;
  }
  button.itsm-AreaSwitcher[data-variant="compact"] .itsm-AreaSwitcher__text {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
button.itsm-AreaSwitcher.itsm-AppTopBar__area {
  justify-content: center;
  inline-size: 2rem;
  block-size: var(--itsm-control-height-lg);
  padding: 0;
  border-color: transparent;
}
button.itsm-AreaSwitcher.itsm-AppTopBar__area:hover {
  border-color: transparent;
}
button.itsm-AreaSwitcher.itsm-AppTopBar__area .itsm-AreaSwitcher__text {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
button.itsm-AreaSwitcher.itsm-AppTopBar__area .itsm-AreaSwitcher__chevron {
  inline-size: var(--itsm-icon-md);
  block-size: var(--itsm-icon-md);
  color: var(--itsm-colour-text-secondary);
}

/* ---- the area menu ---- */

.itsm-AreaMenu.itsm-Menu__content {
  inline-size: 21.25rem;
  max-inline-size: calc(100vw - 2 * var(--itsm-space-xs));
  border-radius: var(--itsm-radius-xl);
  box-shadow: var(--itsm-elevation-md);
}
.itsm-AreaMenu__header.itsm-Menu__heading {
  display: flex;
  flex-direction: column;
  padding: var(--itsm-space-2xs) 0.625rem var(--itsm-space-xs);
}
.itsm-AreaMenu__title {
  color: var(--itsm-colour-text-faint);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-AreaMenu__context {
  color: var(--itsm-colour-text-faint);
  font-size: 0.71875rem;
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-regular);
}
.itsm-AreaMenu__row.itsm-Menu__item {
  display: grid;
  grid-template-columns: 1.75rem minmax(0, 1fr) var(--itsm-icon-sm);
  align-items: center;
  gap: 0.625rem;
  min-block-size: 3.5rem;
  padding: var(--itsm-space-xs) 0.625rem;
  cursor: pointer;
}
.itsm-AreaMenu__row[data-persona] {
  min-block-size: 4.5rem;
}
.itsm-AreaMenu__row[aria-current="true"] {
  background: var(--itsm-colour-surface-selected);
}
.itsm-AreaMenu__row[aria-current="true"][data-highlighted] {
  background: var(--itsm-colour-surface-selected);
  box-shadow: inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-border-soft);
}
.itsm-AreaMenu__row--home.itsm-Menu__item {
  display: flex;
  min-block-size: var(--itsm-nav-item-height);
}
.itsm-AreaMenu__name {
  font-weight: var(--itsm-font-weight-semibold);
  line-height: var(--itsm-text-subheadline-line);
}
.itsm-AreaMenu__persona {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
}
.itsm-Menu__detail {
  color: var(--itsm-colour-text-secondary);
  font-weight: var(--itsm-font-weight-medium);
}
.itsm-Menu__current {
  flex: none;
  margin-inline-start: auto;
  color: var(--itsm-colour-accent);
}

/* ---- AreaList ---- */

.itsm-AreaList {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-2xs);
}
.itsm-AreaList__heading {
  margin: 0;
  padding: 0 0.625rem;
  color: var(--itsm-colour-text-muted);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-semibold);
  letter-spacing: 0;
}
.itsm-AreaList__list {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  margin: 0;
  padding: 0;
  list-style: none;
}
.itsm-AreaList__row {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) var(--itsm-icon-sm);
  align-items: center;
  gap: var(--itsm-space-sm);
  box-sizing: border-box;
  min-block-size: 3.5rem;
  padding: var(--itsm-space-xs) 0.625rem;
  border-radius: var(--itsm-radius-item);
  color: var(--itsm-colour-text-primary);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-AreaList__row:hover {
  background: var(--itsm-colour-surface-hover);
}
.itsm-AreaList__row[aria-current="true"] {
  background: var(--itsm-colour-surface-selected);
}
.itsm-AreaList__row:focus-visible {
  outline-offset: calc(-1 * var(--itsm-focus-width));
}
.itsm-AreaList__text {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
}
.itsm-AreaList__name {
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-AreaList__description {
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-subheadline-line);
}
.itsm-AreaList__persona {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
}
.itsm-AreaList__check {
  color: var(--itsm-colour-accent);
}

/* ---- the leaving veil ---- */

html[data-itsm-leaving]::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: var(--itsm-z-tooltip);
  background: var(--itsm-colour-surface-canvas);
  animation: itsm-fade-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}
html[data-itsm-leaving]::after {
  content: attr(data-itsm-leaving);
  content: attr(data-itsm-leaving) / '';
  position: fixed;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  z-index: var(--itsm-z-tooltip);
  box-sizing: border-box;
  inline-size: min(26.25rem, calc(100vw - 2 * var(--itsm-page-gutter)));
  padding: var(--itsm-space-xl);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-block-end: var(--itsm-border-thick) solid var(--itsm-colour-accent);
  border-radius: var(--itsm-radius-3xl);
  background: var(--itsm-colour-surface-raised);
  box-shadow: var(--itsm-elevation-sm);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-text-title2-family);
  font-size: var(--itsm-text-title2-size);
  line-height: var(--itsm-text-title2-line);
  font-weight: var(--itsm-text-title2-weight);
  letter-spacing: var(--itsm-text-title2-tracking);
  text-align: center;
  transform: translate(-50%, -50%);
  animation: itsm-fade-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}

${mq.reducedMotion} {
  html[data-itsm-leaving]::before,
  html[data-itsm-leaving]::after {
    animation: none;
  }
}
${prefers.reducedMotion} html[data-itsm-leaving]::before,
${prefers.reducedMotion} html[data-itsm-leaving]::after {
  animation: none;
}
${mq.forcedColors} {
  .itsm-AreaSwitcher:not([data-display="lockup"]) {
    border-color: ButtonText;
  }
  .itsm-AreaMenu__row[aria-current="true"],
  .itsm-AreaList__row[aria-current="true"] {
    outline: var(--itsm-border-thick) solid Highlight;
    outline-offset: calc(-1 * var(--itsm-border-thick));
  }
  html[data-itsm-leaving]::after {
    border-color: CanvasText;
  }
}
@media print {
  html[data-itsm-leaving]::before,
  html[data-itsm-leaving]::after {
    display: none;
  }
}
`,
);
