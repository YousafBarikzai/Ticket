import { css, layer, mq } from '../styles/css.js';

/**
 * `Select`: the shared field box (`Input.styles.ts`) with the browser's arrow
 * replaced by the registry chevron, which sits over the select's end padding
 * and lets the pointer through to it.
 */
export const selectStyles = layer(
  'components',
  css`
.itsm-SelectField {
  position: relative;
  display: block;
  inline-size: 100%;
  min-inline-size: 0;
}

.itsm-Select {
  display: block;
  -webkit-appearance: none;
  appearance: none;
  padding-inline-end: calc(var(--itsm-space-sm) + var(--itsm-icon-sm) + var(--itsm-space-xs));
  text-overflow: ellipsis;
  cursor: pointer;
}

.itsm-Select:has(> option[data-placeholder]:checked) {
  color: var(--itsm-colour-text-muted);
}

.itsm-Select option {
  color: var(--itsm-colour-text-primary);
}

.itsm-SelectField[data-multiple] .itsm-Select {
  padding-block: var(--itsm-space-2xs);
  padding-inline-end: var(--itsm-space-sm);
}

.itsm-SelectField__chevron {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-end: var(--itsm-space-sm);
  translate: 0 -50%;
  color: var(--itsm-colour-text-secondary);
  pointer-events: none;
}

.itsm-SelectField--sm .itsm-SelectField__chevron {
  inset-inline-end: calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
}

.itsm-Select:disabled + .itsm-SelectField__chevron {
  color: var(--itsm-colour-text-disabled);
}

${mq.forcedColors} {
  .itsm-Select {
    -webkit-appearance: auto;
    appearance: auto;
    padding-inline-end: var(--itsm-space-xs);
  }
  .itsm-SelectField__chevron {
    display: none;
  }
}
`,
);
