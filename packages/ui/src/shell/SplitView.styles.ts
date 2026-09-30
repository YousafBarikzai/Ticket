import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `SplitView`: panes side by side, each scrolling on its own and each a
 * container (`container-type: inline-size`) so what is inside adapts to the
 * pane rather than the window.
 *
 * The separators are hairlines with a wider invisible grip (8 px, 24 px on
 * touch) that turn accent on hover, on keyboard focus and while dragging —
 * the colour appears after a short delay on hover so a pointer crossing the
 * line does not flash it. A collapsed pane leaves the separator as the only
 * trace, and Enter or a double-click brings it back.
 */
export const splitViewStyles = layer(
  'components',
  css`
.itsm-SplitView {
  display: flex;
  block-size: 100%;
  min-block-size: 0;
  min-inline-size: 0;
}

.itsm-SplitView__pane {
  flex: none;
  box-sizing: border-box;
  min-block-size: 0;
  overflow: auto;
  overscroll-behavior: contain;
  container-type: inline-size;
}
.itsm-SplitView__pane[data-fluid] {
  flex: 1 1 0;
}
.itsm-SplitView__pane[data-collapsed] {
  display: none;
}

.itsm-SplitView__separator {
  position: relative;
  z-index: var(--itsm-z-sticky);
  flex: none;
  inline-size: var(--itsm-hairline);
  background: var(--itsm-colour-border-subtle);
  cursor: col-resize;
  touch-action: none;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-SplitView__separator::before {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline: calc(-1 * var(--itsm-space-2xs));
}
.itsm-SplitView__separator::after {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: 50%;
  inline-size: 3px;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-accent);
  opacity: 0;
  transform: translateX(-50%);
  transition: opacity var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-SplitView__separator:hover::after {
  opacity: 1;
  transition-delay: var(--itsm-duration-fast);
}
.itsm-SplitView__separator:focus-visible::after,
.itsm-SplitView__separator[data-dragging]::after {
  opacity: 1;
  transition-delay: 0s;
}
.itsm-SplitView__separator:focus-visible {
  outline: none;
  box-shadow: none;
}
.itsm-SplitView__separator[data-collapsed] {
  inline-size: var(--itsm-border-thick);
  background: var(--itsm-colour-border-interactive);
}

${mq.coarse} {
  .itsm-SplitView__separator::before {
    inset-inline: calc(-1 * var(--itsm-space-sm));
  }
}

${mq.reducedMotion} {
  .itsm-SplitView__separator,
  .itsm-SplitView__separator::after {
    transition: none;
  }
}
${prefers.reducedMotion} .itsm-SplitView__separator::after {
  transition: none;
}

${mq.forcedColors} {
  .itsm-SplitView__separator {
    background: CanvasText;
  }
  .itsm-SplitView__separator::after {
    background: Highlight;
  }
}
`,
);
