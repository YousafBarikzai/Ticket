import { css, layer, mq } from '../styles/css.js';

/**
 * `UserMenu`: the account button and its menu's extras (the menu itself is
 * `Menu`'s surface and items).
 *
 * `--avatar`: the avatar alone, a round target with a ring of `fill.hover`
 * on hover. `--row`: the sidebar footer's full-width row — avatar, name in
 * `callout` 500, organisation in `footnote` `text.secondary`, and the ⇅
 * chevron that says a menu opens here. A count (the portal's approvals) sits
 * on the avatar's corner, ringed in the surface colour so it reads on any
 * backdrop.
 */
export const userMenuStyles = layer(
  'components',
  css`
.itsm-UserMenu {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  min-inline-size: 0;
  margin: 0;
  padding: var(--itsm-space-3xs);
  border: 0;
  border-radius: var(--itsm-radius-pill);
  background: transparent;
  color: var(--itsm-colour-text-primary);
  font: inherit;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  text-align: start;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-UserMenu:hover,
.itsm-UserMenu[aria-expanded="true"] {
  background: var(--itsm-colour-fill-hover);
}
.itsm-UserMenu:active {
  background: var(--itsm-colour-fill-pressed);
}

.itsm-UserMenu__avatar {
  position: relative;
  display: inline-flex;
  flex: none;
}
.itsm-UserMenu__badge {
  position: absolute;
  inset-block-start: calc(-1 * var(--itsm-space-2xs));
  inset-inline-end: calc(-1 * var(--itsm-space-2xs));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-inline-size: var(--itsm-icon-sm);
  block-size: var(--itsm-icon-sm);
  padding: 0 var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-brand-solid);
  color: var(--itsm-colour-brand-solidText);
  box-shadow: 0 0 0 var(--itsm-border-thick) var(--itsm-colour-focusGap);
  font-size: var(--itsm-text-caption-size);
  line-height: 1;
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.itsm-UserMenu__text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-inline-size: 0;
}
.itsm-UserMenu--avatar .itsm-UserMenu__text {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.itsm-UserMenu__name,
.itsm-UserMenu__detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-UserMenu__name {
  font-weight: var(--itsm-font-weight-medium);
}
.itsm-UserMenu__detail {
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}

.itsm-UserMenu--row {
  inline-size: 100%;
  padding: var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-lg);
}
.itsm-UserMenu__chevron {
  flex: none;
  margin-inline-start: auto;
  color: var(--itsm-colour-text-secondary);
}

.itsm-UserMenu__content {
  min-inline-size: 16rem;
}
.itsm-UserMenu__identity {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  padding: var(--itsm-space-xs);
}
.itsm-UserMenu__identityText {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
}
.itsm-UserMenu__identityName {
  overflow: hidden;
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-UserMenu__identityDetail {
  overflow: hidden;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-regular);
  text-overflow: ellipsis;
  white-space: nowrap;
}

button.itsm-UserMenu__signOut {
  inline-size: 100%;
  margin: 0;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: start;
}

${mq.forcedColors} {
  .itsm-UserMenu__badge {
    border: var(--itsm-hairline) solid CanvasText;
  }
}
`,
);
