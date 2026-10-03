import { css, layer } from '../styles/css.js';

/**
 * `ChartCard` (A8 §4.1): what the chart card adds to `Card` v3, which draws
 * the frame, the head, the ⓘ, the actions and the foot.
 *
 * The lede — the headline in 500 13/20 `text.secondary` and the basis line in
 * 12/16 `text.muted` — sits 2 px under the title, and the plot 16 px under
 * the lede, as in the PMO. In a state with nothing to plot, the card keeps
 * its final height (an inline `min-block-size`) and the empty, insufficient
 * or failed plot fills it, so a dashboard row stays level. The plot area is
 * the chart's container (`itsm-chart`) as everywhere else in the kit.
 */
export const chartCardStyles = layer(
  'components',
  css`
.itsm-ChartCard[data-lede] > .itsm-Card__header + .itsm-Card__body {
  padding-block-start: var(--itsm-space-3xs);
}

.itsm-ChartCard > .itsm-Card__body {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-md);
}

.itsm-ChartCard__lede {
  display: grid;
  gap: var(--itsm-space-3xs);
}

.itsm-ChartCard__headline {
  margin: 0;
  max-inline-size: 72ch;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-medium);
  color: var(--itsm-colour-text-secondary);
  text-wrap: pretty;
}

.itsm-ChartCard__caption {
  margin: 0;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
}

.itsm-ChartCard__plot {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-inline-size: 0;
}

.itsm-ChartCard__plot > .itsm-Chart__empty {
  flex: 1 1 auto;
}

.itsm-ChartCard__retry {
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-semibold);
  color: var(--itsm-colour-text-link);
}
`,
);
