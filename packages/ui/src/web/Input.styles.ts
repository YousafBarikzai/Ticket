import { moreContrast } from '../feedback/tone.js';
import { css, layer, mq } from '../styles/css.js';

/**
 * `Input`, and the box it shares with `Textarea`, `Select` and every field
 * in `controls/` (through `.itsm-InputGroup`).
 *
 * One rule for all of them because they are one control to the person
 * filling the form in: the same height, border, focus, invalid and disabled
 * states. What only one of them needs is in its own module, which the
 * registry orders after this one.
 *
 * v3 (§2.9, §2.14, A1 §5.5 and §7.17):
 * - 36 px with the control radius (8), a `border.interactive` edge (3:1 on
 *   every surface) firming to `border.strong` under the pointer, on the
 *   raised surface with the `xs` shadow. `size="lg"` is 44 px with the
 *   `item` radius (10) and 15 px text, for the sign-in pages.
 * - The text is `--itsm-input-font-size`: 14 px, and 16 px under a coarse
 *   pointer, because anything under 16 px makes iOS Safari zoom the page
 *   when the field is focused. The small and large sizes never go under it.
 * - Focus is the PMO's halo, not the ring every other control draws: no
 *   outline, the border turns accent, and a one-pixel accent ring plus a
 *   4 px `focusHalo` wash sit round it — a 2 px accent edge (4:1 on white)
 *   with a soft glow. The high-contrast themes make the halo transparent, so
 *   there the v2 outline comes back at their wider focus width; forced
 *   colours draw a 2 px `Highlight` outline, because they drop box-shadows.
 * - Invalid is a thicker danger edge (the icon and message come from the
 *   field) and, when focused, the same halo in danger at 18 %.
 * - Disabled is the disabled text on the sunken surface, never opacity.
 *   Read-only stays focusable and selectable, on the sunken surface too.
 */
export const inputStyles = layer(
  'components',
  css`
.itsm-Input,
.itsm-Textarea,
.itsm-Select,
.itsm-InputGroup {
  box-sizing: border-box;
  inline-size: 100%;
  min-inline-size: 0;
  min-block-size: var(--itsm-control-height-md);
  margin: 0;
  padding-block: 0;
  padding-inline: var(--itsm-space-sm);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-interactive);
  border-radius: var(--itsm-radius-lg);
  background-color: var(--itsm-colour-surface-raised);
  color: var(--itsm-colour-text-primary);
  box-shadow: var(--itsm-elevation-xs);
  font-family: inherit;
  font-size: var(--itsm-input-font-size);
  line-height: var(--itsm-text-body-line);
  letter-spacing: var(--itsm-text-body-tracking);
  font-weight: var(--itsm-font-weight-regular);
  transition:
    border-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard),
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-Input--sm,
.itsm-InputGroup--sm,
.itsm-Select--sm {
  min-block-size: var(--itsm-control-height-sm);
  padding-inline: calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
  border-radius: var(--itsm-radius-md);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}

.itsm-Input--lg,
.itsm-InputGroup--lg,
.itsm-Select--lg {
  min-block-size: var(--itsm-control-height-lg);
  padding-inline: var(--itsm-space-md);
  border-radius: var(--itsm-radius-item);
  font-size: max(var(--itsm-font-size-md), var(--itsm-input-font-size));
  line-height: var(--itsm-text-headline-line);
  letter-spacing: 0;
}

.itsm-Input::placeholder,
.itsm-Textarea::placeholder,
.itsm-InputGroup__input::placeholder {
  color: var(--itsm-colour-text-muted);
  opacity: 1;
}

.itsm-Input:hover,
.itsm-Textarea:hover,
.itsm-Select:hover,
.itsm-InputGroup:hover {
  border-color: var(--itsm-colour-border-strong);
}

.itsm-Input:focus-visible,
.itsm-Textarea:focus-visible,
.itsm-Select:focus-visible,
.itsm-InputGroup:has(.itsm-InputGroup__input:focus-visible) {
  border-color: var(--itsm-colour-accent);
  outline: none;
  box-shadow:
    0 0 0 var(--itsm-border-hair) var(--itsm-colour-accent),
    0 0 0 var(--itsm-space-2xs) var(--itsm-colour-focusHalo);
}

.itsm-Input[aria-invalid="true"],
.itsm-Textarea[aria-invalid="true"],
.itsm-Select[aria-invalid="true"],
.itsm-InputGroup[data-invalid] {
  border-color: var(--itsm-colour-danger-border);
  box-shadow: inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-danger-border), var(--itsm-elevation-xs);
}
.itsm-Input[aria-invalid="true"]:focus-visible,
.itsm-Textarea[aria-invalid="true"]:focus-visible,
.itsm-Select[aria-invalid="true"]:focus-visible,
.itsm-InputGroup[data-invalid]:has(.itsm-InputGroup__input:focus-visible) {
  border-color: var(--itsm-colour-danger-border);
  box-shadow:
    0 0 0 var(--itsm-border-hair) var(--itsm-colour-danger-border),
    0 0 0 var(--itsm-space-2xs) color-mix(in srgb, var(--itsm-colour-danger-border) 18%, transparent);
}

.itsm-Input[readonly],
.itsm-Textarea[readonly],
.itsm-InputGroup[data-readonly] {
  border-color: var(--itsm-colour-border-subtle);
  background-color: var(--itsm-colour-surface-sunken);
  box-shadow: none;
}

.itsm-Input:disabled,
.itsm-Textarea:disabled,
.itsm-Select:disabled,
.itsm-InputGroup[data-disabled] {
  border-color: var(--itsm-colour-border-subtle);
  background-color: var(--itsm-colour-surface-sunken);
  box-shadow: none;
  color: var(--itsm-colour-text-disabled);
  -webkit-text-fill-color: var(--itsm-colour-text-disabled);
  opacity: 1;
  cursor: not-allowed;
}

/* Number spinners: hidden. A stepped number is a NumberField. */
.itsm-Input[type="number"],
.itsm-InputGroup__input[type="number"] {
  -moz-appearance: textfield;
  appearance: textfield;
}
.itsm-Input[type="number"]::-webkit-inner-spin-button,
.itsm-Input[type="number"]::-webkit-outer-spin-button,
.itsm-InputGroup__input[type="number"]::-webkit-inner-spin-button,
.itsm-InputGroup__input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* The box with adornments: it draws the border and ring, the input inside draws nothing. */

.itsm-InputGroup {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  cursor: text;
}

.itsm-InputGroup__input {
  flex: 1 1 auto;
  align-self: stretch;
  inline-size: 100%;
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  outline: none;
}
.itsm-InputGroup__input:disabled {
  color: inherit;
  -webkit-text-fill-color: currentColor;
  cursor: not-allowed;
}
.itsm-InputGroup__input::-webkit-search-decoration,
.itsm-InputGroup__input::-webkit-search-cancel-button {
  -webkit-appearance: none;
  appearance: none;
}

.itsm-InputGroup__prefix,
.itsm-InputGroup__suffix {
  display: inline-flex;
  flex: none;
  align-items: center;
  color: var(--itsm-colour-text-muted);
  pointer-events: none;
}

.itsm-InputGroup__suffix:empty {
  display: none;
}

.itsm-InputGroup__suffix {
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.itsm-InputGroup__clear {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  inline-size: calc(var(--itsm-icon-md) + var(--itsm-space-2xs) + var(--itsm-space-3xs));
  block-size: calc(var(--itsm-icon-md) + var(--itsm-space-2xs) + var(--itsm-space-3xs));
  margin-inline-end: calc(-1 * var(--itsm-space-2xs));
  padding: 0;
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-pill);
  background: transparent;
  color: var(--itsm-colour-text-muted);
  cursor: pointer;
  transition:
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard),
    color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-InputGroup__clear:hover {
  background-color: var(--itsm-colour-fill-hover);
  color: var(--itsm-colour-text-primary);
}
.itsm-InputGroup__clear:active {
  background-color: var(--itsm-colour-fill-pressed);
}

/* A small field still takes the coarse pointer's 16 px, or iOS zooms the page on focus. */
${mq.coarse} {
  .itsm-Input--sm,
  .itsm-InputGroup--sm,
  .itsm-Select--sm {
    font-size: var(--itsm-input-font-size);
  }
}

/*
 * The high-contrast themes make the halo transparent: their v2 outline comes
 * back, at their wider focus width, one pixel off the box.
 */
${moreContrast(
  (scope) => `${scope} :is(.itsm-Input, .itsm-Textarea, .itsm-Select):focus-visible,
${scope} .itsm-InputGroup:has(.itsm-InputGroup__input:focus-visible) {
  outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus);
  outline-offset: var(--itsm-border-hair);
}`,
)}

${mq.forcedColors} {
  .itsm-Input,
  .itsm-Textarea,
  .itsm-Select,
  .itsm-InputGroup {
    border-color: FieldText;
  }
  .itsm-Input:focus-visible,
  .itsm-Textarea:focus-visible,
  .itsm-Select:focus-visible,
  .itsm-InputGroup:has(.itsm-InputGroup__input:focus-visible) {
    outline: var(--itsm-border-thick) solid Highlight;
    outline-offset: var(--itsm-border-hair);
  }
  .itsm-Input:disabled,
  .itsm-Textarea:disabled,
  .itsm-Select:disabled,
  .itsm-InputGroup[data-disabled] {
    border-color: GrayText;
    color: GrayText;
    -webkit-text-fill-color: GrayText;
  }
}
`,
);
