import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `DonutChart`: the ring beside its legend, the legend below it in a narrow
 * card. The ring is a thick donut with a 2 px surface gap between parts; the
 * centre can hold one figure and a word. The legend is where the numbers
 * are — each part's value and share, aligned on the end — so nobody has to
 * judge an angle.
 *
 * With more contrast (and in forced colours) each part shows its hatch
 * (`texture.tsx`) over its colour, so the parts stay apart without hue.
 */
export const donutChartStyles = layer(
  'components',
  css`
.itsm-DonutChart {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-md) var(--itsm-space-xl);
}

.itsm-DonutChart > .itsm-ChartReader {
  flex: none;
  border-radius: 50%;
}

.itsm-DonutChart__ring {
  position: relative;
  flex: none;
  inline-size: 10rem;
  block-size: 10rem;
}

@container itsm-chart (min-width: 36rem) {
  .itsm-DonutChart__ring {
    inline-size: 11.5rem;
    block-size: 11.5rem;
  }
}

.itsm-DonutChart__svg {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  overflow: visible;
}

.itsm-DonutChart__part {
  transition: opacity var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-DonutChart__segment {
  fill: var(--_itsm-series);
}

.itsm-DonutChart__texture {
  display: none;
  pointer-events: none;
}

.itsm-ChartTexture__ink {
  fill: none;
  stroke: var(--_itsm-chart-surface);
  stroke-width: 0.9;
}

.itsm-ChartTexture__dot {
  fill: var(--_itsm-chart-surface);
}

.itsm-DonutChart__centre {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 22%;
  text-align: center;
  pointer-events: none;
}

.itsm-DonutChart__centreValue {
  max-inline-size: 100%;
  overflow: hidden;
  font-size: var(--itsm-text-title2-size);
  line-height: var(--itsm-text-title2-line);
  font-weight: var(--itsm-text-title2-weight);
  letter-spacing: var(--itsm-text-title2-tracking);
  color: var(--itsm-colour-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itsm-DonutChart__centreLabel {
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
}

.itsm-DonutChart__legend {
  flex: 1 1 14rem;
  max-inline-size: 24rem;
  flex-direction: column;
  flex-wrap: nowrap;
  gap: var(--itsm-space-xs);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
}

.itsm-DonutChart__legend .itsm-ChartLegend__item {
  display: flex;
}

.itsm-DonutChart__legend .itsm-ChartLegend__label {
  flex: 1 1 auto;
  color: var(--itsm-colour-text-primary);
}

.itsm-DonutChart__legend .itsm-ChartLegend__detail {
  min-inline-size: 4.5ch;
  text-align: end;
}

.itsm-ChartReader[data-reading] .itsm-DonutChart__part:not([data-active]) {
  opacity: 0.35;
}

${moreContrast((scope) => `${scope} .itsm-DonutChart__texture { display: inline; }`)}

${mq.reducedMotion} {
  .itsm-DonutChart__part {
    transition: none;
  }
}

${prefers.reducedMotion} .itsm-DonutChart__part {
  transition: none;
}

${mq.forcedColors} {
  .itsm-DonutChart__svg {
    forced-color-adjust: none;
  }
  .itsm-DonutChart__segment {
    fill: Canvas;
    stroke: CanvasText;
    stroke-width: 0.6;
  }
  .itsm-DonutChart__segment[data-slot="1"] {
    fill: CanvasText;
  }
  .itsm-DonutChart__texture {
    display: inline;
  }
  .itsm-ChartTexture__ink {
    stroke: CanvasText;
  }
  .itsm-ChartTexture__dot {
    fill: CanvasText;
  }
}
`,
);
