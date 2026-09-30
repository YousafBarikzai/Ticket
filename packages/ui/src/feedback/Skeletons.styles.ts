import { css, layer, mq } from '../styles/css.js';

/**
 * The skeleton family: the frames the bones sit in, the page layouts, and the
 * delayed status.
 *
 * Framed placeholders — a card, a stat, a page's panel — are the same raised
 * surface as the thing they stand in for (`2xl` corners, `xs` elevation), and
 * fade in after the same 200 ms delay as the bones (`itsm-skeleton-reveal`,
 * from `web/Skeleton.styles.ts`), so nothing at all appears for a fast
 * response. Page layouts adapt to their container, not the window: a
 * dashboard's four stats are two by two in a narrow column, the inbox skeleton
 * drops its detail pane below 48 rem.
 *
 * The status (SPEC §4.5): its words are `visibility: hidden` until an
 * animation with a zero duration and a delay flips them — the loading
 * sentence for screen readers at 1 s, "Still loading…" for everybody at
 * 10 s, when the loading sentence goes. A `visibility` change is a change to
 * the accessibility tree, which is what a live region announces. Delays are
 * not motion, so they stay under reduced motion (where the pill's spinner
 * breathes instead of turning, by its own rules).
 */
export const skeletonsStyles = layer(
  'components',
  css`
@keyframes itsm-skeleton-appear {
  to { visibility: visible; }
}

@keyframes itsm-skeleton-vanish {
  to { visibility: hidden; }
}

.itsm-SkeletonShapes {
  display: contents;
}

.itsm-SkeletonStatus {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.itsm-SkeletonStatus__loading {
  visibility: hidden;
  animation: itsm-skeleton-appear 0s linear 1s forwards, itsm-skeleton-vanish 0s linear 10s forwards;
}

.itsm-SkeletonStatus__still {
  visibility: hidden;
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  padding: var(--itsm-space-xs) var(--itsm-space-md);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-surface-overlay);
  box-shadow: var(--itsm-elevation-lg), var(--itsm-edge-highlight);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
  color: var(--itsm-colour-text-secondary);
  animation: itsm-skeleton-appear 0s linear 10s forwards;
}

/* ------------------------------------------------------------- Frames */

.itsm-SkeletonCard,
.itsm-SkeletonStat,
.itsm-SkeletonPage__panel {
  box-sizing: border-box;
  border-radius: var(--itsm-radius-2xl);
  background: var(--itsm-colour-surface-raised);
  box-shadow: var(--itsm-elevation-xs), var(--itsm-edge-highlight);
  animation: itsm-skeleton-reveal var(--itsm-duration-normal) var(--itsm-easing-standard) 200ms both;
}

.itsm-SkeletonCard {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-md);
  padding: var(--itsm-space-lg);
}

.itsm-SkeletonStat {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-sm);
  padding: var(--itsm-space-md) var(--itsm-space-lg);
}

/* ------------------------------------------------------------- Tables and lists */

.itsm-SkeletonTable {
  position: relative;
  display: flex;
  flex-direction: column;
}

.itsm-SkeletonTable__row {
  display: grid;
  align-items: center;
  column-gap: var(--itsm-space-md);
  min-block-size: var(--itsm-row-height);
  border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}

.itsm-SkeletonTable__row[data-header] {
  min-block-size: var(--itsm-control-height-md);
}

.itsm-SkeletonTable__row:last-child {
  border-block-end: 0;
}

.itsm-SkeletonList {
  position: relative;
  display: flex;
  flex-direction: column;
}

.itsm-SkeletonList__row {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  min-block-size: var(--itsm-row-height-2line);
  border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}

.itsm-SkeletonList__row:last-child {
  border-block-end: 0;
}

.itsm-SkeletonList__text {
  flex: 1;
  min-inline-size: 0;
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
}

.itsm-SkeletonList__end {
  align-self: flex-start;
  margin-block-start: var(--itsm-space-sm);
}

.itsm-SkeletonConversation {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-lg);
}

.itsm-SkeletonConversation__message {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-sm);
}

.itsm-SkeletonConversation__bubble {
  flex: 1;
  min-inline-size: 0;
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
}

.itsm-SkeletonConversation__meta {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
}

/* ------------------------------------------------------------- Pages */

.itsm-SkeletonPage {
  position: relative;
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-lg);
  padding-block: var(--itsm-space-lg);
}

.itsm-SkeletonPage > .itsm-SkeletonStatus {
  place-items: start center;
  padding-block-start: var(--itsm-space-4xl);
}

.itsm-SkeletonPage__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--itsm-space-md);
}

.itsm-SkeletonPage__heading {
  flex: 1;
  min-inline-size: 0;
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-sm);
}

.itsm-SkeletonPage__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs);
}

.itsm-SkeletonPage__panel {
  padding: var(--itsm-space-xs) var(--itsm-space-lg);
}

.itsm-SkeletonPage__panel.itsm-SkeletonPage__stack {
  padding-block: var(--itsm-space-lg);
}

.itsm-SkeletonPage__stack {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-md);
}

.itsm-SkeletonPage__split,
.itsm-SkeletonPage__columns,
.itsm-SkeletonPage__panes {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--itsm-space-lg);
  align-items: start;
}

.itsm-SkeletonPage__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--itsm-space-md);
}

.itsm-SkeletonPage__narrow {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-lg);
  inline-size: 100%;
  max-inline-size: var(--itsm-content-narrow);
}

.itsm-SkeletonPage__field {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
}

.itsm-SkeletonPage__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--itsm-space-xs);
}

.itsm-SkeletonPage__setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--itsm-space-md);
  padding-block: var(--itsm-space-md);
  border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}

.itsm-SkeletonPage__setting:last-child {
  border-block-end: 0;
}

.itsm-SkeletonPage__settingText {
  flex: 1;
  min-inline-size: 0;
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
}

.itsm-SkeletonPage__facts {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-md);
  padding-block: var(--itsm-space-lg);
}

.itsm-SkeletonPage__fact {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
}

.itsm-SkeletonPage__workspace {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-lg);
}

.itsm-SkeletonPage__pills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--itsm-space-xs);
  margin-block-start: var(--itsm-space-2xs);
}

.itsm-SkeletonPage__listPane {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-md);
}

.itsm-SkeletonPage__detailPane {
  display: none;
}

@container (min-width: 48rem) {
  .itsm-SkeletonPage__stats {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .itsm-SkeletonPage__columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .itsm-SkeletonPage__panes {
    grid-template-columns: var(--itsm-listpane-width) minmax(0, 1fr);
  }

  .itsm-SkeletonPage__detailPane {
    display: block;
  }
}

@container (min-width: 60rem) {
  .itsm-SkeletonPage__split {
    grid-template-columns: minmax(0, 1fr) var(--itsm-inspector-width);
  }
}

${mq.forcedColors} {
  .itsm-SkeletonCard,
  .itsm-SkeletonStat,
  .itsm-SkeletonPage__panel,
  .itsm-SkeletonStatus__still {
    border: var(--itsm-hairline) solid CanvasText;
  }
}
`,
);
