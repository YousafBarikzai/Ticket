import { css, layer, mq } from '../styles/css.js';
import { moreContrast, toneVariables } from './tone.js';

/** The SLA stripe's colour per state: the intent's border colour, a non-text mark (≥ 3:1 on raised). */
const stripes = (['success', 'warning', 'danger', 'neutral'] as const)
  .map((stripe) => `.itsm-KanbanCard[data-stripe="${stripe}"] { --_itsm-kanban-stripe: var(--itsm-colour-${stripe}-border); }`)
  .join('\n');

/**
 * `KanbanColumn` and `KanbanCard` (v3 §2.13, A1 §7.12), measured from the
 * benchmark board.
 *
 * **Column.** `surface.raisedAlt` with a 1 px `border.subtle` edge (one of
 * the four card classes that must declare it, §2.9) and the 12 px card
 * radius, at least 260 px tall. The 44 px header sticks to the top of the
 * column while the page scrolls: the state icon (18 px, in the intent's
 * border colour), the title 600 13/18, a `Count` drawn raised with a
 * hairline, then `meta` and the fold button. A 22 px sub-row in muted text;
 * then the cards, 8 apart, scrolling inside the column once it is taller
 * than the viewport allows. An empty column is a dashed placeholder.
 *
 * Drop states: `allowed` takes the accent-hover tint with an accent edge,
 * `over` the selected tint, `blocked` mutes the title and shows the "no
 * entry" badge. Folded, the column is a 56 px strip: icon, count, the title
 * written vertically, and a chevron at the foot.
 *
 * **Card.** `surface.raised`, 1 px `border.subtle`, the 10 px `item` radius
 * and the `xs` shadow, padded 12 with 16 at the start to clear the 3 px SLA
 * stripe (inset 8 px top and bottom). Top row 18 px: reference, unread dot,
 * priority chip. Title 500 13/18 over two lines at most. Tag and due chip
 * are 20 px `surface.sunken` capsules; a late due chip is danger, a done one
 * success. A 2 px hairline along the foot shows the SLA time used. Hover
 * raises the edge to `border.soft` and the shadow to `sm` (no lift);
 * selected is the selected tint with an accent edge; the drag ghost is at
 * 45 % opacity. The title's link covers the card, and keyboard focus rings
 * the whole card.
 */
export const kanbanStyles = layer(
  'components',
  css`
.itsm-KanbanColumn {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-inline-size: 0;
  min-block-size: 16.25rem;
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-2xl);
  background: var(--itsm-colour-surface-raisedAlt);
}

${toneVariables('.itsm-KanbanColumn')}

.itsm-KanbanColumn__head {
  position: sticky;
  z-index: 1;
  inset-block-start: 0;
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  min-block-size: 2.75rem;
  padding-block: 0;
  padding-inline: var(--itsm-space-sm) var(--itsm-space-xs);
  border-start-start-radius: inherit;
  border-start-end-radius: inherit;
  background: inherit;
}

.itsm-KanbanColumn__icon {
  flex: none;
  color: var(--_itsm-tone-border);
}

.itsm-KanbanColumn__title {
  min-inline-size: 0;
  margin: 0;
  overflow: hidden;
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-font-weight-semibold);
  letter-spacing: 0;
  word-spacing: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itsm-KanbanColumn .itsm-KanbanColumn__count {
  --_itsm-count-bg: var(--itsm-colour-surface-raised);
  box-shadow: inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-border-subtle);
}

.itsm-KanbanColumn__spacer {
  flex: 1 1 0;
}

.itsm-KanbanColumn__meta {
  display: inline-flex;
  flex: none;
  align-items: center;
}

.itsm-KanbanColumn__blocked {
  display: inline-flex;
  flex: none;
  color: var(--itsm-colour-text-muted);
}

.itsm-KanbanColumn__fold {
  display: inline-grid;
  flex: none;
  place-items: center;
  inline-size: var(--itsm-control-height-sm);
  block-size: var(--itsm-control-height-sm);
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--itsm-radius-md);
  background: transparent;
  color: var(--itsm-colour-text-muted);
  cursor: pointer;
}

.itsm-KanbanColumn__fold:hover {
  background: var(--itsm-colour-fill-hover);
  color: var(--itsm-colour-text-primary);
}

.itsm-KanbanColumn__sub {
  display: flex;
  align-items: center;
  min-block-size: 1.375rem;
  margin: 0;
  padding: 0 var(--itsm-space-sm);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}

.itsm-KanbanColumn__body {
  flex: 1 1 auto;
  min-block-size: 0;
  max-block-size: max(22.5rem, 100dvh - 18rem);
  overflow-y: auto;
  padding: var(--itsm-space-xs);
}

.itsm-KanbanColumn__cards {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
  margin: 0;
  padding: 0;
  list-style: none;
}

.itsm-KanbanColumn__empty {
  margin: 0;
  padding: var(--itsm-space-md);
  border: calc(var(--itsm-border-hair) * 1.5) dashed var(--itsm-colour-border-soft);
  border-radius: var(--itsm-radius-item);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  text-align: center;
}

.itsm-KanbanColumn[data-drop-state="allowed"] {
  border-color: var(--itsm-colour-accent);
  background: var(--itsm-colour-surface-accentHover);
  box-shadow: inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-accent);
}

.itsm-KanbanColumn[data-drop-state="over"] {
  border-color: var(--itsm-colour-accent);
  background: var(--itsm-colour-surface-selected);
  box-shadow: inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-accent);
}

.itsm-KanbanColumn[data-drop-state="blocked"] .itsm-KanbanColumn__title {
  color: var(--itsm-colour-text-muted);
}

.itsm-KanbanColumn[data-folded] {
  flex: none;
  inline-size: 3.5rem;
  min-inline-size: 3.5rem;
}

.itsm-KanbanColumn__strip {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  inline-size: 100%;
  margin: 0;
  padding: var(--itsm-space-sm) 0;
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: var(--itsm-colour-text-primary);
  font: inherit;
  text-decoration: none;
}

:is(button, a).itsm-KanbanColumn__strip {
  cursor: pointer;
}

:is(button, a).itsm-KanbanColumn__strip:hover {
  background: var(--itsm-colour-surface-hover);
}

.itsm-KanbanColumn__strip .itsm-KanbanColumn__icon { order: 0; }
.itsm-KanbanColumn__strip .itsm-KanbanColumn__count { order: 1; }

.itsm-KanbanColumn__stripTitle {
  order: 2;
  writing-mode: vertical-rl;
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-font-weight-semibold);
  white-space: nowrap;
}

.itsm-KanbanColumn__chevron {
  order: 3;
  margin-block-start: auto;
  color: var(--itsm-colour-text-muted);
}

.itsm-KanbanCard {
  --_itsm-kanban-stripe: var(--itsm-colour-neutral-border);
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  box-sizing: border-box;
  min-inline-size: 0;
  padding-block: var(--itsm-space-sm);
  padding-inline: var(--itsm-space-md) var(--itsm-space-sm);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-item);
  background: var(--itsm-colour-surface-raised);
  box-shadow: var(--itsm-elevation-xs);
  overflow: hidden;
  transition:
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard);
}

${stripes}

.itsm-KanbanCard[data-stripe]::before {
  content: '';
  position: absolute;
  inset-block: var(--itsm-space-xs);
  inset-inline-start: 0;
  inline-size: 0.1875rem;
  border-start-end-radius: 0.1875rem;
  border-end-end-radius: 0.1875rem;
  background: var(--_itsm-kanban-stripe);
}

.itsm-KanbanCard[data-late] {
  border-color: var(--itsm-colour-danger-subtle);
}

.itsm-KanbanCard:hover {
  border-color: var(--itsm-colour-border-soft);
  box-shadow: var(--itsm-elevation-sm);
}

.itsm-KanbanCard[data-selected] {
  border-color: var(--itsm-colour-accent);
  background: var(--itsm-colour-surface-selected);
}

.itsm-KanbanCard[data-dragging] {
  opacity: 0.45;
}

.itsm-KanbanCard:has(.itsm-KanbanCard__link:focus-visible) {
  outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus);
  outline-offset: var(--itsm-focus-offset);
}

@supports selector(:has(*)) {
  .itsm-KanbanCard__link:focus-visible {
    outline: none;
    box-shadow: none;
  }
}

.itsm-KanbanCard__top {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-block-size: 1.125rem;
}

.itsm-KanbanCard__ref {
  min-inline-size: 0;
  overflow: hidden;
  color: var(--itsm-colour-text-muted);
  font-family: var(--itsm-text-id-family);
  font-size: var(--itsm-text-id-size);
  line-height: var(--itsm-text-id-line);
  font-weight: var(--itsm-text-id-weight);
  font-variant-numeric: slashed-zero tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itsm-KanbanCard__unread {
  flex: none;
  inline-size: 0.375rem;
  block-size: 0.375rem;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-accent);
}

.itsm-KanbanCard__spacer {
  flex: 1 1 0;
}

.itsm-KanbanCard__menu {
  position: relative;
  z-index: 1;
  display: inline-flex;
  flex: none;
}

.itsm-KanbanCard__link {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-font-weight-medium);
  text-decoration: none;
  overflow-wrap: anywhere;
}

.itsm-KanbanCard__link::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

.itsm-KanbanCard__tag,
.itsm-KanbanCard__due {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  box-sizing: border-box;
  min-block-size: var(--itsm-space-ml);
  padding: 0 0.375rem;
  border-radius: var(--itsm-radius-sm);
  background: var(--itsm-colour-surface-sunken);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  white-space: nowrap;
}

.itsm-KanbanCard__tag {
  align-self: flex-start;
  max-inline-size: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.itsm-KanbanCard__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--itsm-space-xs);
  min-block-size: 1.5rem;
}

.itsm-KanbanCard__assignee {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-inline-size: 0;
  overflow: hidden;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itsm-KanbanCard__assignee[data-unassigned] {
  color: var(--itsm-colour-text-muted);
}

.itsm-KanbanCard__due {
  flex: none;
  margin-inline-start: auto;
  font-variant-numeric: tabular-nums;
}

.itsm-KanbanCard__due[data-state="late"] {
  background: var(--itsm-colour-danger-subtle);
  color: var(--itsm-colour-danger-subtleText);
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-KanbanCard__due[data-state="done"] {
  background: var(--itsm-colour-success-subtle);
  color: var(--itsm-colour-success-subtleText);
}

.itsm-KanbanCard__progress {
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  block-size: var(--itsm-border-thick);
  background: var(--itsm-colour-fill-track);
}

.itsm-KanbanCard__progressFill {
  display: block;
  block-size: 100%;
  background: var(--_itsm-kanban-stripe);
}

${moreContrast((scope) => `${scope} .itsm-KanbanColumn, ${scope} .itsm-KanbanCard { border-color: var(--itsm-colour-border-strong); }
${scope} .itsm-KanbanCard__tag, ${scope} .itsm-KanbanCard__due { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-border-strong); }`)}

${mq.forcedColors} {
  .itsm-KanbanColumn,
  .itsm-KanbanCard {
    border-color: CanvasText;
  }
  .itsm-KanbanColumn[data-drop-state="allowed"],
  .itsm-KanbanColumn[data-drop-state="over"],
  .itsm-KanbanCard[data-selected] {
    border-color: Highlight;
  }
  .itsm-KanbanCard[data-stripe]::before,
  .itsm-KanbanCard__progressFill {
    forced-color-adjust: none;
    background: CanvasText;
  }
  .itsm-KanbanCard__tag,
  .itsm-KanbanCard__due {
    border: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-KanbanCard:has(.itsm-KanbanCard__link:focus-visible) {
    outline-color: Highlight;
  }
}

${mq.reducedMotion} {
  .itsm-KanbanCard {
    transition: none;
  }
}
`,
);
