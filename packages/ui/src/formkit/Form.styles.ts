import { css, layer, mq } from '../styles/css.js';

/**
 * `Form`, its `FormActions` row, and the draft's status line and notice.
 *
 * - The actions row puts the buttons at the end (the primary one last, where
 *   the eye finishes reading a row) and the draft's time at the start, in
 *   `footnote` muted text, so the two never compete.
 * - Sticky (`Form stickyActions`): the row holds to the bottom of the view,
 *   above a docked tab bar and the home indicator. While it floats over
 *   fields it is opaque (SPEC D6: bars carrying actions are never glass) with
 *   a hairline edge and a soft upward shadow; at rest at the end of the form
 *   it is just a row. The change is a colour fade (`fast`), nothing moves.
 * - Busy forms are not dimmed (SPEC §1.10): the submit button carries the
 *   spinner, the form `aria-busy`.
 */
export const formStyles = layer(
  'components',
  css`
.itsm-Form {
  display: block;
  min-inline-size: 0;
}

.itsm-Form > .itsm-FormErrorSummary,
.itsm-Form > .itsm-DraftNotice {
  margin-block-end: var(--itsm-space-lg);
}

.itsm-Form__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs) var(--itsm-space-md);
  margin-block-start: var(--itsm-space-lg);
  padding-block: var(--itsm-space-sm);
}

.itsm-Form__buttons {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--itsm-space-xs);
  margin-inline-start: auto;
}

.itsm-Form__actions[data-sticky] {
  position: sticky;
  inset-block-end: calc(var(--itsm-bottom-dock-height) + var(--itsm-safe-area-bottom));
  z-index: var(--itsm-z-sticky);
  background-color: transparent;
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-Form__actions[data-sticky][data-stuck] {
  background-color: var(--itsm-colour-surface-raised);
  box-shadow:
    0 calc(-1 * var(--itsm-hairline)) 0 var(--itsm-colour-border-subtle),
    var(--itsm-elevation-md);
}

/* Where the actions' own place in the page is, for the stuck test. */
.itsm-Form__sentinel {
  block-size: var(--itsm-hairline);
  margin-block-start: calc(-1 * var(--itsm-hairline));
  pointer-events: none;
}

/* The primary action takes the width on a phone, where a thumb reaches for it. */
${mq.belowSm} {
  .itsm-Form__buttons {
    flex: 1 1 100%;
  }
  .itsm-Form__buttons > .itsm-Button--primary {
    flex: 1 1 auto;
  }
}

.itsm-DraftStatus {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  margin: 0;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-muted);
}

.itsm-DraftStatus__icon {
  flex: none;
  color: var(--itsm-colour-success-subtleText);
}

.itsm-Form > .itsm-Form__status {
  margin-block-start: var(--itsm-space-sm);
}

${mq.forcedColors} {
  .itsm-Form__actions[data-sticky][data-stuck] {
    background-color: Canvas;
    box-shadow: none;
    border-block-start: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-DraftStatus__icon {
    color: CanvasText;
  }
}
`,
);
