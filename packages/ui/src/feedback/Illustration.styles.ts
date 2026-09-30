import { css, layer, mq } from '../styles/css.js';

/**
 * `StateIllustration`: every part painted from a token, so a drawing reads
 * right on a white card, a black canvas and in both high-contrast themes.
 *
 * The outlines are `border.interactive` — the grey the product draws control
 * edges in — and the detail is `border.subtle`, fainter on purpose: the lines
 * of text on a page in a drawing should recede. The one accented stroke takes
 * the tone (`--_itsm-art-accent`, a component-local property) and its tint.
 *
 * Forced colours: the drawing opts out of the browser's own adjustment and
 * paints itself in system colours instead, so the outlines stay outlines
 * rather than all becoming one flat colour.
 */
export const illustrationStyles = layer(
  'components',
  css`
.itsm-Illustration {
  --_itsm-art-accent: var(--itsm-colour-accent);
  --_itsm-art-soft: var(--itsm-colour-brand-subtle);
  display: block;
  flex-shrink: 0;
  inline-size: calc(var(--itsm-space-4xl) * 2);
  block-size: auto;
  aspect-ratio: 4 / 3;
  overflow: visible;
}

.itsm-Illustration[data-size="md"] {
  inline-size: calc(var(--itsm-space-3xl) * 2);
}

.itsm-Illustration[data-size="sm"] {
  inline-size: calc(var(--itsm-space-2xl) * 2);
}

.itsm-Illustration[data-tone="neutral"] {
  --_itsm-art-accent: var(--itsm-colour-text-muted);
  --_itsm-art-soft: var(--itsm-colour-neutral-subtle);
}

.itsm-Illustration[data-tone="success"] {
  --_itsm-art-accent: var(--itsm-colour-success-border);
  --_itsm-art-soft: var(--itsm-colour-success-subtle);
}

.itsm-Illustration[data-tone="warning"] {
  --_itsm-art-accent: var(--itsm-colour-warning-border);
  --_itsm-art-soft: var(--itsm-colour-warning-subtle);
}

.itsm-Illustration[data-tone="danger"] {
  --_itsm-art-accent: var(--itsm-colour-danger-border);
  --_itsm-art-soft: var(--itsm-colour-danger-subtle);
}

.itsm-Illustration__plate {
  fill: var(--itsm-colour-fill-secondary);
}

.itsm-Illustration__surface {
  fill: var(--itsm-colour-surface-raised);
  stroke: var(--itsm-colour-border-interactive);
  stroke-width: 2;
}

.itsm-Illustration__line {
  stroke: var(--itsm-colour-border-interactive);
  stroke-width: 2;
}

.itsm-Illustration__detail {
  stroke: var(--itsm-colour-border-subtle);
  stroke-width: 3;
}

.itsm-Illustration__dashed {
  fill: var(--itsm-colour-surface-raised);
  stroke: var(--itsm-colour-border-interactive);
  stroke-width: 2;
  stroke-dasharray: 3 4;
}

.itsm-Illustration__accent {
  stroke: var(--_itsm-art-accent);
  stroke-width: 3;
}

.itsm-Illustration__accentFill {
  fill: var(--_itsm-art-accent);
}

.itsm-Illustration__accentSoft {
  fill: var(--_itsm-art-soft);
}

.itsm-Illustration__gap {
  stroke: var(--itsm-colour-surface-raised);
  stroke-width: 9;
}

.itsm-Illustration__inverse {
  stroke: var(--itsm-colour-surface-raised);
  stroke-width: 2.5;
}

${mq.forcedColors} {
  .itsm-Illustration {
    forced-color-adjust: none;
  }

  .itsm-Illustration__plate {
    fill: none;
  }

  .itsm-Illustration__surface,
  .itsm-Illustration__dashed {
    fill: Canvas;
    stroke: CanvasText;
  }

  .itsm-Illustration__line,
  .itsm-Illustration__detail {
    stroke: CanvasText;
  }

  .itsm-Illustration__accent {
    stroke: Highlight;
  }

  .itsm-Illustration__accentFill {
    fill: Highlight;
  }

  .itsm-Illustration__accentSoft {
    fill: Canvas;
  }

  .itsm-Illustration__gap,
  .itsm-Illustration__inverse {
    stroke: Canvas;
  }
}
`,
);
