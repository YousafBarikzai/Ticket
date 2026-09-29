import { css, layer } from '../styles/css.js';

/**
 * `Tooltip`.
 */
export const tooltipStyles = layer(
  'components',
  css`
.itsm-Tooltip { position: relative; display: inline-flex; }
.itsm-Tooltip__bubble {
  position: absolute;
  z-index: var(--itsm-z-tooltip);
  inset-block-end: calc(100% + var(--itsm-space-3xs));
  inset-inline-start: 50%;
  transform: translateX(-50%);
  max-inline-size: 18rem;
  padding: var(--itsm-space-3xs) var(--itsm-space-xs);
  background: var(--itsm-colour-surface-inverse);
  color: var(--itsm-colour-text-inverse);
  border-radius: var(--itsm-radius-sm);
  font-size: var(--itsm-font-size-xs);
  line-height: var(--itsm-line-height-snug);
  width: max-content;
}
`,
);
