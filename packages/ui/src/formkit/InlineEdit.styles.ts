import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `InlineEdit`.
 *
 * - **At rest** the value is plain text in the surrounding type — a title
 *   stays a title — on a ghost button whose box reaches a little past the
 *   text (a negative margin), so the words line up with the content around
 *   them while the target stays generous. Hover lays `fill.hover` under it
 *   (`fast`), pressed `fill.pressed`; nothing moves.
 * - **The pencil** fades in on hover and keyboard focus, and is always there
 *   on a coarse pointer (X-95). It sits on the first line of a wrapped value.
 *   While saving it is the spinner; after a save, a tick in the success
 *   colour for two seconds; read-only, a lock.
 * - **Editing**, the field takes the same box edge and — because its inline
 *   padding matches the button's — the text does not jump between the two.
 *   It inherits the surrounding size (a title edits at title size), but never
 *   below 17 px on touch screens, where a smaller field makes iOS zoom.
 * - **Messages**: an error in danger text with its icon; a conflict as a
 *   compact warning-tinted row with its two choices.
 */
export const inlineEditStyles = layer(
  'components',
  css`
.itsm-InlineEdit {
  display: block;
  min-inline-size: 0;
  max-inline-size: 100%;
}

.itsm-InlineEdit__trigger {
  display: inline-flex;
  align-items: flex-start;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  max-inline-size: calc(100% + 2 * var(--itsm-space-xs));
  min-block-size: var(--itsm-control-height-sm);
  margin-inline: calc(-1 * var(--itsm-space-xs));
  padding: var(--itsm-space-3xs) var(--itsm-space-xs);
  border: 0;
  border-radius: var(--itsm-radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-align: start;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-InlineEdit__trigger:hover {
  background: var(--itsm-colour-fill-hover);
}

.itsm-InlineEdit__trigger:active {
  background: var(--itsm-colour-fill-pressed);
}

.itsm-InlineEdit__trigger[aria-disabled="true"] {
  cursor: default;
}

.itsm-InlineEdit__trigger[aria-disabled="true"]:hover,
.itsm-InlineEdit__trigger[aria-disabled="true"]:active {
  background: transparent;
}

.itsm-InlineEdit__trigger[aria-busy="true"] {
  cursor: progress;
}

.itsm-InlineEdit__value {
  min-inline-size: 0;
  align-self: center;
  overflow-wrap: anywhere;
  white-space: pre-line;
}

.itsm-InlineEdit__value[data-empty] {
  color: var(--itsm-colour-text-muted);
}

/* The pencil: the height of one line of the value, so it sits on the first. */
.itsm-InlineEdit__adornment {
  flex: none;
  display: inline-flex;
  align-items: center;
  block-size: 1.5em;
  color: var(--itsm-colour-text-muted);
  opacity: 0;
  transition:
    opacity var(--itsm-duration-fast) var(--itsm-easing-standard),
    color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

@supports (block-size: 1lh) {
  .itsm-InlineEdit__adornment {
    block-size: 1lh;
  }
}

.itsm-InlineEdit__trigger:hover .itsm-InlineEdit__adornment,
.itsm-InlineEdit__trigger:focus-visible .itsm-InlineEdit__adornment,
.itsm-InlineEdit[data-state="readonly"] .itsm-InlineEdit__adornment,
.itsm-InlineEdit:is([data-status="saving"], [data-status="saved"], [data-status="error"]) .itsm-InlineEdit__adornment {
  opacity: 1;
}

.itsm-InlineEdit[data-status="saved"] .itsm-InlineEdit__adornment {
  color: var(--itsm-colour-success-subtleText);
}

/* On a touch screen the pencil is always there and the target is a full control tall. */
${mq.coarse} {
  .itsm-InlineEdit__adornment {
    opacity: 1;
  }
  .itsm-InlineEdit__trigger {
    min-block-size: var(--itsm-control-height-md);
    align-items: center;
  }
}

/* Editing. */

.itsm-InlineEdit__editor {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-2xs);
  margin-inline: calc(-1 * var(--itsm-space-xs));
}

.itsm-InlineEdit__control {
  flex: 1;
  min-inline-size: 0;
}

.itsm-InlineEdit__control :is(.itsm-Input, .itsm-Textarea, .itsm-Select) {
  padding-inline: calc(var(--itsm-space-xs) - var(--itsm-border-hair));
  font-size: inherit;
  line-height: inherit;
  letter-spacing: inherit;
  font-weight: inherit;
}

.itsm-InlineEdit__control .itsm-Select {
  padding-inline-end: calc(var(--itsm-space-sm) + var(--itsm-icon-sm) + var(--itsm-space-xs));
}

${mq.coarse} {
  .itsm-InlineEdit__control :is(.itsm-Input, .itsm-Textarea, .itsm-Select) {
    font-size: max(1em, var(--itsm-text-headline-size));
  }
}

.itsm-InlineEdit__actions {
  flex: none;
  display: inline-flex;
  gap: var(--itsm-space-3xs);
  padding-block-start: calc((var(--itsm-control-height-md) - var(--itsm-control-height-sm)) / 2);
}

/* While a searching or calendar editor is fetched: the field's shape, the value, a spinner. */
.itsm-InlineEdit__pending {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  min-block-size: var(--itsm-control-height-md);
  padding-inline: calc(var(--itsm-space-xs) - var(--itsm-border-hair));
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-lg);
  background: var(--itsm-colour-surface-sunken);
  color: var(--itsm-colour-text-secondary);
}

/* Messages under the value or the field. */

.itsm-InlineEdit__message {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-2xs);
  margin: var(--itsm-space-2xs) 0 0;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
  font-weight: var(--itsm-font-weight-medium);
  color: var(--itsm-colour-danger-subtleText);
}

.itsm-InlineEdit__messageIcon {
  flex: none;
  margin-block-start: calc((var(--itsm-text-footnote-line) - var(--itsm-icon-xs)) / 2);
}

.itsm-InlineEdit__conflict {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs) var(--itsm-space-sm);
  margin-block-start: var(--itsm-space-2xs);
  padding: var(--itsm-space-xs) var(--itsm-space-sm);
  border-radius: var(--itsm-radius-lg);
  background: var(--itsm-colour-warning-subtle);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}

.itsm-InlineEdit__conflictIcon {
  flex: none;
  color: var(--itsm-colour-warning-subtleText);
}

.itsm-InlineEdit__conflictText {
  flex: 1 1 12rem;
  min-inline-size: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.itsm-InlineEdit__conflictText strong {
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-InlineEdit__conflictActions {
  display: flex;
  gap: var(--itsm-space-2xs);
  margin-inline-start: auto;
}

${moreContrast((scope) => `${scope} .itsm-InlineEdit__conflict { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-warning-border); }`)}

${mq.reducedMotion} {
  .itsm-InlineEdit__adornment {
    transition: none;
  }
}

${prefers.reducedMotion} .itsm-InlineEdit__adornment {
  transition: none;
}

${mq.forcedColors} {
  .itsm-InlineEdit__trigger:hover {
    outline: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-InlineEdit__adornment {
    opacity: 1;
    color: CanvasText;
  }
  .itsm-InlineEdit__message,
  .itsm-InlineEdit__conflictIcon {
    color: CanvasText;
  }
  .itsm-InlineEdit__conflict,
  .itsm-InlineEdit__pending {
    border: var(--itsm-hairline) solid CanvasText;
  }
}
`,
);
