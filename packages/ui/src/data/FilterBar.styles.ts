import { css, layer, mq } from '../styles/css.js';

/**
 * `FilterBar`: one row above a list, in the patterns layer.
 *
 * Search, scope, chips, "+ Filter" and "Clear all" flow from the start and
 * wrap; the count, the page's own controls and the View menu hold the end.
 * The bar is its own container: below 40 rem the search field takes a line of
 * its own and the chips wrap beneath it, so it reads the same in a sheet as
 * on a phone.
 *
 * Inside a chip's popover the choices are a listbox of 32 px rows (the
 * nav-item height; 44 on touch) in `callout`: a check in the accent marks
 * what is chosen, the highlighted row is `surface.selected` with an inset
 * ring when the keyboard put it there, and a long list scrolls within the
 * popover rather than the page.
 */
export const filterBarStyles = layer(
  'patterns',
  css`
.itsm-FilterBar {
  container: itsm-filterbar / inline-size;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--itsm-space-xs) var(--itsm-space-sm);
  min-inline-size: 0;
}
.itsm-FilterBar__start,
.itsm-FilterBar__end {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
}
.itsm-FilterBar__start {
  flex: 1 1 auto;
}
.itsm-FilterBar__end {
  flex: 0 1 auto;
  margin-inline-start: auto;
}
.itsm-FilterBar__search {
  flex: 0 1 18rem;
  min-inline-size: 12rem;
}
.itsm-FilterBar__chipSlot {
  display: contents;
}
.itsm-FilterBar__count {
  margin: 0;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

@container itsm-filterbar (width < 40rem) {
  .itsm-FilterBar__search {
    flex-basis: 100%;
  }
  .itsm-FilterBar__end {
    margin-inline-start: 0;
  }
}

/* A chip's options */

.itsm-FilterBar__panel {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
}
.itsm-FilterBar__options {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  max-block-size: 18rem;
  margin-inline: calc(-1 * var(--itsm-space-2xs));
  padding: var(--itsm-space-3xs);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.itsm-FilterBar__option {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  min-block-size: var(--itsm-nav-item-height);
  padding-block: var(--itsm-space-2xs);
  padding-inline: var(--itsm-space-xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  cursor: default;
  user-select: none;
  outline: none;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-FilterBar__option:hover {
  background: var(--itsm-colour-fill-hover);
}
.itsm-FilterBar__option:focus-visible {
  background: var(--itsm-colour-surface-selected);
  outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus);
  outline-offset: calc(-1 * var(--itsm-focus-width));
  box-shadow: none;
}
.itsm-FilterBar__option[aria-selected="true"] {
  font-weight: var(--itsm-font-weight-medium);
}
.itsm-FilterBar__check {
  display: inline-grid;
  place-items: center;
  flex: none;
  inline-size: var(--itsm-icon-sm);
  color: var(--itsm-colour-accent);
}
.itsm-FilterBar__optionIcon {
  flex: none;
  color: var(--itsm-colour-text-secondary);
}
.itsm-FilterBar__option[data-tone="success"] .itsm-FilterBar__optionIcon { color: var(--itsm-colour-success-border); }
.itsm-FilterBar__option[data-tone="warning"] .itsm-FilterBar__optionIcon { color: var(--itsm-colour-warning-border); }
.itsm-FilterBar__option[data-tone="danger"] .itsm-FilterBar__optionIcon { color: var(--itsm-colour-danger-border); }
.itsm-FilterBar__option[data-tone="info"] .itsm-FilterBar__optionIcon { color: var(--itsm-colour-info-border); }
.itsm-FilterBar__option[data-tone="accent"] .itsm-FilterBar__optionIcon { color: var(--itsm-colour-accent); }
.itsm-FilterBar__optionLabel {
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.itsm-FilterBar__none {
  margin: 0;
  padding: var(--itsm-space-xs);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}
.itsm-FilterBar__panelFooter {
  display: flex;
  justify-content: flex-end;
  gap: var(--itsm-space-xs);
  margin-inline: calc(-1 * var(--itsm-space-md));
  padding-block-start: var(--itsm-space-xs);
  padding-inline: var(--itsm-space-md);
  border-block-start: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}

${mq.forcedColors} {
  .itsm-FilterBar__option:focus-visible,
  .itsm-FilterBar__option[aria-selected="true"] {
    outline: 2px solid Highlight;
  }
}
`,
);
