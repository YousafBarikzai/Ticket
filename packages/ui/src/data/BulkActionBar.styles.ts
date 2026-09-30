import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `BulkActionBar`.
 *
 * Opaque `surface.overlay` with elevation `lg`, never glass (D6, SPEC §1.3
 * rule b): it sits over rows, and text on glass over text is unreadable.
 *
 * - **float** (admin): a capsule centred at the bottom of the table's
 *   column, sticking to the bottom of the window (above a phone's bottom dock)
 *   while the table is in view. It rises 8 px and fades in over `normal`;
 *   under reduced motion it simply appears.
 * - **dock** (workbench): a full-width bar at the bottom of the list pane,
 *   and in the `BottomDock` on a phone — square-cornered, with a hairline
 *   above instead of a shadow.
 *
 * The count leads in semibold, the actions follow, the × to clear ends it.
 * On a narrow screen the count shortens to its number and the actions keep
 * their words.
 */
export const bulkActionBarStyles = layer(
  'components',
  css`
.itsm-BulkActionBar {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  max-inline-size: 100%;
  min-block-size: calc(var(--itsm-control-height-sm) + 2 * var(--itsm-space-xs));
  padding-block: var(--itsm-space-2xs);
  padding-inline: var(--itsm-space-md) var(--itsm-space-2xs);
  background: var(--itsm-colour-surface-overlay);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}
.itsm-BulkActionBar[data-placement="float"] {
  position: sticky;
  /* Above whatever covers the bottom edge: the dock (whose height already counts the safe area) or, without one, the home indicator. */
  inset-block-end: calc(var(--itsm-space-lg) + max(var(--itsm-bottom-dock-height), var(--itsm-safe-area-bottom)));
  z-index: var(--itsm-z-sticky);
  inline-size: max-content;
  border: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-pill);
  box-shadow: var(--itsm-elevation-lg), var(--itsm-edge-highlight);
  animation: itsm-rise var(--itsm-duration-normal) var(--itsm-easing-entrance);
}
.itsm-BulkActionBar[data-placement="dock"] {
  inline-size: 100%;
  border-block-start: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}

.itsm-BulkActionBar__count {
  flex: none;
  padding-inline-end: var(--itsm-space-xs);
  border-inline-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.itsm-BulkActionBar__actions {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
}
/* A control keeps its words: squeezed, a label would run under its own chevron. */
.itsm-BulkActionBar__actions > * {
  flex: none;
}
.itsm-BulkActionBar__progress {
  flex: 1 1 10rem;
  min-inline-size: 8rem;
}
.itsm-BulkActionBar__clear {
  flex: none;
  margin-inline-start: auto;
}

${mq.belowSm} {
  .itsm-BulkActionBar[data-placement="float"] {
    inline-size: auto;
    max-inline-size: calc(100vw - 2 * var(--itsm-space-md));
  }
  .itsm-BulkActionBar__actions {
    overflow-x: auto;
    scrollbar-width: none;
  }
}
${mq.reducedMotion} {
  .itsm-BulkActionBar[data-placement="float"] {
    animation: none;
  }
}
${prefers.reducedMotion} .itsm-BulkActionBar[data-placement="float"] {
  animation: none;
}
${mq.forcedColors} {
  .itsm-BulkActionBar {
    border: 1px solid CanvasText;
  }
}
`,
);
