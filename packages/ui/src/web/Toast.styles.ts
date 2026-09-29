import { css, layer, mq } from '../styles/css.js';

/**
 * `ToastProvider` (deprecated until the Toaster replaces it).
 *
 * The reduced-motion rule sits after the toast's own `animation`. The old
 * stylesheet had it before, where the later rule overrode it and the toast
 * still rose; the token layer's 1ms durations were all that kept that from
 * showing.
 */
export const toastStyles = layer(
  'components',
  css`
.itsm-Toast__region {
  position: fixed;
  inset-block-end: var(--itsm-space-md);
  inset-inline-end: var(--itsm-space-md);
  z-index: var(--itsm-z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
  inline-size: min(100%, 24rem);
}
.itsm-Toast {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-xs);
  padding: var(--itsm-space-sm);
  background: var(--itsm-colour-surface-overlay);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-inline-start: var(--itsm-space-3xs) solid var(--itsm-colour-neutral-solid);
  border-radius: var(--itsm-radius-md);
  box-shadow: var(--itsm-elevation-lg);
  color: var(--itsm-colour-text-primary);
  animation: itsm-rise var(--itsm-duration-normal) var(--itsm-easing-entrance);
}
.itsm-Toast--success { border-inline-start-color: var(--itsm-colour-success-solid); }
.itsm-Toast--danger { border-inline-start-color: var(--itsm-colour-danger-solid); }
.itsm-Toast--warning { border-inline-start-color: var(--itsm-colour-warning-solid); }
.itsm-Toast--info { border-inline-start-color: var(--itsm-colour-info-solid); }
.itsm-Toast__body { flex: 1; }
.itsm-Toast__title { font-weight: var(--itsm-font-weight-semibold); font-size: var(--itsm-font-size-md); }
.itsm-Toast__description { font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-secondary); }

${mq.reducedMotion} {
  .itsm-Toast { animation: none; }
}

${mq.belowMd} {
  .itsm-Toast__region { inset-inline: var(--itsm-space-xs); inline-size: auto; }
}
`,
);
