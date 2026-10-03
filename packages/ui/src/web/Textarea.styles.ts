import { css, layer } from '../styles/css.js';

/**
 * `Textarea`: what it adds to the box in `Input.styles.ts` (the v3 field:
 * control radius, `border.interactive` edge, halo focus, input text size) —
 * padding for more than one line, the vertical resize handle (none while it
 * grows by itself), and the footer row that holds the submit-shortcut hint
 * and the character count.
 */
export const textareaStyles = layer(
  'components',
  css`
.itsm-Textarea {
  display: block;
  padding-block: var(--itsm-space-xs);
  resize: vertical;
}

.itsm-Textarea--autoGrow {
  resize: none;
  overflow-y: hidden;
}

.itsm-TextareaField {
  display: flex;
  flex-direction: column;
  gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  min-inline-size: 0;
}

.itsm-TextareaField__footer {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  min-block-size: var(--itsm-text-footnote-line);
}

.itsm-TextareaField__hint {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
}
`,
);
