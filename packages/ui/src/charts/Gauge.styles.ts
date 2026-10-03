import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `Gauge` (A8 §4.5): a 220° dial, 12 wide, in a 200 × 128 box (260 wide at
 * `lg`) that scales as one, stroke and all.
 *
 * The track is tinted by zone — each intent's chart colour mixed 22 % into
 * the surface the gauge sits on, so the zones read in both themes and stay
 * behind the reading — and meets square between zones, round at the ends.
 * The reading is the zone's own colour (the accent when there are no zones),
 * with round ends; the target a 2 px tick in the marker navy. The value sits
 * in the dial in the stat numeral, the target under it, the caption under the
 * dial. The reading sweeps in once on first paint, never under reduced
 * motion. With more contrast the tints double; in forced colours the track is
 * `GrayText` and the reading `Highlight`.
 */
export const gaugeStyles = layer(
  'components',
  css`
@keyframes itsm-gauge-reveal {
  from { stroke-dashoffset: 100; }
  to { stroke-dashoffset: 0; }
}

.itsm-Gauge {
  --_itsm-zone-mix: 22%;
  display: inline-grid;
  justify-items: center;
  gap: var(--itsm-space-2xs);
  inline-size: 12.5rem;
  max-inline-size: 100%;
}

.itsm-Gauge[data-size="lg"] {
  inline-size: 16.25rem;
}

.itsm-Gauge [data-tone="danger"] { --_itsm-zone: var(--itsm-colour-danger-border); }
.itsm-Gauge [data-tone="warning"] { --_itsm-zone: var(--itsm-colour-warning-border); }
.itsm-Gauge [data-tone="success"] { --_itsm-zone: var(--itsm-colour-success-border); }

.itsm-Gauge__dial {
  position: relative;
  inline-size: 100%;
  aspect-ratio: 200 / 128;
}

.itsm-Gauge__svg {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  overflow: visible;
}

.itsm-Gauge__track,
.itsm-Gauge__zone,
.itsm-Gauge__cap,
.itsm-Gauge__reading {
  fill: none;
  stroke-width: 12;
}

.itsm-Gauge__track {
  stroke: var(--itsm-colour-fill-track);
  stroke-linecap: round;
}

.itsm-Gauge__zone,
.itsm-Gauge__cap {
  stroke: color-mix(in srgb, var(--_itsm-zone) var(--_itsm-zone-mix), var(--_itsm-chart-surface, var(--itsm-colour-surface-raised)));
}

.itsm-Gauge__cap,
.itsm-Gauge__reading {
  stroke-linecap: round;
}

.itsm-Gauge__reading {
  stroke: var(--_itsm-zone, var(--itsm-colour-accent));
  stroke-dasharray: 100 100;
  animation: itsm-gauge-reveal var(--itsm-duration-reveal) var(--itsm-easing-entrance);
}

.itsm-Gauge__tick {
  stroke: var(--itsm-colour-chart-marker);
  stroke-width: 2;
}

/* The figures in the dial, centred on the arc's middle. */
.itsm-Gauge__centre {
  position: absolute;
  inset-inline: 0;
  inset-block-start: 40%;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.itsm-Gauge__value {
  font-family: var(--itsm-text-statValue-family);
  font-size: var(--itsm-text-statValue-size);
  line-height: var(--itsm-text-statValue-line);
  font-weight: var(--itsm-text-statValue-weight);
  letter-spacing: var(--itsm-text-statValue-tracking);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-primary);
  white-space: nowrap;
}

.itsm-Gauge[data-size="lg"] .itsm-Gauge__value {
  font-size: var(--itsm-text-verdict-size);
  line-height: var(--itsm-text-verdict-line);
}

.itsm-Gauge__target {
  font-size: var(--itsm-text-caption-size);
  line-height: var(--itsm-text-caption-line);
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-secondary);
  white-space: nowrap;
}

.itsm-Gauge__caption {
  max-inline-size: 100%;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
  text-align: center;
  text-wrap: balance;
}

${mq.reducedMotion} {
  .itsm-Gauge__reading {
    animation: none;
  }
}

${prefers.reducedMotion} .itsm-Gauge__reading {
  animation: none;
}

${moreContrast((scope) => `${scope} .itsm-Gauge { --_itsm-zone-mix: 44%; }`)}

${mq.forcedColors} {
  .itsm-Gauge__svg {
    forced-color-adjust: none;
  }
  .itsm-Gauge__track,
  .itsm-Gauge__zone,
  .itsm-Gauge__cap {
    stroke: GrayText;
  }
  .itsm-Gauge__reading {
    stroke: Highlight;
  }
  .itsm-Gauge__tick {
    stroke: CanvasText;
  }
}
`,
);
