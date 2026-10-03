import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq } from '../styles/css.js';

/**
 * The washes under `actual` lines (`charts/xy.tsx`). The frame, lines and
 * markers are the line chart's (`LineChart.styles.ts`).
 *
 * A wash is a tint of the series colour, never a saturated block (A8 §3.3):
 * 10 % for one washed series, 8 % when several overlap (`data-washes`), and
 * four points more in the dark themes, where a tenth of a colour on a dark
 * card does not read — chosen by `light-dark()`, so a theme switch needs no
 * re-render. A `gradient` wash fades from 20 % at the line to nothing at the
 * baseline. Stacked bands, which do not overlap, take 22 % so neighbours read
 * as separate. With more contrast a translucent fill is the first thing to
 * go: the wash becomes a 1 px outline. In forced colours there is no wash,
 * only the lines.
 */
export const areaChartStyles = layer(
  'components',
  css`
.itsm-XYChart {
  --_itsm-wash: 10%;
}

.itsm-XYChart[data-washes="several"] {
  --_itsm-wash: 8%;
}

.itsm-XYChart__area {
  stroke: none;
}

.itsm-XYChart__area[data-fill="wash"] {
  fill: color-mix(in srgb, var(--_itsm-series) var(--_itsm-wash), transparent);
}

.itsm-XYChart__area[data-stacked] {
  --_itsm-wash: 22%;
}

.itsm-XYChart__stop {
  stop-color: var(--_itsm-series);
  stop-opacity: 0.2;
}

.itsm-XYChart__stop[data-end] {
  stop-opacity: 0;
}

@supports (color: light-dark(currentColor, currentColor)) {
  .itsm-XYChart__area[data-fill="wash"] {
    fill: light-dark(
      color-mix(in srgb, var(--_itsm-series) var(--_itsm-wash), transparent),
      color-mix(in srgb, var(--_itsm-series) calc(var(--_itsm-wash) + 4%), transparent)
    );
  }
  .itsm-XYChart__stop:not([data-end]) {
    stop-opacity: 1;
    stop-color: light-dark(color-mix(in srgb, var(--_itsm-series) 20%, transparent), color-mix(in srgb, var(--_itsm-series) 24%, transparent));
  }
}

${moreContrast(
  (scope) => `${scope} .itsm-XYChart__area:not([data-stacked]) { fill: none; stroke: var(--_itsm-series); stroke-width: 1; vector-effect: non-scaling-stroke; }`,
)}

${mq.forcedColors} {
  .itsm-XYChart__area {
    fill: none;
    stroke: none;
  }
}
`,
);
