import { css, layer, mq } from '../styles/css.js';
import { moreContrast } from './tone.js';

/** The six columns: severity · reference · title · reason · owner · due (A1 §7.4). */
const COLUMNS = '1.25rem minmax(5.5rem, auto) minmax(0, 1fr) auto 9.25rem 4rem';
/** Under 30rem: severity · title · owner's avatar · due, with the reference and reason on a second line. */
const NARROW_COLUMNS = '1.25rem minmax(0, 1fr) auto 3.25rem';

/** Hides text from the eye and keeps it for a screen reader (the `.itsm-visually-hidden` declarations). */
const visuallyHidden = `position: absolute;
    inline-size: 1px;
    block-size: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;`;

/**
 * `AttentionList` (v3 §2.13, A1 §7.4), measured from the benchmark's "Needs
 * attention" card.
 *
 * Rows are 50 px or taller, padded 6 × 8 with the `item` radius, divided by
 * `border.divider` hairlines inset 8 px, tinted `surface.hover` on hover and
 * ringed in the accent (inset 2 px) when their link has keyboard focus. The
 * list is a grid and each row a subgrid of it, so references, reasons,
 * owners and due times line up down the card whatever their lengths; where
 * subgrid is missing each row repeats the template.
 *
 * Reference: the `id` style (mono, slashed zero, tabular, muted). Title: 500
 * 13/18, two lines at most. Reason: a 22 px raised-alt chip, or a status
 * pill when it has a tone. Owner: a 24 px avatar and the name; "Unassigned"
 * in `text.muted`. Due: 500 12/16 tabular, end-aligned; overdue in
 * `danger.subtleText` 600 with the slip.
 *
 * Quick actions float over the row's end on a fade into the hover tint,
 * revealed on hover and on focus within the row, so they are reachable by
 * keyboard and visible when reached; on a coarse pointer, where there is no
 * hover, they are always shown on their own line. Every step responds to the
 * list's container (`itsm-attention`), never the viewport.
 */
export const attentionListStyles = layer(
  'components',
  css`
.itsm-AttentionList {
  container: itsm-attention / inline-size;
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-sm);
  min-inline-size: 0;
}

.itsm-AttentionList__tabList {
  display: flex;
  flex-wrap: wrap;
  gap: var(--itsm-space-2xs);
  margin: 0;
  padding: 0;
  list-style: none;
}

.itsm-AttentionList__tab {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  box-sizing: border-box;
  min-block-size: var(--itsm-control-height-sm);
  padding: 0 var(--itsm-space-sm);
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-pill);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-font-weight-medium);
  text-decoration: none;
  white-space: nowrap;
}

.itsm-AttentionList__tab:hover {
  background: var(--itsm-colour-surface-hover);
  color: var(--itsm-colour-text-primary);
}

.itsm-AttentionList__tab[aria-current] {
  border-color: var(--itsm-colour-border-soft);
  background: var(--itsm-colour-surface-raised);
  box-shadow: var(--itsm-elevation-sm);
  color: var(--itsm-colour-text-primary);
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-AttentionList__rows {
  --_itsm-attention-columns: ${COLUMNS};
  display: grid;
  grid-template-columns: var(--_itsm-attention-columns);
  column-gap: 0.625rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.itsm-AttentionList__row {
  position: relative;
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  align-items: center;
  box-sizing: border-box;
  min-block-size: 3.125rem;
  padding: 0.375rem var(--itsm-space-xs);
  border-radius: var(--itsm-radius-item);
}

@supports not (grid-template-columns: subgrid) {
  .itsm-AttentionList__row {
    grid-template-columns: var(--_itsm-attention-columns);
    column-gap: 0.625rem;
  }
}

.itsm-AttentionList__row + .itsm-AttentionList__row::before {
  content: '';
  position: absolute;
  inset-block-start: 0;
  inset-inline: var(--itsm-space-xs);
  border-block-start: var(--itsm-border-hair) solid var(--itsm-colour-border-divider);
  pointer-events: none;
}

.itsm-AttentionList__row:hover,
.itsm-AttentionList__row:focus-within {
  background: var(--itsm-colour-surface-hover);
}

.itsm-AttentionList__row:has(.itsm-AttentionList__link:focus-visible) {
  box-shadow: inset 0 0 0 var(--itsm-border-thick) var(--itsm-colour-border-focus);
}

@supports selector(:has(*)) {
  .itsm-AttentionList__link:focus-visible {
    outline: none;
    box-shadow: none;
  }
}

.itsm-AttentionList__severity {
  color: var(--itsm-colour-text-muted);
}

.itsm-AttentionList__row[data-severity="danger"] .itsm-AttentionList__severity { color: var(--itsm-colour-danger-subtleText); }
.itsm-AttentionList__row[data-severity="warning"] .itsm-AttentionList__severity { color: var(--itsm-colour-warning-subtleText); }
.itsm-AttentionList__row[data-severity="info"] .itsm-AttentionList__severity { color: var(--itsm-colour-info-subtleText); }

.itsm-AttentionList__ref {
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

.itsm-AttentionList__main {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
}

.itsm-AttentionList__link {
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

.itsm-AttentionList__link::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

.itsm-AttentionList__meta {
  display: none;
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}

.itsm-AttentionList__reason {
  display: flex;
  min-inline-size: 0;
}

.itsm-AttentionList__reason .itsm-StatusPill {
  max-inline-size: 11.875rem;
}

.itsm-AttentionList__chip {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  min-block-size: 1.375rem;
  max-inline-size: 11.875rem;
  padding: 0 var(--itsm-space-xs);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-surface-raisedAlt);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itsm-AttentionList__owner {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
}

.itsm-AttentionList__ownerName {
  min-inline-size: 0;
  overflow: hidden;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itsm-AttentionList__ownerName[data-unassigned] {
  color: var(--itsm-colour-text-muted);
}

.itsm-AttentionList__due {
  justify-self: end;
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  font-variant-numeric: tabular-nums;
  text-align: end;
}

.itsm-AttentionList__row[data-overdue] .itsm-AttentionList__due {
  color: var(--itsm-colour-danger-subtleText);
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-AttentionList__slip {
  margin-inline-start: var(--itsm-space-2xs);
}

.itsm-AttentionList__actions {
  position: absolute;
  z-index: 1;
  inset-block: 0;
  inset-inline-end: 0;
  display: flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  padding-inline: 1.375rem var(--itsm-space-xs);
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, var(--itsm-colour-surface-hover) 1.375rem);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-AttentionList__actions:dir(rtl) {
  background: linear-gradient(270deg, transparent, var(--itsm-colour-surface-hover) 1.375rem);
}

.itsm-AttentionList__row:hover .itsm-AttentionList__actions,
.itsm-AttentionList__row:focus-within .itsm-AttentionList__actions {
  opacity: 1;
  pointer-events: auto;
}

${mq.coarse} {
  .itsm-AttentionList__actions {
    position: relative;
    grid-column: 3 / -1;
    justify-content: flex-end;
    padding: var(--itsm-space-2xs) 0 0;
    background: none;
    opacity: 1;
    pointer-events: auto;
  }
  .itsm-AttentionList__actions:dir(rtl) {
    background: none;
  }
}

.itsm-AttentionList__more {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  align-self: flex-start;
  color: var(--itsm-colour-text-link);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-semibold);
  text-decoration: none;
}

.itsm-AttentionList__more:hover {
  text-decoration: underline;
}

@container itsm-attention (width < 38.75rem) {
  .itsm-AttentionList__ownerName {
    ${visuallyHidden}
  }
}

@container itsm-attention (width < 30rem) {
  .itsm-AttentionList__rows {
    display: flex;
    flex-direction: column;
  }
  .itsm-AttentionList__row {
    grid-template-columns: ${NARROW_COLUMNS};
    grid-template-areas:
      "severity main owner due"
      ". ref reason reason";
    column-gap: 0.625rem;
    row-gap: 0.125rem;
  }
  .itsm-AttentionList__severity { grid-area: severity; }
  .itsm-AttentionList__main { grid-area: main; }
  .itsm-AttentionList__owner { grid-area: owner; }
  .itsm-AttentionList__due { grid-area: due; }
  .itsm-AttentionList__ref { grid-area: ref; }
  .itsm-AttentionList__reason { grid-area: reason; }
  .itsm-AttentionList__ref:empty,
  .itsm-AttentionList__reason:empty {
    display: none;
  }
  .itsm-AttentionList__meta {
    display: block;
  }
}

${moreContrast((scope) => `${scope} .itsm-AttentionList__row + .itsm-AttentionList__row::before { border-block-start-color: var(--itsm-colour-border-strong); }
${scope} .itsm-AttentionList__chip { border-color: var(--itsm-colour-border-strong); }`)}

${mq.forcedColors} {
  .itsm-AttentionList__tab[aria-current] {
    border-color: Highlight;
  }
  .itsm-AttentionList__row:has(.itsm-AttentionList__link:focus-visible) {
    outline: var(--itsm-border-thick) solid Highlight;
    outline-offset: calc(var(--itsm-border-thick) * -1);
  }
  .itsm-AttentionList__actions {
    background: Canvas;
  }
}
`,
);
