import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq } from '../styles/css.js';

/**
 * `AreaChart`: the wash under each line. The frame, lines and markers are
 * the line chart's (`LineChart.styles.ts`).
 *
 * The wash is the series colour at a tenth of its strength — a tint, never a
 * saturated block — so overlapping areas stay readable and the line on top
 * carries the identity. Stacked bands, which do not overlap, take a little
 * more so adjacent bands read as separate. With more contrast the wash is
 * stronger; in forced colours there is no wash, only the lines.
 */
export const areaChartStyles = layer(
  'components',
  css`
.itsm-XYChart__area {
  fill: var(--_itsm-series);
  fill-opacity: 0.1;
  stroke: none;
}

.itsm-XYChart__area[data-stacked] {
  fill-opacity: 0.18;
}

${moreContrast((scope) => `${scope} .itsm-XYChart__area { fill-opacity: 0.22; }`)}

${mq.forcedColors} {
  .itsm-XYChart__area {
    fill: none;
  }
}
`,
);
