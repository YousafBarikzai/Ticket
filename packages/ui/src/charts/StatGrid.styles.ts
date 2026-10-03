import { css, layer } from '../styles/css.js';

/**
 * `StatGrid`: stat cards in equal columns, two by two on a phone (X-94; v3
 * §2.13).
 *
 * The columns come from the grid's own width (a container query, `itsm-stats`):
 *
 * - unset: at least two, then as many as fit at `min` (180 px by default) —
 *   the `min()` in the track size is what stops a narrow grid collapsing to
 *   one column;
 * - `2`: always two; `4`: two, then four from 48 rem (v2, kept);
 * - `3`: two, then three from 35 rem;
 * - `6`: two, three from 35 rem, six from 60 rem — the dashboard's KPI row.
 *
 * The gap is the dashboard grid's (v3 §2.8): 12, 16 from 45 rem, 20 from
 * 60 rem, so a KPI row and the cards under it share their gutters. Cards in a
 * row share its height. Nothing scrolls sideways.
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
.itsm-StatGrid[data-columns="3"] .itsm-StatGrid__items,
.itsm-StatGrid[data-columns="4"] .itsm-StatGrid__items,
.itsm-StatGrid[data-columns="6"] .itsm-StatGrid__items {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@container itsm-stats (min-width: 35rem) {
  .itsm-StatGrid[data-columns="3"] .itsm-StatGrid__items,
  .itsm-StatGrid[data-columns="6"] .itsm-StatGrid__items {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@container itsm-stats (min-width: 45rem) {
  .itsm-StatGrid__items {
    --_itsm-stat-gap: var(--itsm-space-md);
  }
}

@container itsm-stats (min-width: 48rem) {
  .itsm-StatGrid[data-columns="4"] .itsm-StatGrid__items {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@container itsm-stats (min-width: 60rem) {
  .itsm-StatGrid__items {
    --_itsm-stat-gap: var(--itsm-space-ml);
  }
  .itsm-StatGrid[data-columns="6"] .itsm-StatGrid__items {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

.itsm-StatGrid__items > * {
  min-inline-size: 0;
}
`,
);
