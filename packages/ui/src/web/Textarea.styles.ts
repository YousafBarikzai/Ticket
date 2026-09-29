import { css, layer } from '../styles/css.js';

/**
 * `Textarea`: what it adds to the box in `Input.styles.ts`.
 */
export const textareaStyles = layer(
  'components',
  css`
.itsm-Textarea { min-height: calc(var(--itsm-control-height-lg) * 2); resize: vertical; line-height: var(--itsm-line-height-normal); }
`,
);
