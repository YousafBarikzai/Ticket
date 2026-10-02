import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq } from '../styles/css.js';
import { chartToneOutline, chartToneVar } from './tone.js';
import type { ChartTone } from './types.js';

/**
 * A state tone paints the line in the tone's audited chart colour. The quiet
 * `neutralSoft` fill does not reach 3:1 as a line, so its line takes the
 * outline that fill is always paired with, and only the wash stays soft.
 */
const tones = (Object.keys(chartToneVar) as ChartTone[])
  .map((tone) => `.itsm-Sparkline[data-tone="${tone}"] { color: ${chartToneOutline[tone] ?? chartToneVar[tone]}; }`)
  .join('\n');

/**
 * `Sparkline` (A8 §4.2): a thin line over a one-tenth wash, in `currentColor`
 * — the de-emphasis grey (`text.muted`) by default, the accent when the trend
 * is the story, a tone when it is a state's — and the latest point as a dot
 * with a 2 px ring in the surface colour it sits on.
 *
 * - **Fixed size** (a number width): the SVG is drawn at its own pixels; the
 *   line is 2 px.
 * - **`fill`**: a block as wide as its parent. The plot box is padded by the
 *   dot's radius and ring on each side, so the dot at either end is never
 *   cut; the line is 1.75 px in a stretched layer that does not scale its
 *   stroke, and the dot is an HTML span, so it stays round.
 * - **No trend** (fewer than two values): a 2 px dashed `border.divider` rule
 *   at mid-height, the same rule a KPI tile shows for "No trend yet".
 * - **The wash** is 10 % of the line colour, 14 % in a dark theme, where a
 *   tenth of a colour on a dark card does not read (A8 §6.2). In increase
 *   contrast it goes: a translucent fill is the first thing that state removes.
 */
export const sparklineStyles = layer(
  'components',
  css`
.itsm-Sparkline {
  --_itsm-spark-wash: color-mix(in srgb, currentColor 10%, transparent);
  display: block;
  flex: none;
  overflow: visible;
  color: var(--itsm-colour-text-muted);
}

@supports (color: light-dark(currentColor, currentColor)) {
  .itsm-Sparkline {
    --_itsm-spark-wash: light-dark(color-mix(in srgb, currentColor 10%, transparent), color-mix(in srgb, currentColor 14%, transparent));
  }
}

.itsm-Sparkline[data-tone="accent"] {
  color: var(--itsm-colour-accent);
}

${tones}

.itsm-Sparkline[data-width="fill"] {
  inline-size: 100%;
  min-inline-size: 0;
  padding-inline: 0.3125rem;
  box-sizing: border-box;
}

.itsm-Sparkline__plot {
  position: relative;
  display: block;
  block-size: 100%;
}

.itsm-Sparkline__svg {
  display: block;
  overflow: visible;
}

.itsm-Sparkline__line {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.itsm-Sparkline[data-width="fill"] .itsm-Sparkline__line {
  stroke-width: 1.75;
}

.itsm-Sparkline__wash {
  fill: var(--_itsm-spark-wash);
  stroke: none;
}

.itsm-Sparkline__reference {
  stroke: var(--itsm-colour-text-muted);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

/* The latest point: the accent on a muted trend (the reading that matters), the line's own colour otherwise. */
svg.itsm-Sparkline .itsm-Sparkline__dot {
  fill: var(--itsm-colour-accent);
  stroke: var(--_itsm-chart-surface, var(--itsm-colour-surface-raised));
  stroke-width: 4;
  paint-order: stroke;
}

svg.itsm-Sparkline:not([data-tone="muted"]) .itsm-Sparkline__dot {
  fill: currentColor;
}

span.itsm-Sparkline .itsm-Sparkline__dot {
  position: absolute;
  inline-size: 0.375rem;
  block-size: 0.375rem;
  border-radius: 50%;
  background: var(--itsm-colour-accent);
  box-shadow: 0 0 0 var(--itsm-border-thick) var(--_itsm-chart-surface, var(--itsm-colour-surface-raised));
  transform: translate(-50%, -50%);
}

span.itsm-Sparkline:not([data-tone="muted"]) .itsm-Sparkline__dot {
  background: currentColor;
}

.itsm-Sparkline[data-empty] {
  position: relative;
}

.itsm-Sparkline[data-empty]::after {
  content: "";
  position: absolute;
  inset-inline: 0;
  inset-block-start: calc(50% - 1px);
  border-block-start: 2px dashed var(--itsm-colour-border-divider);
}

${moreContrast((scope) => `${scope} .itsm-Sparkline__wash { fill: none; }`)}

${mq.forcedColors} {
  .itsm-Sparkline {
    forced-color-adjust: none;
    color: CanvasText;
  }
  .itsm-Sparkline__wash {
    fill: none;
  }
  svg.itsm-Sparkline .itsm-Sparkline__dot {
    fill: Highlight;
    stroke: Canvas;
  }
  span.itsm-Sparkline .itsm-Sparkline__dot {
    background: Highlight;
    box-shadow: 0 0 0 2px Canvas;
  }
  .itsm-Sparkline__reference {
    stroke: GrayText;
  }
  .itsm-Sparkline[data-empty]::after {
    border-block-start-color: GrayText;
  }
}

`,
);
