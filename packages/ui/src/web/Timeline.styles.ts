import { css, layer } from '../styles/css.js';

/**
 * `Timeline`.
 */
export const timelineStyles = layer(
  'components',
  css`
.itsm-Timeline { list-style: none; margin: 0; padding: 0; }
.itsm-Timeline__item { position: relative; display: flex; gap: var(--itsm-space-sm); padding-block-end: var(--itsm-space-md); }
.itsm-Timeline__rail { position: relative; flex: none; display: flex; flex-direction: column; align-items: center; }
.itsm-Timeline__marker {
  inline-size: 12px;
  block-size: 12px;
  margin-block-start: 6px;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-neutral-solid);
}
.itsm-Timeline__line { flex: 1; inline-size: var(--itsm-border-thick); background: var(--itsm-colour-border-subtle); margin-block-start: var(--itsm-space-3xs); }
.itsm-Timeline__content { flex: 1; min-inline-size: 0; }
.itsm-Timeline__meta { display: flex; flex-wrap: wrap; gap: var(--itsm-space-2xs); align-items: baseline; font-size: var(--itsm-font-size-xs); color: var(--itsm-colour-text-muted); }
.itsm-Timeline__actor { font-weight: var(--itsm-font-weight-semibold); color: var(--itsm-colour-text-secondary); }
.itsm-Timeline__body { font-size: var(--itsm-font-size-md); color: var(--itsm-colour-text-primary); }
.itsm-Timeline__body--internal { background: var(--itsm-colour-warning-subtle); color: var(--itsm-colour-warning-subtleText); padding: var(--itsm-space-xs); border-radius: var(--itsm-radius-md); }
`,
);
