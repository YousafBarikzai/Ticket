import { css, layer, mq } from '../styles/css.js';

/**
 * `Toaster`: the design system's card inside sonner's stacking.
 *
 * The surface is on sonner's list item (`.itsm-Toaster__item`), so the
 * collapsed pile behind the front toast shows as cards rather than as
 * nothing: opaque `surface.overlay` (D6 — toasts are never glass), a
 * `border.subtle` hairline, radius `xl`, elevation `lg`. The content is laid
 * out by `.itsm-Toaster__toast`: tone icon, title in `callout` semibold, the
 * description in `text.secondary`, actions under the text, a dismiss button
 * at the end.
 *
 * Tone icons use each intent's `subtleText`, the variant audited on the
 * overlay surface in every theme. Where sonner's own selectors need
 * overriding (motion, width, focus ring), that is in `styles/vendor.styles.ts`,
 * unlayered, because sonner's injected rules are unlayered too.
 */
export const toasterStyles = layer(
  'components',
  css`
.itsm-Toaster__item {
  box-sizing: border-box;
  border: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-xl);
  background: var(--itsm-colour-surface-overlay);
  color: var(--itsm-colour-text-primary);
  box-shadow: var(--itsm-elevation-lg), var(--itsm-edge-highlight);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}

.itsm-Toaster__toast {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-sm);
  padding: var(--itsm-space-sm) var(--itsm-space-xs) var(--itsm-space-sm) var(--itsm-space-md);
}
.itsm-Toaster__icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  block-size: var(--itsm-text-callout-line);
  color: var(--itsm-colour-text-secondary);
}
.itsm-Toaster__toast[data-tone="info"] .itsm-Toaster__icon { color: var(--itsm-colour-info-subtleText); }
.itsm-Toaster__toast[data-tone="success"] .itsm-Toaster__icon { color: var(--itsm-colour-success-subtleText); }
.itsm-Toaster__toast[data-tone="warning"] .itsm-Toaster__icon { color: var(--itsm-colour-warning-subtleText); }
.itsm-Toaster__toast[data-tone="danger"] .itsm-Toaster__icon { color: var(--itsm-colour-danger-subtleText); }

.itsm-Toaster__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
  padding-block: var(--itsm-space-3xs);
}
.itsm-Toaster__title {
  margin: 0;
  font-weight: var(--itsm-font-weight-semibold);
  color: var(--itsm-colour-text-primary);
  overflow-wrap: anywhere;
  text-wrap: pretty;
}
.itsm-Toaster__description {
  margin: 0;
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  color: var(--itsm-colour-text-secondary);
  overflow-wrap: anywhere;
  text-wrap: pretty;
}
.itsm-Toaster__wait { font-variant-numeric: tabular-nums; }
.itsm-Toaster__progress {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  margin-block-start: var(--itsm-space-2xs);
}
.itsm-Toaster__progress > .itsm-ProgressBar { flex: 1 1 auto; }
.itsm-Toaster__count {
  flex: none;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
  font-variant-numeric: tabular-nums;
}
.itsm-Toaster__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--itsm-space-xs);
  margin-block-start: var(--itsm-space-xs);
}
.itsm-Toaster__close {
  flex: none;
  margin-block-start: calc(-1 * var(--itsm-space-3xs));
}

${mq.forcedColors} {
  .itsm-Toaster__item { border-color: CanvasText; }
}
`,
);
