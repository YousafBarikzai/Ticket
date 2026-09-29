import { css, layer, mq } from '../styles/css.js';

/**
 * `Metric` and `MetricGrid` (deprecated wrappers until the charts replace them).
 *
 * The hover and focus lift is the treatment `styles/interactive.styles.ts`
 * describes, written out for this component; under reduced motion the
 * movement goes and the colour stays.
 */
export const metricStyles = layer(
  'components',
  css`
.itsm-Metric--interactive {
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard),
    transform var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-Metric--interactive:hover,
.itsm-Metric--interactive:focus-visible {
  background: var(--itsm-colour-surface-hover);
  border-color: var(--itsm-colour-brand-border);
  box-shadow: var(--itsm-elevation-md);
  transform: translateY(calc(-1 * var(--itsm-lift-md)));
}

${mq.reducedMotion} {
  .itsm-Metric--interactive {
    transition: none;
  }
  .itsm-Metric--interactive:hover,
  .itsm-Metric--interactive:focus-visible {
    transform: none;
  }
}

.itsm-Metric {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  padding: var(--itsm-space-sm);
  background: var(--itsm-colour-surface-sunken);
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-lg);
  text-align: start;
  inline-size: 100%;
  color: inherit;
}
.itsm-Metric--interactive { cursor: pointer; text-decoration: none; }
.itsm-Metric__label { font-size: var(--itsm-font-size-xs); color: var(--itsm-colour-text-muted); }
.itsm-Metric__value { font-size: var(--itsm-font-size-2xl); font-weight: var(--itsm-font-weight-semibold); letter-spacing: var(--itsm-letter-spacing-tight); }
.itsm-Metric__note { font-size: var(--itsm-font-size-xs); color: var(--itsm-colour-text-muted); }
.itsm-Metric__note--good { color: var(--itsm-colour-success-subtleText); }
.itsm-Metric__note--bad { color: var(--itsm-colour-danger-subtleText); }

.itsm-MetricGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: var(--itsm-space-xs);
}
`,
);
