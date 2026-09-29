import { css, layer, mq } from '../styles/css.js';

/**
 * `Skeleton`. The shimmer has a fixed period rather than a duration token, so
 * it needs its own reduced-motion rule: collapsing the tokens does not reach it.
 */
export const skeletonStyles = layer(
  'components',
  css`
.itsm-Skeleton {
  display: block;
  border-radius: var(--itsm-radius-sm);
  background: linear-gradient(90deg, var(--itsm-colour-surface-sunken) 25%, var(--itsm-colour-surface-hover) 37%, var(--itsm-colour-surface-sunken) 63%);
  background-size: 400% 100%;
  animation: itsm-shimmer 1400ms linear infinite;
}

${mq.reducedMotion} { .itsm-Skeleton { animation: none; } }
`,
);
