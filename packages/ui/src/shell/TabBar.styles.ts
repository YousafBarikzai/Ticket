import { css, layer, mq } from '../styles/css.js';

/**
 * `TabBar`: the portal's phone navigation, docked to the bottom edge (X-91):
 * full width, 56 px plus the home-indicator safe area, on glass
 * (`material.chrome`) with a hairline above. Five equal tabs, icon over a
 * `footnote` label, each at least 44 px tall.
 *
 * The current tab puts its icon on an opaque `surface.selected` pill — the
 * one thing that must read is never text on bare glass — in the accent, with
 * the label in `text.primary` at 600. The others are `text.secondary`.
 * Counts ride on the icon's corner.
 *
 * Hidden from 768 px (the top bar's pills take over), while the software
 * keyboard is up, and during full-screen flows (the `hidden` attribute).
 */
export const tabBarStyles = layer(
  'components',
  css`
.itsm-TabBar {
  box-sizing: border-box;
  block-size: var(--itsm-tabbar-height);
  padding-block-end: var(--itsm-safe-area-bottom);
  padding-inline: var(--itsm-safe-area-left) var(--itsm-safe-area-right);
  border-block-start: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  background: var(--itsm-colour-material-chrome);
  -webkit-backdrop-filter: var(--itsm-material-chrome-filter);
  backdrop-filter: var(--itsm-material-chrome-filter);
  font-family: var(--itsm-font-family-sans);
}
.itsm-TabBar__list {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  block-size: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}
.itsm-TabBar__entry {
  display: flex;
  min-inline-size: 0;
}
.itsm-TabBar__item {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
  min-block-size: var(--itsm-control-height-lg);
  color: var(--itsm-colour-text-secondary);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
}
.itsm-TabBar__item:focus-visible {
  outline-offset: calc(-1 * var(--itsm-focus-width));
  border-radius: var(--itsm-radius-lg);
}
.itsm-TabBar__pill {
  position: relative;
  display: grid;
  place-items: center;
  inline-size: 3.5rem;
  block-size: var(--itsm-control-height-sm);
  border-radius: var(--itsm-radius-pill);
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-TabBar__item:active .itsm-TabBar__pill {
  background: var(--itsm-colour-fill-pressed);
}
.itsm-TabBar__item[aria-current="page"] {
  color: var(--itsm-colour-text-primary);
}
.itsm-TabBar__item[aria-current="page"] .itsm-TabBar__pill {
  background: var(--itsm-colour-surface-selected);
}
.itsm-TabBar__item[aria-current="page"] .itsm-TabBar__icon {
  color: var(--itsm-colour-accent);
}
.itsm-TabBar__label {
  max-inline-size: 100%;
  overflow: hidden;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-TabBar__item[aria-current="page"] .itsm-TabBar__label {
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-TabBar__badge {
  position: absolute;
  inset-block-start: calc(-1 * var(--itsm-space-2xs));
  inset-inline-start: calc(50% + var(--itsm-space-xs));
  box-shadow: 0 0 0 var(--itsm-border-thick) var(--itsm-colour-focusGap);
}

${mq.md} {
  .itsm-TabBar {
    display: none;
  }
}

${mq.forcedColors} {
  .itsm-TabBar {
    border-block-start-color: CanvasText;
  }
  .itsm-TabBar__item[aria-current="page"] .itsm-TabBar__pill {
    outline: var(--itsm-border-thick) solid Highlight;
  }
}
`,
);
