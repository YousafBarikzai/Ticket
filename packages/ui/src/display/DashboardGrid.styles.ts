import { css, layer } from '../styles/css.js';

const spans = [3, 4, 5, 6, 7, 8, 9, 12] as const;

/**
 * `DashboardGrid` and `GridItem` (v3 §2.13, §2.8 grid gaps).
 *
 * Twelve equal tracks of `minmax(0, 1fr)`, so a wide table or a long word in
 * one card can never push its neighbours out of line. Every rule is a
 * container query on `itsm-dash`: below 45 rem each item spans the row
 * (phones, a narrow pane), and the gap steps 12 → 16 → 20 at 45 and 60 rem.
 * Items stretch to the row's height and hand it to their last child, so
 * cards side by side end level even under a section header.
 */
export const dashboardGridStyles = layer(
  'components',
  css`
.itsm-DashboardGrid {
  container: itsm-dash / inline-size;
  min-inline-size: 0;
}

.itsm-DashboardGrid__grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--itsm-space-sm);
  align-items: stretch;
}

.itsm-GridItem {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
}

.itsm-GridItem > :last-child {
  flex: 1 1 auto;
}

@container itsm-dash (min-width: 45rem) {
  .itsm-DashboardGrid__grid {
    gap: var(--itsm-space-md);
  }
${spans.map((span) => `  .itsm-GridItem[data-span="${span}"] { grid-column: span ${span}; }`).join('\n')}
}

@container itsm-dash (min-width: 60rem) {
  .itsm-DashboardGrid__grid {
    gap: var(--itsm-space-ml);
  }
}
`,
);
