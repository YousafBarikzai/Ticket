import { css, layer, mq } from '../styles/css.js';

/**
 * `SearchTrigger` v3 (v3 §2.14): a button dressed as a search field on the
 * opaque top bars — 34 px, 236 px wide by default, radius 8, a 1 px
 * `border.subtle` edge on `surface.raisedAlt`, the magnifier and the label in
 * `text.muted` at 500 13/18, and the key caps ("⌘K" / "Ctrl K") at the end.
 * The top bars set its width where they place it (200 in narrower columns).
 *
 * `--icon`, and every trigger below 1024 px, is the magnifier alone, a 34 px
 * square without the field's edge, keeping its label as its name.
 */
export const searchTriggerStyles = layer(
  'components',
  css`
.itsm-SearchTrigger {
  --_size: calc(var(--itsm-control-height-md) - var(--itsm-space-3xs));
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  inline-size: 14.75rem;
  max-inline-size: 100%;
  min-inline-size: 0;
  block-size: var(--_size);
  margin: 0;
  padding: 0 var(--itsm-space-2xs) 0 var(--itsm-space-sm);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-md);
  background-color: var(--itsm-colour-surface-raisedAlt);
  color: var(--itsm-colour-text-muted);
  font: inherit;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-font-weight-medium);
  text-align: start;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard), border-color var(--itsm-duration-fast) var(--itsm-easing-standard), color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-SearchTrigger:hover {
  border-color: var(--itsm-colour-border-soft);
  background-color: var(--itsm-colour-surface-hover);
  color: var(--itsm-colour-text-primary);
}
.itsm-SearchTrigger:active {
  background-color: var(--itsm-colour-fill-pressed);
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
  inline-size: var(--_size);
  padding: 0;
  border-color: transparent;
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
.itsm-SearchTrigger--icon:hover {
  border-color: transparent;
}

${mq.belowLg} {
  .itsm-SearchTrigger {
    justify-content: center;
    inline-size: var(--_size);
    padding: 0;
    border-color: transparent;
    background-color: transparent;
  }
  .itsm-SearchTrigger:hover {
    border-color: transparent;
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
  border-color: var(--itsm-colour-border-strong);
}
@media (prefers-contrast: more) {
  .itsm-SearchTrigger:not(.itsm-SearchTrigger--icon) {
    border-color: var(--itsm-colour-border-strong);
  }
}
${mq.forcedColors} {
  .itsm-SearchTrigger {
    border: var(--itsm-hairline) solid ButtonText;
  }
}
`,
);
