import { css, layer, mq } from '../styles/css.js';

/**
 * `NumberField`: the shared field box (`Input.styles.ts`), with the number
 * set in tabular figures, and a stepper beside it — two buttons on one
 * `fill.secondary` capsule split by a hairline, the height of the field, as a
 * stepper is drawn on Apple's platforms.
 */
export const numberFieldStyles = layer(
  'components',
  css`
.itsm-NumberField {
  --_h: var(--itsm-control-height-md);
  display: flex;
  align-items: stretch;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
}
.itsm-NumberField--sm {
  --_h: var(--itsm-control-height-sm);
}
.itsm-NumberField--lg {
  --_h: var(--itsm-control-height-lg);
}

.itsm-NumberField .itsm-Input,
.itsm-NumberField .itsm-InputGroup {
  flex: 1 1 auto;
  inline-size: auto;
  font-variant-numeric: tabular-nums;
}

.itsm-NumberField__steppers {
  display: inline-flex;
  flex: none;
  align-items: center;
  block-size: var(--_h);
  border-radius: var(--itsm-radius-lg);
  background-color: var(--itsm-colour-fill-secondary);
  box-shadow: var(--itsm-elevation-xs);
}
.itsm-NumberField--sm .itsm-NumberField__steppers {
  border-radius: var(--itsm-radius-md);
}

.itsm-NumberField__step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: calc(var(--_h) + var(--itsm-space-2xs));
  block-size: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: var(--itsm-colour-text-primary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-NumberField__step:first-child {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
}
.itsm-NumberField__step:last-child {
  border-start-start-radius: 0;
  border-end-start-radius: 0;
}
.itsm-NumberField__step:hover:not(:disabled) {
  background-color: var(--itsm-colour-fill-hover);
}
.itsm-NumberField__step:active:not(:disabled) {
  background-color: var(--itsm-colour-fill-pressed);
}
.itsm-NumberField__step:disabled {
  color: var(--itsm-colour-text-disabled);
  cursor: not-allowed;
}

.itsm-NumberField__divider {
  flex: none;
  inline-size: var(--itsm-hairline);
  block-size: 50%;
  background-color: var(--itsm-colour-border-subtle);
}

${mq.forcedColors} {
  .itsm-NumberField__steppers {
    outline: var(--itsm-border-hair) solid ButtonText;
  }
  .itsm-NumberField__divider {
    background-color: ButtonText;
  }
  .itsm-NumberField__step:disabled {
    color: GrayText;
  }
}
`,
);
