import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `ProgressRing`: a track and an arc in the same weight, the arc in the
 * tone's colour with round ends, and optional text in the middle sized to
 * the ring.
 *
 * The status tones use the intent *border* tokens, the ones audited at 3:1
 * against every surface, as every status mark in a chart does (SPEC §1.11).
 * The track is `fill.track`, the product's one track colour; with more
 * contrast it steps up to `border.subtle` so the unfilled part is still seen.
 * A target is a 2 px tick in the marker navy, reaching 2 px past the stroke
 * each side; the 140 ring carries the stat numeral.
 */
export const progressRingStyles = layer(
  'components',
  css`
.itsm-ProgressRing {
  --_itsm-ring: var(--itsm-colour-accent);
  position: relative;
  display: inline-grid;
  flex: none;
  place-items: center;
  inline-size: var(--_itsm-ring-size);
  block-size: var(--_itsm-ring-size);
  vertical-align: middle;
}

.itsm-ProgressRing[data-tone="success"] { --_itsm-ring: var(--itsm-colour-success-border); }
.itsm-ProgressRing[data-tone="warning"] { --_itsm-ring: var(--itsm-colour-warning-border); }
.itsm-ProgressRing[data-tone="danger"] { --_itsm-ring: var(--itsm-colour-danger-border); }
.itsm-ProgressRing[data-tone="neutral"] { --_itsm-ring: var(--itsm-colour-neutral-border); }

.itsm-ProgressRing__svg {
  grid-area: 1 / 1;
  display: block;
  overflow: visible;
}

.itsm-ProgressRing__target {
  stroke: var(--itsm-colour-chart-marker);
  stroke-width: 2;
}

.itsm-ProgressRing__track {
  fill: none;
  stroke: var(--itsm-colour-fill-track);
}

.itsm-ProgressRing__arc {
  fill: none;
  stroke: var(--_itsm-ring);
  stroke-linecap: round;
  transition: stroke-dasharray var(--itsm-duration-normal) var(--itsm-easing-standard),
    stroke var(--itsm-duration-normal) var(--itsm-easing-standard);
}

.itsm-ProgressRing__text {
  grid-area: 1 / 1;
  font-size: var(--itsm-text-footnote-size);
  line-height: 1;
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-primary);
  white-space: nowrap;
}

.itsm-ProgressRing[data-size="32"] .itsm-ProgressRing__text { font-size: var(--itsm-text-caption-size); }
.itsm-ProgressRing[data-size="64"] .itsm-ProgressRing__text { font-size: var(--itsm-text-callout-size); }
.itsm-ProgressRing[data-size="96"] .itsm-ProgressRing__text {
  font-size: var(--itsm-text-title3-size);
  letter-spacing: var(--itsm-text-title3-tracking);
}
.itsm-ProgressRing[data-size="140"] .itsm-ProgressRing__text {
  font-family: var(--itsm-text-statValue-family);
  font-size: var(--itsm-text-statValue-size);
  line-height: var(--itsm-text-statValue-line);
  letter-spacing: var(--itsm-text-statValue-tracking);
}

${moreContrast((scope) => `${scope} .itsm-ProgressRing__track { stroke: var(--itsm-colour-border-subtle); }`)}

${mq.reducedMotion} {
  .itsm-ProgressRing__arc {
    transition: none;
  }
}

${prefers.reducedMotion} .itsm-ProgressRing__arc {
  transition: none;
}

${mq.forcedColors} {
  .itsm-ProgressRing__svg {
    forced-color-adjust: none;
  }
  .itsm-ProgressRing__track {
    stroke: GrayText;
  }
  .itsm-ProgressRing__arc {
    stroke: CanvasText;
  }
  .itsm-ProgressRing__target {
    stroke: Highlight;
  }
}
`,
);
