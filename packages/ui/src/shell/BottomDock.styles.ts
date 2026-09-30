import { css, layer } from '../styles/css.js';

/**
 * `BottomDock`: the one owner of the phone's bottom edge (X-92). Fixed to
 * the viewport, clear of the sidebar in the sidebar apps (`--_dock-start`,
 * set by the frame), stacking its occupants top to bottom: the contextual
 * bar, then the tab bar. Toasts rise above it by reading the height it
 * publishes.
 *
 * The dock itself takes no pointer events, so the empty space beside a
 * floating bar never swallows a tap on the page underneath; its occupants
 * take them as usual.
 */
export const bottomDockStyles = layer(
  'components',
  css`
.itsm-BottomDock {
  position: fixed;
  inset-block-end: 0;
  inset-inline: var(--_dock-start, 0px) 0;
  z-index: var(--itsm-z-header);
  display: flex;
  flex-direction: column;
  pointer-events: none;
}
.itsm-BottomDock > * {
  pointer-events: auto;
}
.itsm-BottomDock__bar:empty,
.itsm-BottomDock__tabs:empty {
  display: none;
}
.itsm-BottomDock__bar {
  display: flex;
  flex-direction: column;
  pointer-events: none;
}
.itsm-BottomDock__bar > * {
  pointer-events: auto;
}
`,
);
