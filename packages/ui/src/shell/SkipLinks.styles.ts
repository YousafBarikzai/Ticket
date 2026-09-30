import { css, layer, prefers, mq } from '../styles/css.js';

/**
 * `SkipLinks`: out of sight until focused, then a solid accent pill in the
 * top start corner, above everything including the top bar, with the
 * two-tone focus ring. It drops in over `fast`, or simply appears under
 * reduced motion.
 */
export const skipLinksStyles = layer(
  'components',
  css`
.itsm-SkipLinks {
  position: fixed;
  inset-block-start: max(var(--itsm-space-xs), var(--itsm-safe-area-top));
  inset-inline-start: max(var(--itsm-space-xs), var(--itsm-safe-area-left));
  z-index: var(--itsm-z-tooltip);
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-2xs);
  pointer-events: none;
}
.itsm-SkipLinks__link {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.itsm-SkipLinks__link:focus {
  position: static;
  inline-size: auto;
  block-size: auto;
  overflow: visible;
  clip-path: none;
  padding: var(--itsm-space-xs) var(--itsm-space-md);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-brand-solid);
  color: var(--itsm-colour-brand-solidText);
  box-shadow: var(--itsm-elevation-lg);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-semibold);
  text-decoration: none;
  pointer-events: auto;
  animation: itsm-rise var(--itsm-duration-fast) var(--itsm-easing-entrance);
}

${mq.reducedMotion} {
  .itsm-SkipLinks__link:focus {
    animation: none;
  }
}
${prefers.reducedMotion} .itsm-SkipLinks__link:focus {
  animation: none;
}
`,
);
