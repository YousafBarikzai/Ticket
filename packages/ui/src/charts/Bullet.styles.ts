import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq } from '../styles/css.js';
import { textureImages, textureVariables } from './texture-css.js';

const fills = (['success', 'warning', 'danger'] as const)
  .map((tone) => `.itsm-Bullet__fill[data-tone="${tone}"] { --_itsm-series: var(--itsm-colour-${tone}-border); }`)
  .join('\n');

/**
 * `BulletBar` and `BulletList` (A8 §4.6, the PMO's "By category").
 *
 * A row is a grid — label · track · value · detail — 32 px tall (24
 * compact), the label and the track sharing what the value and the detail
 * leave, two to three. In a list the rows are one subgrid, so every track
 * starts and ends together whatever its value's width. The track is 8 px (6
 * compact) of `fill.secondary`; the fill
 * the accent or its zone's chart colour; the shortfall to the target the
 * warning or danger *subtle* tint, the PMO's amber and pink segment; the
 * target a 2 × 14 tick in the marker navy; a run past the end hatched in
 * danger. Every colour is a token, every geometry an inline percentage.
 *
 * A linked row is the stretched-link pattern: the label's link covers the
 * row, and its focus ring is drawn round the row. With more contrast the
 * fills wear their tone's texture; in forced colours the fill is `Highlight`
 * and the shortfall an outline.
 */
export const bulletStyles = layer(
  'components',
  css`
.itsm-BulletList__rows {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.itsm-Bullet {
  --_itsm-series: var(--itsm-colour-accent);
  --_itsm-track: 0.5rem;
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) auto;
  align-items: center;
  column-gap: var(--itsm-space-sm);
  min-block-size: 2rem;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
}

.itsm-Bullet[data-detail] {
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) auto auto;
}

/* In a list the rows share one set of columns, so every track starts and ends together. */
@supports (grid-template-columns: subgrid) {
  .itsm-BulletList__rows {
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) auto;
    column-gap: var(--itsm-space-sm);
  }
  .itsm-BulletList[data-detail] .itsm-BulletList__rows {
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) auto auto;
  }
  .itsm-BulletList__rows > .itsm-Bullet {
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
  }
}

.itsm-Bullet[data-compact] {
  --_itsm-track: 0.375rem;
  min-block-size: 1.5rem;
}

${fills}

.itsm-Bullet__label {
  overflow: hidden;
  color: var(--itsm-colour-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.itsm-Bullet__link {
  color: inherit;
  text-decoration: none;
}

.itsm-Bullet__link::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--itsm-radius-md);
}

.itsm-Bullet__link:focus-visible {
  outline: none;
  box-shadow: none;
}

.itsm-Bullet__link:focus-visible::after {
  outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus);
  outline-offset: var(--itsm-focus-offset);
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap);
}

${mq.hover} {
  .itsm-Bullet[data-link]:hover {
    background: var(--itsm-colour-fill-hover);
  }
}

.itsm-Bullet__track {
  position: relative;
  block-size: var(--_itsm-track);
  border-radius: var(--itsm-radius-xs);
  background: var(--itsm-colour-fill-secondary);
}

.itsm-Bullet__fill,
.itsm-Bullet__gap,
.itsm-Bullet__over {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  border-radius: var(--itsm-radius-xs);
}

.itsm-Bullet__fill {
  background: var(--_itsm-series);
}

.itsm-Bullet__gap[data-tone="warning"] { background: var(--itsm-colour-warning-subtle); }
.itsm-Bullet__gap[data-tone="danger"] { background: var(--itsm-colour-danger-subtle); }

.itsm-Bullet__over {
  background: ${textureImages('var(--itsm-colour-danger-border)')[2]!}, var(--itsm-colour-danger-subtle);
}

.itsm-Bullet__tick {
  position: absolute;
  inset-block: calc((var(--_itsm-track) - 0.875rem) / 2);
  inline-size: 2px;
  margin-inline-start: -1px;
  background: var(--itsm-colour-chart-marker);
}

.itsm-Bullet__value {
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-primary);
  text-align: end;
  white-space: nowrap;
}

.itsm-Bullet__detail {
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-variant-numeric: tabular-nums;
  color: var(--itsm-colour-text-muted);
  white-space: nowrap;
}

.itsm-BulletList__toggle {
  min-block-size: var(--itsm-control-height-sm);
  padding-block: var(--itsm-space-2xs);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
  color: var(--itsm-colour-text-link);
  cursor: pointer;
}

${textureVariables('.itsm-Bullet__fill', { slots: false })}

${moreContrast(
  (scope) => `${scope} .itsm-Bullet__track { box-shadow: inset 0 0 0 1px var(--itsm-colour-border-strong); }
${scope} .itsm-Bullet__fill { --_itsm-ink: var(--_itsm-chart-surface, var(--itsm-colour-surface-raised)); background: var(--_itsm-texture, none), var(--_itsm-series); }`,
)}

${mq.forcedColors} {
  .itsm-Bullet__track,
  .itsm-Bullet__fill,
  .itsm-Bullet__gap,
  .itsm-Bullet__over,
  .itsm-Bullet__tick {
    forced-color-adjust: none;
  }
  .itsm-Bullet__track {
    background: Canvas;
    box-shadow: inset 0 0 0 1px GrayText;
  }
  .itsm-Bullet__fill {
    background: Highlight;
  }
  .itsm-Bullet__gap {
    background: Canvas;
    box-shadow: inset 0 0 0 1px CanvasText;
  }
  .itsm-Bullet__over {
    background: ${textureImages('CanvasText')[2]!}, Canvas;
  }
  .itsm-Bullet__tick {
    background: CanvasText;
  }
  .itsm-Bullet__link:focus-visible::after {
    outline-color: Highlight;
  }
}
`,
);
