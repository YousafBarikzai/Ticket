import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq, prefers } from '../styles/css.js';
import { textureImages } from './texture-css.js';

const hatch = (ink: string): string => textureImages(ink)[2]!;

/**
 * `DonutChart`: the ring and its legend — beside the ring in a card at least
 * 22.5 rem wide, below it otherwise (`legendPosition="auto"`, a container
 * query), or where the page says. The ring is a thick donut in 160 or 200 px
 * with a 1.5° surface gap between parts; the centre holds one figure in the
 * stat numeral and a muted word. The legend is where the numbers are — each
 * part's value in bold and its share, aligned on the end — so nobody has to
 * judge an angle. A `neutralSoft` part draws its tone's outline; a hatched
 * part ("Other · n") is hatched in every theme, its legend chip too.
 *
 * With more contrast (and in forced colours) each part shows its hatch
 * (`texture.tsx`) over its colour, so the parts stay apart without hue.
 */
export const donutChartStyles = layer(
  'components',
  css`
.itsm-DonutChart {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--itsm-space-md) var(--itsm-space-xl);
}

.itsm-DonutChart[data-legend="side"] {
  flex-direction: row;
}

@container itsm-chart (min-width: 22.5rem) {
  .itsm-DonutChart[data-legend="auto"] {
    flex-direction: row;
  }
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

.itsm-DonutChart__ring[data-size="lg"] {
  inline-size: 12.5rem;
  block-size: 12.5rem;
}

.itsm-DonutChart__svg {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  overflow: visible;
}

/* One reveal on first paint (A8 §6.4); the parts are filled shapes, so they fade in rather than sweep. */
.itsm-DonutChart[data-reveal] .itsm-DonutChart__svg {
  animation: itsm-chart-reveal var(--itsm-duration-reveal) var(--itsm-easing-entrance);
}

.itsm-DonutChart__part {
  transition: opacity var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-DonutChart__segment {
  fill: var(--_itsm-series);
  stroke: var(--_itsm-series-edge, none);
  stroke-width: 0.6;
}

.itsm-DonutChart__texture {
  display: none;
  pointer-events: none;
}

.itsm-DonutChart__texture[data-pattern] {
  display: inline;
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
  font-family: var(--itsm-text-statValue-family);
  font-size: var(--itsm-text-statValue-size);
  line-height: var(--itsm-text-statValue-line);
  font-weight: var(--itsm-text-statValue-weight);
  letter-spacing: var(--itsm-text-statValue-tracking);
  font-variant-numeric: tabular-nums;
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
  flex: 1 1 auto;
  inline-size: min(100%, 24rem);
  min-inline-size: 0;
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

.itsm-DonutChart .itsm-ChartLegend__key[data-pattern="hatch"] {
  background: ${hatch('var(--_itsm-chart-surface)')}, var(--_itsm-series);
}

.itsm-ChartReader[data-reading] .itsm-DonutChart__part:not([data-active]) {
  opacity: 0.35;
}

${moreContrast((scope) => `${scope} .itsm-DonutChart__texture { display: inline; }`)}

/* As specific as the reveal, and after it, so reduced motion wins. */
${mq.reducedMotion} {
  .itsm-DonutChart__part {
    transition: none;
  }
  .itsm-DonutChart[data-reveal] .itsm-DonutChart__svg {
    animation: none;
  }
}

${prefers.reducedMotion} .itsm-DonutChart__part {
  transition: none;
}

${prefers.reducedMotion} .itsm-DonutChart[data-reveal] .itsm-DonutChart__svg {
  animation: none;
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
  .itsm-DonutChart .itsm-ChartLegend__key[data-pattern] {
    background: ${hatch('CanvasText')}, Canvas;
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
