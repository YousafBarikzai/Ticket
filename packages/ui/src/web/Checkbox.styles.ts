import { css, layer } from '../styles/css.js';

/**
 * `Checkbox`, and the `itsm-Choice` row it shares with `Switch` and each
 * `RadioGroup` option: a control, its label and an optional description.
 */
export const checkboxStyles = layer(
  'components',
  css`
.itsm-Choice { display: flex; align-items: flex-start; gap: var(--itsm-space-xs); cursor: pointer; padding-block: var(--itsm-space-3xs); }
.itsm-Choice__control { flex: none; margin-block-start: 2px; }
.itsm-Choice__label { font-size: var(--itsm-font-size-md); color: var(--itsm-colour-text-primary); }
.itsm-Choice__description { font-size: var(--itsm-font-size-xs); color: var(--itsm-colour-text-muted); }
.itsm-Choice[aria-disabled="true"] { cursor: not-allowed; }
.itsm-Choice[aria-disabled="true"] .itsm-Choice__label { color: var(--itsm-colour-text-disabled); }
`,
);
