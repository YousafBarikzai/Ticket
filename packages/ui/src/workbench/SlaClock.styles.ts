import { css, layer } from '../styles/css.js';

/**
 * `SlaClock`. `itsm-SlaClock--urgent` is pinned by its tests and has no rule
 * of its own: the badge inside carries the urgency.
 */
export const slaClockStyles = layer(
  'components',
  css`
.itsm-SlaClock { display: inline-flex; align-items: center; gap: var(--itsm-space-xs); }
.itsm-SlaClock__label { font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-secondary); }
`,
);
