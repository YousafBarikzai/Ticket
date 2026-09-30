import { css, layer, mq } from '../styles/css.js';

/**
 * `Sparkline`: a 2 px line over a one-tenth wash, in `currentColor` — the
 * de-emphasis grey (`text.muted`) by default, the accent when the trend is
 * the story — and the latest point as an accent dot with a 2 px ring in the
 * surface colour it sits on.
 */
export const sparklineStyles = layer(
  'components',
  css`
.itsm-Sparkline {
  display: block;
  flex: none;
  overflow: visible;
  color: var(--itsm-colour-text-muted);
}

.itsm-Sparkline[data-tone="accent"] {
  color: var(--itsm-colour-accent);
}

.itsm-Sparkline__line {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.itsm-Sparkline__wash {
  fill: currentColor;
  fill-opacity: 0.1;
  stroke: none;
}

.itsm-Sparkline__dot {
  fill: var(--itsm-colour-accent);
  stroke: var(--_itsm-chart-surface, var(--itsm-colour-surface-raised));
  stroke-width: 4;
  paint-order: stroke;
}

${mq.forcedColors} {
  .itsm-Sparkline {
    forced-color-adjust: none;
    color: CanvasText;
  }
  .itsm-Sparkline__wash {
    fill: none;
  }
  .itsm-Sparkline__dot {
    fill: Highlight;
    stroke: Canvas;
  }
}
`,
);
