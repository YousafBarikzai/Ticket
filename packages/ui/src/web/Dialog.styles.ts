import { css, layer, mq } from '../styles/css.js';

/**
 * `Dialog`. It enters with `itsm-fade-in` and `itsm-rise` from
 * `styles/motion.styles.ts`, and not at all under reduced motion.
 */
export const dialogStyles = layer(
  'components',
  css`
.itsm-Dialog__scrim {
  position: fixed;
  inset: 0;
  z-index: var(--itsm-z-dialog);
  background: var(--itsm-colour-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--itsm-space-md);
  overflow-y: auto;
  animation: itsm-fade-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}
.itsm-Dialog {
  inline-size: min(100%, 34rem);
  max-block-size: calc(100dvh - var(--itsm-space-2xl));
  display: flex;
  flex-direction: column;
  background: var(--itsm-colour-surface-overlay);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-lg);
  box-shadow: var(--itsm-elevation-xl);
  color: var(--itsm-colour-text-primary);
  animation: itsm-rise var(--itsm-duration-normal) var(--itsm-easing-entrance);
}
.itsm-Dialog--sm { inline-size: min(100%, 24rem); }
.itsm-Dialog--lg { inline-size: min(100%, 52rem); }
.itsm-Dialog__header { display: flex; align-items: flex-start; gap: var(--itsm-space-sm); padding: var(--itsm-space-md); border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); }
.itsm-Dialog__title { margin: 0; flex: 1; font-size: var(--itsm-font-size-xl); font-weight: var(--itsm-font-weight-semibold); }
.itsm-Dialog__description { margin: var(--itsm-space-3xs) 0 0; font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-muted); }
.itsm-Dialog__body { padding: var(--itsm-space-md); overflow-y: auto; }
.itsm-Dialog__footer { display: flex; justify-content: flex-end; gap: var(--itsm-space-xs); padding: var(--itsm-space-md); border-block-start: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); }

${mq.reducedMotion} {
  .itsm-Dialog, .itsm-Dialog__scrim { animation: none; }
}
`,
);
