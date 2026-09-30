import { css, layer } from '../styles/css.js';

/**
 * `StatGrid`: stat cards in equal columns, two by two on a phone (X-94).
 *
 * The columns come from the grid's own width (a container query): at least
 * two, then as many as fit at `min` (180 px by default) — the `min()` in the
 * track size is what stops a narrow grid collapsing to one column. `columns`
 * pins the count: `2` always, `4` as two then four once four fit. Cards in a
 * row share its height, so their values sit on one line.
 */
export const statGridStyles = layer(
  'components',
  css`
.itsm-StatGrid {
  --_itsm-stat-min: 11.25rem;
  container: itsm-stats / inline-size;
  inline-size: 100%;
  min-inline-size: 0;
}

.itsm-StatGrid__items {
  --_itsm-stat-gap: var(--itsm-space-sm);
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(var(--_itsm-stat-min), calc(50% - var(--_itsm-stat-gap) / 2)), 1fr));
  gap: var(--_itsm-stat-gap);
}

.itsm-StatGrid[data-columns="2"] .itsm-StatGrid__items,
.itsm-StatGrid[data-columns="4"] .itsm-StatGrid__items {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@container itsm-stats (min-width: 48rem) {
  .itsm-StatGrid__items {
    --_itsm-stat-gap: var(--itsm-space-md);
  }
  .itsm-StatGrid[data-columns="4"] .itsm-StatGrid__items {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.itsm-StatGrid__items > * {
  min-inline-size: 0;
}
`,
);
