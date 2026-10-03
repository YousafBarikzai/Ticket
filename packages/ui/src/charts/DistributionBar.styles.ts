import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq } from '../styles/css.js';
import { textureImages, textureVariables } from './texture-css.js';

const hatch = (ink: string): string => textureImages(ink)[2]!;

/**
 * `DistributionBar` (A8 §4.4). The legend is the shared `ChartLegend` look
 * (chips, label, bold value, muted share) from `ChartFigure.styles.ts`; this
 * module draws the label row and the strip.
 *
 * The strip is a pill-shaped flex row on the card's own colour, so the 2 px
 * gaps between segments are the card showing through; each segment is its
 * slot's or tone's colour and never under 3 px. Room left under a `max` is
 * the track; an overrun is hatched in danger over the strip and said under
 * it in the danger text colour. A `marker` is a navy tick 8 px taller than
 * the strip, its label above in 600 11. Nothing to show is the quiet
 * `neutralSoft` strip with its outline. With more contrast every segment
 * wears its texture; in forced colours segments are outlined with theirs.
 */
export const distributionBarStyles = layer(
  'components',
  css`
.itsm-DistributionBar {
  display: grid;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
  margin: 0;
}

.itsm-DistributionBar__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--itsm-space-sm);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  color: var(--itsm-colour-text-secondary);
}

.itsm-DistributionBar__label {
  min-inline-size: 0;
  font-weight: var(--itsm-font-weight-semibold);
  color: var(--itsm-colour-text-primary);
}

.itsm-DistributionBar__totalValue {
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-primary);
}

.itsm-DistributionBar__strip {
  position: relative;
  min-inline-size: 0;
}

.itsm-DistributionBar__strip[data-marker] {
  padding-block-start: var(--itsm-text-caption-line);
}

.itsm-DistributionBar__segments {
  display: flex;
  gap: 2px;
  overflow: hidden;
  border-radius: var(--itsm-radius-pill);
  background: var(--_itsm-chart-surface);
}

.itsm-DistributionBar__segments[data-empty] {
  background: var(--itsm-colour-chart-neutralSoft);
  box-shadow: inset 0 0 0 1px var(--itsm-colour-neutral-border);
}

.itsm-DistributionBar__segment {
  flex: 1 1 0;
  min-inline-size: 3px;
  background: var(--_itsm-series);
  box-shadow: inset 0 0 0 1px var(--_itsm-series-edge, transparent);
}

.itsm-DistributionBar__room {
  flex: 1 1 0;
  background: var(--itsm-colour-fill-secondary);
}

.itsm-DistributionBar :is(.itsm-DistributionBar__segment, .itsm-ChartLegend__key)[data-pattern="hatch"] {
  background: ${hatch('var(--_itsm-chart-surface)')}, var(--_itsm-series);
}

.itsm-DistributionBar__over {
  position: absolute;
  inset-block-end: 0;
  block-size: 100%;
  border-radius: 0 var(--itsm-radius-pill) var(--itsm-radius-pill) 0;
  background: ${hatch('var(--itsm-colour-danger-border)')}, var(--itsm-colour-danger-subtle);
}

.itsm-DistributionBar__strip[data-marker] > .itsm-DistributionBar__over {
  block-size: calc(100% - var(--itsm-text-caption-line));
}

.itsm-DistributionBar__marker {
  position: absolute;
  inset-block: calc(var(--itsm-text-caption-line) - var(--itsm-space-2xs)) calc(-1 * var(--itsm-space-2xs));
  inline-size: 2px;
  margin-inline-start: -1px;
  background: var(--itsm-colour-chart-marker);
}

.itsm-DistributionBar__markerLabel {
  position: absolute;
  inset-block-end: 100%;
  inset-inline-start: 50%;
  font-size: var(--itsm-text-caption-size);
  line-height: var(--itsm-text-caption-line);
  font-weight: var(--itsm-font-weight-semibold);
  color: var(--itsm-colour-text-secondary);
  white-space: nowrap;
  transform: translateX(-50%);
}

.itsm-DistributionBar__marker[data-edge="start"] .itsm-DistributionBar__markerLabel {
  inset-inline-start: 0;
  transform: none;
}

.itsm-DistributionBar__marker[data-edge="end"] .itsm-DistributionBar__markerLabel {
  inset-inline-start: auto;
  inset-inline-end: 0;
  transform: none;
}

.itsm-DistributionBar__icon {
  color: var(--itsm-colour-text-muted);
}

.itsm-DistributionBar__link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--itsm-colour-border-subtle);
  text-underline-offset: 0.2em;
}

.itsm-DistributionBar__link:hover {
  color: var(--itsm-colour-text-link);
  text-decoration-color: currentColor;
}

.itsm-DistributionBar__overText {
  font-weight: var(--itsm-font-weight-semibold);
  color: var(--itsm-colour-danger-subtleText);
}

${textureVariables('.itsm-DistributionBar__segment')}

${moreContrast(
  (scope) => `${scope} .itsm-DistributionBar__segment { --_itsm-ink: var(--_itsm-chart-surface); background: var(--_itsm-texture, none), var(--_itsm-series); }`,
)}

${mq.forcedColors} {
  .itsm-DistributionBar__segments,
  .itsm-DistributionBar__segment,
  .itsm-DistributionBar__over,
  .itsm-DistributionBar__marker {
    forced-color-adjust: none;
  }
  .itsm-DistributionBar__segments {
    background: Canvas;
    box-shadow: inset 0 0 0 1px CanvasText;
  }
  .itsm-DistributionBar__segment {
    --_itsm-ink: CanvasText;
    background: var(--_itsm-texture, none), Canvas;
    box-shadow: inset 0 0 0 1px CanvasText;
  }
  .itsm-DistributionBar__segment[data-slot="1"] {
    background: CanvasText;
  }
  .itsm-DistributionBar__over {
    background: ${hatch('Highlight')}, Canvas;
  }
  .itsm-DistributionBar__marker {
    background: Highlight;
  }
}
`,
);
