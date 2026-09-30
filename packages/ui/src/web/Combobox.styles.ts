import { css, layer, mq } from '../styles/css.js';

/**
 * `Combobox` — and `PersonPicker`, which is one. `CommandPalette` borrows
 * `itsm-Combobox__meta` for its secondary line.
 *
 * The field is an `.itsm-InputGroup` (web/Input styles): the same box, ring,
 * invalid and disabled states as every text field. With `multiple` it wraps,
 * the chips on `fill.secondary` in the field's own rhythm, each with a
 * remove button that keeps a 24 px target.
 *
 * The list floats on `material.popover` like a menu — radius `xl`, 6 px
 * padding, options the nav-item height with radius `md` (concentric) — at
 * least as wide as the field. The active option is `surface.selected`; a
 * chosen one carries an accent check rather than a different weight, so the
 * text never reflows as the cursor moves. It fades in over `fast` and does
 * not scale: it appears under the caret while someone types.
 */
export const comboboxStyles = layer(
  'components',
  css`
.itsm-Combobox { position: relative; }
.itsm-Combobox--multiple {
  flex-wrap: wrap;
  gap: var(--itsm-space-2xs);
  padding-block: calc(var(--itsm-space-2xs) - var(--itsm-border-hair));
  padding-inline-start: var(--itsm-space-2xs);
}
.itsm-Combobox__input {
  flex: 1 1 4rem;
  min-inline-size: 4rem;
}
.itsm-Combobox--multiple .itsm-Combobox__input {
  min-block-size: calc(var(--itsm-control-height-md) - 2 * var(--itsm-space-2xs));
  padding-inline-start: var(--itsm-space-2xs);
}

.itsm-Combobox__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-3xs);
  max-inline-size: 100%;
  min-block-size: calc(var(--itsm-control-height-md) - 2 * var(--itsm-space-2xs) - 2 * var(--itsm-border-hair));
  padding-inline: var(--itsm-space-xs) var(--itsm-space-3xs);
  border-radius: var(--itsm-radius-sm);
  background: var(--itsm-colour-fill-secondary);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  letter-spacing: var(--itsm-text-subheadline-tracking);
}
.itsm-Combobox__chipLabel {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-Combobox__chipRemove {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  inline-size: var(--itsm-icon-xl);
  block-size: var(--itsm-icon-xl);
  margin-block: calc(-1 * var(--itsm-space-3xs));
  padding: 0;
  border: 0;
  border-radius: var(--itsm-radius-pill);
  background: transparent;
  color: var(--itsm-colour-text-muted);
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard), color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Combobox__chipRemove:hover {
  background: var(--itsm-colour-fill-hover);
  color: var(--itsm-colour-text-primary);
}
.itsm-Combobox__chipRemove:active { background: var(--itsm-colour-fill-pressed); }
.itsm-Combobox__spinner { flex: none; color: var(--itsm-colour-text-muted); }

.itsm-Combobox__popup {
  z-index: var(--itsm-z-dropdown);
  box-sizing: border-box;
  min-inline-size: var(--radix-popper-anchor-width);
  max-inline-size: min(max(var(--radix-popper-anchor-width), 22.5rem), calc(100vw - 2 * var(--itsm-space-xs)));
  max-block-size: min(20rem, var(--radix-popover-content-available-height, 20rem));
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  border: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-xl);
  background: var(--itsm-colour-material-popover);
  -webkit-backdrop-filter: var(--itsm-material-popover-filter);
  backdrop-filter: var(--itsm-material-popover-filter);
  box-shadow: var(--itsm-elevation-lg), var(--itsm-edge-highlight);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  outline: none;
  animation: itsm-overlay-fade-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}
.itsm-Combobox__popup[data-state="closed"] {
  animation: itsm-overlay-fade-out var(--itsm-duration-fast) var(--itsm-easing-exit) forwards;
}
.itsm-Combobox__list:empty { display: none; }

.itsm-Combobox__option {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  min-block-size: var(--itsm-nav-item-height);
  padding: var(--itsm-space-2xs) var(--itsm-space-xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-primary);
  cursor: pointer;
  user-select: none;
}
.itsm-Combobox__option[data-active="true"] { background: var(--itsm-colour-surface-selected); }
.itsm-Combobox__option[aria-disabled="true"] { color: var(--itsm-colour-text-disabled); cursor: not-allowed; }
.itsm-Combobox__option--create .itsm-Combobox__label { color: var(--itsm-colour-text-link); }
.itsm-Combobox__option--create .itsm-Combobox__lead { color: var(--itsm-colour-text-link); }
.itsm-Combobox__lead { flex: none; color: var(--itsm-colour-text-secondary); }
.itsm-Combobox__text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-inline-size: 0;
}
.itsm-Combobox__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-Combobox__meta {
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
  color: var(--itsm-colour-text-muted);
}
.itsm-Combobox__check { flex: none; margin-inline-start: auto; color: var(--itsm-colour-accent); }
.itsm-Combobox__group + .itsm-Combobox__group,
.itsm-Combobox__option + .itsm-Combobox__group { margin-block-start: var(--itsm-space-2xs); }
.itsm-Combobox__groupLabel {
  padding: var(--itsm-space-xs) var(--itsm-space-xs) var(--itsm-space-2xs);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  color: var(--itsm-colour-text-secondary);
}
.itsm-Combobox__status {
  padding: var(--itsm-space-xs);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  color: var(--itsm-colour-text-muted);
}

${mq.forcedColors} {
  .itsm-Combobox__popup { border-color: CanvasText; }
  .itsm-Combobox__option[data-active="true"] {
    forced-color-adjust: none;
    background: Highlight;
    color: HighlightText;
  }
  .itsm-Combobox__chip { border: var(--itsm-border-hair) solid CanvasText; }
}
`,
);
