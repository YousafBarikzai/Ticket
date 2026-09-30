import { css, layer, mq } from '../styles/css.js';

/**
 * `SearchTrigger`: a button dressed as Apple's search field — a filled
 * capsule in `fill.secondary`, the magnifier and the label in
 * `text.secondary`, the key caps at the end. No border on glass, where a
 * border's contrast cannot be promised (SPEC §1.3 rule a); in the
 * high-contrast themes, and wherever the person asked for more contrast, a
 * solid border gives it its shape.
 *
 * `--icon`, and every trigger below 768 px, is the magnifier alone, the size
 * of an icon button, keeping its label as its name.
 */
export const searchTriggerStyles = layer(
  'components',
  css`
.itsm-SearchTrigger {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  min-inline-size: 0;
  block-size: var(--itsm-control-height-md);
  margin: 0;
  padding: 0 var(--itsm-space-2xs) 0 var(--itsm-space-xs);
  border: 0;
  border-radius: var(--itsm-radius-lg);
  background-color: var(--itsm-colour-fill-secondary);
  color: var(--itsm-colour-text-secondary);
  font: inherit;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  text-align: start;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard), color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-SearchTrigger:hover {
  background-image: linear-gradient(var(--itsm-colour-fill-hover), var(--itsm-colour-fill-hover));
  color: var(--itsm-colour-text-primary);
}
.itsm-SearchTrigger:active {
  background-image: linear-gradient(var(--itsm-colour-fill-pressed), var(--itsm-colour-fill-pressed));
}
.itsm-SearchTrigger__icon {
  flex: none;
}
.itsm-SearchTrigger__label {
  flex: 1 1 auto;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-SearchTrigger__keys {
  flex: none;
  margin-inline-start: auto;
}

.itsm-SearchTrigger--icon {
  justify-content: center;
  inline-size: var(--itsm-control-height-md);
  padding: 0;
  border-radius: var(--itsm-radius-md);
  background-color: transparent;
}
.itsm-SearchTrigger--icon .itsm-SearchTrigger__label {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.itsm-SearchTrigger--icon .itsm-SearchTrigger__keys {
  display: none;
}

${mq.belowMd} {
  .itsm-SearchTrigger {
    justify-content: center;
    inline-size: var(--itsm-control-height-md);
    padding: 0;
    border-radius: var(--itsm-radius-md);
    background-color: transparent;
  }
  .itsm-SearchTrigger .itsm-SearchTrigger__label {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .itsm-SearchTrigger__keys {
    display: none;
  }
}

:root[data-itsm-theme="high-contrast"] .itsm-SearchTrigger:not(.itsm-SearchTrigger--icon),
:root[data-itsm-theme="high-contrast-dark"] .itsm-SearchTrigger:not(.itsm-SearchTrigger--icon) {
  box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-border-strong);
}
@media (prefers-contrast: more) {
  .itsm-SearchTrigger:not(.itsm-SearchTrigger--icon) {
    box-shadow: inset 0 0 0 var(--itsm-hairline) var(--itsm-colour-border-strong);
  }
}
${mq.forcedColors} {
  .itsm-SearchTrigger {
    border: var(--itsm-hairline) solid ButtonText;
  }
}
`,
);
