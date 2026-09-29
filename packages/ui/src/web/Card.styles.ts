import { css, layer, mq } from '../styles/css.js';

/**
 * `Card`.
 *
 * The hover and focus lift is the treatment `styles/interactive.styles.ts`
 * describes, written out for this component; under reduced motion the
 * movement goes and the colour stays. The card's own hover rule comes after
 * it and settles the border and shadow.
 */
export const cardStyles = layer(
  'components',
  css`
.itsm-Card--interactive {
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard),
    transform var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-Card--interactive:hover,
.itsm-Card--interactive:focus-visible {
  background: var(--itsm-colour-surface-hover);
  border-color: var(--itsm-colour-brand-border);
  box-shadow: var(--itsm-elevation-md);
  transform: translateY(calc(-1 * var(--itsm-lift-md)));
}

${mq.reducedMotion} {
  .itsm-Card--interactive {
    transition: none;
  }
  .itsm-Card--interactive:hover,
  .itsm-Card--interactive:focus-visible {
    transform: none;
  }
}

.itsm-Card {
  display: block;
  background: var(--itsm-colour-surface-raised);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-lg);
  box-shadow: var(--itsm-elevation-sm);
  color: var(--itsm-colour-text-primary);
  overflow: hidden;
}
.itsm-Card--interactive { cursor: pointer; text-align: start; inline-size: 100%; }
.itsm-Card--interactive:hover { box-shadow: var(--itsm-elevation-md); border-color: var(--itsm-colour-border-interactive); }
.itsm-Card__header { padding: var(--itsm-space-md); border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); }
.itsm-Card__title { margin: 0; font-size: var(--itsm-font-size-lg); font-weight: var(--itsm-font-weight-semibold); }
.itsm-Card__subtitle { margin: 0; font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-muted); }
.itsm-Card__body { padding: var(--itsm-space-md); }
.itsm-Card__footer { padding: var(--itsm-space-md); border-block-start: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); background: var(--itsm-colour-surface-sunken); }
`,
);
