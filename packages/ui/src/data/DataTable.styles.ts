import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * A pointer that can hover: where row controls wait for the pointer. On a
 * touch screen they are always there (X-95), so this is not `mq.coarse`'s
 * opposite — a stylus that cannot hover counts as touch here.
 */
const HOVER = '@media (hover: hover) and (pointer: fine)';

/**
 * The rows as cards, for a container narrower than `cardBelow`. Written once
 * and emitted twice: inside the container query for the default 640 px, and
 * under `[data-layout="cards"]` for a table that measured itself against a
 * breakpoint of its own.
 *
 * The DOM stays the table's — same order, same controls, same keyboard — and
 * the row becomes a wrapping flex line: title and badge on the first line,
 * the subtitle under them, the meta cells on one line separated by middots.
 * The checkbox and ⋯ keep their places at the card's two edges. The column
 * headers go (sorting is in the View menu), and each meta cell speaks its
 * column's name instead, from a label that is visually hidden here and
 * absent in the table layout.
 */
function cards(scope: string): string {
  return `
${scope} .itsm-DataTable__table,
${scope} .itsm-DataTable__table > tbody,
${scope} .itsm-DataTable__stateRow,
${scope} .itsm-DataTable__stateRow > td,
${scope} .itsm-DataTable__groupRow,
${scope} .itsm-DataTable__groupRow > th {
  display: block;
}
${scope} .itsm-DataTable__table > thead {
  display: none;
}
${scope} :is(.itsm-DataTable__row, .itsm-DataTable__skeletonRow) {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: var(--itsm-space-xs);
  row-gap: var(--itsm-space-3xs);
  min-block-size: var(--itsm-row-height-2line);
  padding-block: var(--itsm-space-sm);
  padding-inline: var(--itsm-space-md);
  border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-divider);
}
${scope} :is(.itsm-DataTable__row, .itsm-DataTable__skeletonRow):last-child {
  border-block-end: 0;
}
${scope}[data-selectable]:is([data-select-mode], [data-any-selected]) :is(.itsm-DataTable__row, .itsm-DataTable__skeletonRow) {
  padding-inline-start: calc(var(--itsm-space-md) + var(--_select));
}
${HOVER} {
  ${scope}[data-selectable] :is(.itsm-DataTable__row, .itsm-DataTable__skeletonRow) {
    padding-inline-start: calc(var(--itsm-space-md) + var(--_select));
  }
}
${scope}[data-has-menu] :is(.itsm-DataTable__row, .itsm-DataTable__skeletonRow) {
  padding-inline-end: calc(var(--itsm-space-xs) + var(--itsm-control-height-sm) + var(--itsm-space-xs));
}
${scope} :is(.itsm-DataTable__row, .itsm-DataTable__skeletonRow) > :is(td, th) {
  display: block;
  block-size: auto;
  min-inline-size: 0;
  padding: 0;
  border: 0;
  text-align: start;
  background: transparent;
}
${scope} [data-card-role="title"] {
  order: 1;
  flex: 1 1 0;
  font-weight: var(--itsm-font-weight-medium);
}
${scope} [data-card-role="badge"] {
  order: 2;
  flex: none;
}
${scope} :is(.itsm-DataTable__row, .itsm-DataTable__skeletonRow)::after {
  content: "";
  order: 3;
  flex-basis: 100%;
}
${scope} [data-card-role="subtitle"] {
  order: 4;
  flex-basis: 100%;
  color: var(--itsm-colour-text-secondary);
}
${scope} [data-card-role="meta"] {
  order: 5;
  flex: none;
  max-inline-size: 100%;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}
${scope} :is(.itsm-DataTable__row, .itsm-DataTable__skeletonRow):has([data-card-role="meta"]) {
  column-gap: var(--itsm-space-sm);
}
${scope} [data-card-role="title"] + [data-card-role="badge"] {
  margin-inline-start: calc(var(--itsm-space-xs) - var(--itsm-space-sm));
}
/* As heavy as the cell rule above (row > cell), or its display: block wins and a hidden cell shows. */
${scope} :is(.itsm-DataTable__row, .itsm-DataTable__skeletonRow) > :is([data-card-role="hidden"], [data-hide-below]) {
  display: none;
}
${scope} .itsm-DataTable__cellLabel {
  display: inline;
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
${scope} :is([data-kind="number"], [data-kind="percent"], [data-kind="currency"], [data-kind="duration"], [data-kind="progress"], [data-kind="boolean"]) > .itsm-DataTable__cellLabel {
  position: static;
  inline-size: auto;
  block-size: auto;
  overflow: visible;
  clip-path: none;
  color: var(--itsm-colour-text-muted);
}
/* As a card, the row draws its bar itself: its first cell is the checkbox in the corner. */
${scope} .itsm-DataTable__row:is([data-current], [data-accent])::before {
  content: "";
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  inline-size: var(--_bar-width);
  background: var(--_bar);
  pointer-events: none;
}
${scope} .itsm-DataTable__row > :first-child::before {
  content: none;
}
${scope} .itsm-DataTable__selectCell {
  position: absolute;
  inset-block-start: var(--itsm-space-sm);
  inset-inline-start: var(--itsm-space-sm);
  inline-size: auto;
}
${scope} .itsm-DataTable__actionsCell {
  position: absolute;
  inset-block-start: calc(var(--itsm-space-sm) - var(--itsm-space-3xs));
  inset-inline-end: var(--itsm-space-xs);
  inline-size: auto;
}
${scope} .itsm-DataTable__groupRow > th {
  padding-block: var(--itsm-space-xs);
  padding-inline: var(--itsm-space-md);
}
${scope} .itsm-DataTable__stateRow > td {
  padding-block: var(--itsm-space-lg);
  padding-inline: var(--itsm-space-md);
}
`;
}

/**
 * `DataTable`: the admin list, in the patterns layer (it is built from the
 * components and adjusts a few of them in place). v3 §2.14, A1 §7.11.
 *
 * - **Frame.** A raised card on the canvas with a 1 px `border.subtle` and
 *   radius `2xl` (12), and no shadow: depth is border-first. Clipped to its
 *   corners with `overflow: clip`, which — unlike `hidden` — is not a scroll
 *   container, so the header can still stick to the window. The table
 *   scrolls sideways inside it only when it is wider than the frame; while it
 *   fits the scroller is `visible` for the same reason. In a `Card bleed`
 *   (`bleed`) the frame gives up its edge and corners to the card's.
 * - **Header.** A 36 px band on `surface.raisedAlt`, opaque, never glass
 *   (D6): 600 12/16 in `text.muted`, sentence case, a `border.subtle` rule
 *   under it, and the `md` shadow once it has stuck. It sticks at
 *   `--itsm-frame-top` — under the top bar, and under the demo's system bar
 *   where one is on the page at ≥ 48rem (the one offset line here). Sortable
 *   headers show `chevrons-up-down` at 55 %; a sorted one its arrow in
 *   `text.primary`; the state itself is `aria-sort` on the cell.
 * - **Rows.** The density's row height (40, 32 compact, 48 on touch; a
 *   two-line title grows to 52), `callout` 13/20 in `text.secondary` with
 *   tabular figures, `border.divider` between. Hover is `surface.hover` and
 *   nothing moves. Checked rows take `surface.selected`; the row whose
 *   drawer is open adds the 3 px accent bar (a `::before` at the inline
 *   start, so right-to-left mirrors) and a semibold title. A critical row
 *   (`accent`) draws the same bar in its tone's border colour.
 * - **Cells.** `title` 500 `text.primary`; `mono` the `id` style; `due`
 *   turns `danger.subtleText` 600 with its slip once late; `type` is a
 *   22 px sunken chip. No rings in rows (X-33).
 * - **Controls.** Row checkboxes and ⋯ appear on hover and focus, for every
 *   row once any is checked, and on touch screens through the "Select"
 *   toggle; the primary link's hit area stretches over its whole cell.
 * - **Live rows** fade from `surface.selected` over 1.2 s — colour only;
 *   under reduced motion a static dot marks them instead.
 * - **Refetch** is the 2 px line on the frame's top edge. No rule here ever
 *   changes a row's opacity (X-74).
 */
export const dataTableStyles = layer(
  'patterns',
  css`
@keyframes itsm-DataTable-flash-odd {
  from { background-color: var(--itsm-colour-surface-selected); }
  to { background-color: var(--itsm-colour-surface-raised); }
}
@keyframes itsm-DataTable-flash-even {
  from { background-color: var(--itsm-colour-surface-selected); }
  to { background-color: var(--itsm-colour-surface-raised); }
}

.itsm-DataTable {
  --_select: calc(var(--itsm-control-height-sm) + var(--itsm-space-sm));
  --_lead: 0px;
  --_sticky-top: calc(var(--itsm-frame-top));
  /* The header band: 36 px at every density. */
  --_header: 2.25rem;
  --_bar-width: calc(var(--itsm-border-thick) + 1px);
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-sm);
  min-inline-size: 0;
  color: var(--itsm-colour-text-primary);
}
.itsm-DataTable[data-selectable] {
  --_lead: var(--_select);
}
:where([role="dialog"], [role="alertdialog"]) .itsm-DataTable {
  --_sticky-top: 0px;
}

.itsm-DataTable__toolbar {
  min-inline-size: 0;
}

/* The honest sort note, under the toolbar. */

.itsm-DataTable__note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs);
  margin: 0;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}
.itsm-DataTable__sortNote {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-2xs);
}
.itsm-DataTable__sortNote > .itsm-Icon {
  color: var(--itsm-colour-text-muted);
}
.itsm-DataTable__loadAll {
  margin-inline-start: var(--itsm-space-2xs);
}
.itsm-DataTable__problemLine {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs);
}

/* The frame */

.itsm-DataTable__frame {
  container: itsm-datatable / inline-size;
  position: relative;
  min-inline-size: 0;
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-2xl);
  background: var(--itsm-colour-surface-raised);
  overflow: clip;
}
/* In a \`Card bleed\`: the card is the frame; the toolbar and notes keep the card's padding. */
.itsm-DataTable[data-bleed] > .itsm-DataTable__frame {
  border: 0;
  border-radius: inherit;
}
.itsm-DataTable[data-bleed] > :is(.itsm-DataTable__toolbar, .itsm-DataTable__note, .itsm-InlineAlert, .itsm-LoadMore, .itsm-OlderNewer, .itsm-DataTable__pager) {
  padding-inline: var(--itsm-card-padding);
}
.itsm-DataTable__refresh {
  position: absolute;
  inset-block-start: 0;
  inset-inline: 0;
  z-index: 4;
}
.itsm-DataTable__sentinel {
  block-size: 0;
}
.itsm-DataTable__scroll {
  max-inline-size: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
.itsm-DataTable__scroll[data-fits] {
  overflow: visible;
}

/* The table */

.itsm-DataTable__table {
  inline-size: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  font-variant-numeric: tabular-nums;
}
.itsm-DataTable__caption {
  caption-side: top;
  padding: var(--itsm-space-md) var(--itsm-space-md) var(--itsm-space-xs);
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  letter-spacing: var(--itsm-text-headline-tracking);
  font-weight: var(--itsm-text-headline-weight);
  text-align: start;
}

.itsm-DataTable__head :is(th, td) {
  position: sticky;
  inset-block-start: var(--_sticky-top);
  z-index: 2;
  box-sizing: border-box;
  block-size: var(--_header);
  padding-block: 0;
  padding-inline: var(--itsm-space-sm);
  border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  background: var(--itsm-colour-surface-raisedAlt);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: 0;
  font-weight: var(--itsm-font-weight-semibold);
  text-align: start;
  vertical-align: middle;
  white-space: nowrap;
  transition: box-shadow var(--itsm-duration-normal) var(--itsm-easing-standard);
}
.itsm-DataTable__head[data-stuck] :is(th, td) {
  box-shadow: var(--itsm-elevation-md);
  clip-path: inset(0 -1px -24px -1px);
}

.itsm-DataTable__sort {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  max-inline-size: 100%;
  margin-block: calc(-1 * var(--itsm-space-3xs));
  margin-inline: calc(-1 * var(--itsm-space-2xs));
  padding-block: var(--itsm-space-3xs);
  padding-inline: var(--itsm-space-2xs);
  border: 0;
  border-radius: var(--itsm-radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-DataTable__sort:hover {
  background: var(--itsm-colour-fill-hover);
  color: var(--itsm-colour-text-primary);
}
.itsm-DataTable__sort:active {
  background: var(--itsm-colour-fill-pressed);
}
.itsm-DataTable__sort[data-active] {
  color: var(--itsm-colour-text-primary);
}
.itsm-DataTable__sortIcon {
  flex: none;
  color: var(--itsm-colour-text-muted);
  opacity: 0.55;
  transition: opacity var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-DataTable__sort:is(:hover, :focus-visible) .itsm-DataTable__sortIcon {
  opacity: 1;
}
.itsm-DataTable__sort[data-active] .itsm-DataTable__sortIcon {
  color: var(--itsm-colour-text-primary);
  opacity: 1;
}

/* Rows and cells */

.itsm-DataTable__row {
  background: var(--itsm-colour-surface-raised);
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-DataTable__table > tbody > tr > :is(td, th) {
  box-sizing: border-box;
  block-size: var(--itsm-row-height);
  padding-block: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  padding-inline: var(--itsm-space-sm);
  border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-divider);
  color: var(--itsm-colour-text-secondary);
  font-weight: var(--itsm-font-weight-regular);
  text-align: start;
  vertical-align: middle;
}
.itsm-DataTable__table > tbody > tr > :is(.itsm-DataTable__primaryCell, [data-kind="title"]) {
  color: var(--itsm-colour-text-primary);
}
.itsm-DataTable__table > tbody:last-child > tr:last-child > :is(td, th) {
  border-block-end: 0;
}
.itsm-DataTable__table tr > :first-child {
  padding-inline-start: var(--itsm-space-md);
}
.itsm-DataTable__table tr > :last-child {
  padding-inline-end: var(--itsm-space-md);
}
.itsm-DataTable__table :is(th, td)[data-align="end"] {
  text-align: end;
}
.itsm-DataTable__table :is(th, td)[data-align="center"] {
  text-align: center;
}

.itsm-DataTable__row[data-activatable] {
  cursor: pointer;
}
${HOVER} {
  .itsm-DataTable__row:hover {
    background: var(--itsm-colour-surface-hover);
  }
}
.itsm-DataTable__row:has(:focus-visible) {
  background: var(--itsm-colour-surface-hover);
}
.itsm-DataTable__row[data-selected] {
  background: var(--itsm-colour-surface-selected);
}
.itsm-DataTable__row[data-current] {
  background: var(--itsm-colour-surface-selected);
}

/* The 3 px bar: on the first cell (a row's own ::before would grow a column), at inline-start so RTL mirrors. */
.itsm-DataTable__row[data-accent="neutral"] { --_bar: var(--itsm-colour-neutral-border); }
.itsm-DataTable__row[data-accent="accent"] { --_bar: var(--itsm-colour-accent); }
.itsm-DataTable__row[data-accent="info"] { --_bar: var(--itsm-colour-info-border); }
.itsm-DataTable__row[data-accent="success"] { --_bar: var(--itsm-colour-success-border); }
.itsm-DataTable__row[data-accent="warning"] { --_bar: var(--itsm-colour-warning-border); }
.itsm-DataTable__row[data-accent="danger"] { --_bar: var(--itsm-colour-danger-border); }
.itsm-DataTable__row[data-accent="hold"] { --_bar: var(--itsm-colour-hold-border); }
.itsm-DataTable__row[data-accent="high"] { --_bar: var(--itsm-colour-high-border); }
.itsm-DataTable__row[data-current] { --_bar: var(--itsm-colour-accent); }
.itsm-DataTable__row:is([data-current], [data-accent]) > :first-child {
  position: relative;
}
.itsm-DataTable__row:is([data-current], [data-accent]) > :first-child::before {
  content: "";
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  inline-size: var(--_bar-width);
  background: var(--_bar);
  pointer-events: none;
}
.itsm-DataTable__row[data-current] .itsm-DataTable__primary {
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-DataTable__row[data-flash="odd"] {
  animation: itsm-DataTable-flash-odd 1.2s var(--itsm-easing-standard);
}
.itsm-DataTable__row[data-flash="even"] {
  animation: itsm-DataTable-flash-even 1.2s var(--itsm-easing-standard);
}
.itsm-DataTable__updated {
  display: none;
  inline-size: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  block-size: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  margin-inline-end: var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-accent);
  vertical-align: middle;
}
${mq.reducedMotion} {
  .itsm-DataTable__row[data-flash] {
    animation: none;
  }
  .itsm-DataTable__updated {
    display: inline-block;
  }
}
${prefers.reducedMotion} .itsm-DataTable__row[data-flash] {
  animation: none;
}
${prefers.reducedMotion} .itsm-DataTable__updated {
  display: inline-block;
}

/*
 * A control the keyboard scrolls to stops clear of the sticky header (and a
 * group's heading) above and of the floating bulk bar below, rather than
 * landing under either.
 */
.itsm-DataTable__table > tbody :is(a[href], button, input, summary) {
  scroll-margin-block-start: calc(var(--_sticky-top) + var(--_header) + var(--itsm-space-xs));
  scroll-margin-block-end: calc(var(--itsm-space-3xl) + var(--itsm-bottom-dock-height, 0px));
}
.itsm-DataTable__table > tbody.itsm-DataTable__group :is(a[href], button, input, summary) {
  scroll-margin-block-start: calc(var(--_sticky-top) + 2 * var(--_header) + var(--itsm-space-xs));
}

/* The primary control: the row's link or button, its hit area the whole cell. */

.itsm-DataTable__primaryCell {
  position: relative;
}
.itsm-DataTable__primary {
  display: inline;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--itsm-radius-xs);
  background: none;
  color: inherit;
  font: inherit;
  font-weight: var(--itsm-font-weight-medium);
  letter-spacing: inherit;
  text-align: start;
  text-decoration: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.itsm-DataTable__primary::after {
  content: "";
  position: absolute;
  inset: 0;
}
.itsm-DataTable__titleText,
.itsm-DataTable__text {
  overflow-wrap: anywhere;
}
.itsm-DataTable__stack {
  display: inline-flex;
  flex-direction: column;
  vertical-align: middle;
}
.itsm-DataTable__secondary {
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-regular);
}
.itsm-DataTable__clamp {
  max-inline-size: 28rem;
}
.itsm-DataTable__clamp :is(.itsm-DataTable__titleText, .itsm-DataTable__text) {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
  overflow: hidden;
}
.itsm-DataTable__clamp[data-lines="2"] :is(.itsm-DataTable__titleText, .itsm-DataTable__text) {
  -webkit-line-clamp: 2;
}

/* Cell kinds */

.itsm-DataTable__empty {
  color: var(--itsm-colour-text-muted);
}
.itsm-DataTable__mono {
  font-family: var(--itsm-text-id-family);
  font-size: var(--itsm-text-id-size);
  line-height: var(--itsm-text-id-line);
  font-weight: var(--itsm-text-id-weight);
  font-variant-numeric: slashed-zero tabular-nums;
  color: var(--itsm-colour-text-muted);
  overflow-wrap: anywhere;
}
.itsm-DataTable__due[data-overdue] {
  color: var(--itsm-colour-danger-subtleText);
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-DataTable__slip {
  margin-inline-start: var(--itsm-space-2xs);
  font-weight: var(--itsm-font-weight-medium);
}
.itsm-DataTable__type {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  box-sizing: border-box;
  block-size: 1.375rem;
  padding-inline: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  border-radius: var(--itsm-radius-sm);
  background: var(--itsm-colour-surface-sunken);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  white-space: nowrap;
  vertical-align: middle;
}
.itsm-DataTable__typeIcon {
  flex: none;
  color: var(--itsm-colour-text-muted);
}
.itsm-DataTable__person,
.itsm-DataTable__channel,
.itsm-DataTable__boolean {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  vertical-align: middle;
}
.itsm-DataTable__channel,
.itsm-DataTable__boolean {
  gap: var(--itsm-space-2xs);
}
.itsm-DataTable__channel > .itsm-Icon,
.itsm-DataTable__boolean > .itsm-Icon {
  color: var(--itsm-colour-text-secondary);
}
.itsm-DataTable__boolean[data-value="false"] {
  color: var(--itsm-colour-text-secondary);
}
.itsm-DataTable__tags {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-2xs);
  vertical-align: middle;
}
.itsm-DataTable__more {
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
}
.itsm-DataTable__link {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-3xs);
  border-radius: var(--itsm-radius-xs);
  color: var(--itsm-colour-text-link);
  text-decoration: none;
}
.itsm-DataTable__link:hover {
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
.itsm-DataTable__progress {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  vertical-align: middle;
}
.itsm-DataTable__progressTrack {
  position: relative;
  inline-size: 4rem;
  block-size: var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-fill-track);
  box-shadow: var(--itsm-track-ring);
  overflow: hidden;
}
.itsm-DataTable__progressFill {
  display: block;
  block-size: 100%;
  border-radius: inherit;
  background: var(--itsm-colour-accent);
}
.itsm-DataTable__progressValue {
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
}
.itsm-DataTable__cellLabel {
  display: none;
}

/* Selection and the row menu */

.itsm-DataTable__table :is(td, th).itsm-DataTable__selectCell {
  inline-size: var(--_select);
  padding-inline-end: 0;
}
.itsm-DataTable__table :is(td, th).itsm-DataTable__actionsCell {
  inline-size: calc(var(--itsm-control-height-sm) + var(--itsm-space-md));
  padding-inline-start: var(--itsm-space-2xs);
  padding-inline-end: var(--itsm-space-xs);
  text-align: end;
}
.itsm-DataTable__checkbox {
  padding-block: 0;
  transition: opacity var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-DataTable__menuButton {
  transition:
    opacity var(--itsm-duration-fast) var(--itsm-easing-standard),
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
${HOVER} {
  .itsm-DataTable:not([data-any-selected]) .itsm-DataTable__row:not(:hover):not(:focus-within) .itsm-DataTable__checkbox,
  .itsm-DataTable:not([data-any-selected]) .itsm-DataTable__table:not(:hover):not(:focus-within) > thead .itsm-DataTable__checkbox {
    opacity: 0;
  }
  .itsm-DataTable__row:not(:hover):not(:focus-within) .itsm-DataTable__menuButton:not([data-state="open"]) {
    opacity: 0;
  }
}
${mq.coarse} {
  .itsm-DataTable:not([data-select-mode]):not([data-any-selected]) .itsm-DataTable__selectCell {
    display: none;
  }
}
.itsm-DataTable__selectToggle {
  display: none;
}
${mq.coarse} {
  .itsm-DataTable__selectToggle {
    display: inline-flex;
  }
}

/* Columns pinned while the table scrolls sideways (only then: while it fits, nothing needs pinning). */

.itsm-DataTable__scroll:not([data-fits]) :is(td, th).itsm-DataTable__selectCell {
  position: sticky;
  inset-inline-start: 0;
  z-index: 1;
  background: inherit;
}
.itsm-DataTable__scroll:not([data-fits]) :is(td, th).itsm-DataTable__primaryCell {
  position: sticky;
  inset-inline-start: var(--_lead);
  z-index: 1;
  background: inherit;
}
.itsm-DataTable__scroll:not([data-fits]) :is(td, th).itsm-DataTable__actionsCell {
  position: sticky;
  inset-inline-end: 0;
  z-index: 1;
  background: inherit;
}
.itsm-DataTable__scroll:not([data-fits]) .itsm-DataTable__head :is(th, td) {
  z-index: 3;
  background: var(--itsm-colour-surface-raisedAlt);
}

/* Groups */

.itsm-DataTable__groupRow > th {
  position: sticky;
  inset-block-start: calc(var(--_sticky-top) + var(--_header));
  z-index: 1;
  padding-block: var(--itsm-space-xs);
  padding-inline: var(--itsm-space-md);
  border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  background: var(--itsm-colour-surface-raisedAlt);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: 0;
  font-weight: var(--itsm-font-weight-semibold);
  text-align: start;
}
.itsm-DataTable__groupCount {
  margin-inline-start: var(--itsm-space-xs);
  vertical-align: middle;
}

/* States inside the table */

.itsm-DataTable__table > tbody > .itsm-DataTable__stateRow > td {
  block-size: auto;
  padding-block: var(--itsm-space-xl);
  border-block-end: 0;
}
.itsm-DataTable__stateRow,
.itsm-DataTable__skeletonRow {
  background: var(--itsm-colour-surface-raised);
}
.itsm-DataTable__skeletonRow > [data-align="end"] > .itsm-Skeleton {
  margin-inline-start: auto;
}
.itsm-DataTable__spacer > td {
  padding: 0;
  border: 0;
}

/* After the table */

.itsm-DataTable__pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--itsm-space-sm);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  font-variant-numeric: tabular-nums;
}
.itsm-DataTable__bulk {
  align-self: center;
}

/*
 * The one-time keyboard hint: a small capsule at the bottom of the window
 * while focus is in the rows, until the arrow keys have been used once. It is
 * the table's description as well, so a screen reader hears it on entry.
 */
.itsm-DataTable__hint {
  position: fixed;
  inset-block-end: calc(var(--itsm-space-lg) + max(var(--itsm-bottom-dock-height), var(--itsm-safe-area-bottom)));
  inset-inline-start: 50%;
  z-index: var(--itsm-z-toast);
  max-inline-size: calc(100vw - 2 * var(--itsm-space-md));
  padding-block: var(--itsm-space-2xs);
  padding-inline: var(--itsm-space-sm);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-surface-inverse);
  box-shadow: var(--itsm-elevation-lg);
  color: var(--itsm-colour-text-inverse);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  white-space: nowrap;
  pointer-events: none;
  translate: -50% 0;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity var(--itsm-duration-normal) var(--itsm-easing-standard),
    visibility 0s linear var(--itsm-duration-normal);
}
.itsm-DataTable__hint:dir(rtl) {
  translate: 50% 0;
}
.itsm-DataTable:not([data-any-selected]):has(.itsm-DataTable__table > tbody :focus-visible) .itsm-DataTable__hint {
  opacity: 1;
  visibility: visible;
  transition-delay: 0s;
}

/* Columns that drop out of a narrow container */

@container itsm-datatable (width < 30rem) {
  .itsm-DataTable [data-hide-below="sm"] { display: none; }
}
@container itsm-datatable (width < 48rem) {
  .itsm-DataTable [data-hide-below="md"] { display: none; }
}
@container itsm-datatable (width < 64rem) {
  .itsm-DataTable [data-hide-below="lg"] { display: none; }
}
@container itsm-datatable (width < 80rem) {
  .itsm-DataTable [data-hide-below="xl"] { display: none; }
}

/* Rows as cards */

@container itsm-datatable (width < 40rem) {
${cards('.itsm-DataTable[data-card-below="640"]')}
}
${cards('.itsm-DataTable[data-layout="cards"]')}

${mq.forcedColors} {
  .itsm-DataTable__frame {
    border: 1px solid CanvasText;
  }
  .itsm-DataTable__row:is([data-current], [data-accent]) > :first-child::before,
  .itsm-DataTable__row:is([data-current], [data-accent])::before {
    forced-color-adjust: none;
    background: Highlight;
  }
  .itsm-DataTable__row[data-current] > :first-child,
  .itsm-DataTable__row[data-selected] > :first-child {
    border-inline-start: calc(var(--itsm-border-thick) + 1px) solid Highlight;
  }
  .itsm-DataTable__hint {
    border: 1px solid CanvasText;
  }
}
`,
);
