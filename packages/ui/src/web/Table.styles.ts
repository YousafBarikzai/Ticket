import { css, layer, mq } from '../styles/css.js';

/**
 * `Table`: a quiet property table.
 *
 * Cells in `callout` with tabular figures, headers in `subheadline` (13/18,
 * 500) in `text.secondary`, sentence case, rows the density's row height
 * (44 comfortable, 36 compact, 48 on a touch screen) divided by hairlines.
 * No header fill and no zebra stripes: the hairlines and the alignment do the
 * work (SPEC §1.1, depth and separation without borders everywhere).
 *
 * Rows answer hover with `surface.hover` and nothing else — no lift. The old
 * lift was a transform that out-ranked the reduced-motion rule, so rows moved
 * for people who had asked for nothing to move; a background cannot. A
 * selected row is `surface.selected` with the 3 px accent bar at its start
 * and semibold text (SPEC §1.10). A focused row (an interactive table's roving
 * row) draws its ring inside the row, where the scroll container cannot clip
 * it.
 *
 * The table scrolls sideways inside its own box on a narrow screen rather
 * than widening the page.
 */
export const tableStyles = layer(
  'components',
  css`
.itsm-Table__scroll {
  max-inline-size: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}

.itsm-Table {
  inline-size: 100%;
  border-collapse: collapse;
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  font-variant-numeric: tabular-nums;
}

.itsm-Table caption {
  padding-block-end: var(--itsm-space-xs);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  font-weight: var(--itsm-text-subheadline-weight);
  text-align: start;
}

.itsm-Table th,
.itsm-Table td {
  padding: var(--itsm-space-xs) var(--itsm-space-sm);
  border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  text-align: start;
  vertical-align: middle;
}

.itsm-Table :is(th, td)[data-align="end"] {
  text-align: end;
}

.itsm-Table thead th {
  padding-block: var(--itsm-space-xs);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  font-weight: var(--itsm-text-subheadline-weight);
  white-space: nowrap;
}

.itsm-Table tbody tr {
  block-size: var(--itsm-row-height);
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-Table tbody tr:last-child > :is(th, td) {
  border-block-end: 0;
}

.itsm-Table tbody tr:hover {
  background: var(--itsm-colour-surface-hover);
}

.itsm-Table tbody tr[data-activatable] {
  cursor: pointer;
}

.itsm-Table tbody tr[aria-selected="true"] {
  background: var(--itsm-colour-surface-selected);
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-Table tbody tr[aria-selected="true"] > :first-child {
  box-shadow: inset calc(var(--itsm-border-thick) + 1px) 0 0 0 var(--itsm-colour-accent);
}

.itsm-Table tbody tr[aria-selected="true"] > :first-child:dir(rtl) {
  box-shadow: inset calc(-1 * (var(--itsm-border-thick) + 1px)) 0 0 0 var(--itsm-colour-accent);
}

.itsm-Table tbody tr:focus-visible {
  outline-offset: calc(-1 * var(--itsm-focus-width));
  box-shadow: none;
}

.itsm-Table__emptyRow > td {
  padding-block: var(--itsm-space-lg);
  color: var(--itsm-colour-text-muted);
  text-align: center;
}

.itsm-Table tbody :is(.itsm-Table__emptyRow, .itsm-Table__skeletonRow):hover {
  background: transparent;
}

${mq.forcedColors} {
  .itsm-Table tbody tr[aria-selected="true"] > :first-child {
    border-inline-start: calc(var(--itsm-border-thick) + 1px) solid Highlight;
  }
}
`,
);
