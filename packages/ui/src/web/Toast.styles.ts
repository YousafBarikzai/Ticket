import { css, layer, mq } from '../styles/css.js';

/**
 * `ToastProvider` (deprecated until Stage 5; new code calls `notify()` and the
 * `Toaster` shows it). Drawn like the `Toaster`'s card so the two cannot be
 * told apart while both exist: opaque `surface.overlay`, radius `xl`,
 * elevation `lg`, a tone icon in the intent's `subtleText` instead of the old
 * coloured edge. It rises 8 px as it appears; under reduced motion it only
 * fades.
 */
export const toastStyles = layer(
  'components',
  css`
.itsm-Toast__region {
  position: fixed;
  inset-block-end: calc(max(var(--itsm-bottom-dock-height), var(--itsm-safe-area-bottom)) + var(--itsm-space-lg));
  inset-inline-end: var(--itsm-space-lg);
  z-index: var(--itsm-z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-sm);
  inline-size: min(calc(100% - 2 * var(--itsm-space-lg)), 22.5rem);
}
.itsm-Toast {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-sm);
  padding: var(--itsm-space-sm) var(--itsm-space-xs) var(--itsm-space-sm) var(--itsm-space-md);
  background: var(--itsm-colour-surface-overlay);
  border: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-xl);
  box-shadow: var(--itsm-elevation-lg), var(--itsm-edge-highlight);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  animation: itsm-rise var(--itsm-duration-normal) var(--itsm-easing-entrance);
}
.itsm-Toast__icon { flex: none; block-size: var(--itsm-text-callout-line); color: var(--itsm-colour-info-subtleText); }
.itsm-Toast--success .itsm-Toast__icon { color: var(--itsm-colour-success-subtleText); }
.itsm-Toast--danger .itsm-Toast__icon { color: var(--itsm-colour-danger-subtleText); }
.itsm-Toast--warning .itsm-Toast__icon { color: var(--itsm-colour-warning-subtleText); }
.itsm-Toast__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
  padding-block: var(--itsm-space-3xs);
}
.itsm-Toast__title { font-weight: var(--itsm-font-weight-semibold); overflow-wrap: anywhere; }
.itsm-Toast__description {
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  color: var(--itsm-colour-text-secondary);
  overflow-wrap: anywhere;
}

${mq.reducedMotion} {
  .itsm-Toast { animation-name: itsm-fade-in; }
}

${mq.belowMd} {
  .itsm-Toast__region {
    inset-inline: var(--itsm-space-sm);
    inset-block-end: calc(max(var(--itsm-bottom-dock-height), var(--itsm-safe-area-bottom)) + var(--itsm-space-sm));
    inline-size: auto;
  }
}

${mq.forcedColors} {
  .itsm-Toast { border-color: CanvasText; }
}
`,
);
