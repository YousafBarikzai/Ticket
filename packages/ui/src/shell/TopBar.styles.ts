import { css, layer, mq } from '../styles/css.js';

/**
 * `TopBar`: the Help Portal's 56 px bar (v3 §3.6). Opaque `surface.raised`
 * with a 1 px `border.subtle` hairline always drawn — the v2 glass is gone
 * from top bars (A2 S-3); tab bars keep it — sticky under any system bar at
 * `--itsm-system-bar-h`, at the header's z-index. The safe areas of a
 * notched phone are kept clear on every side.
 *
 * Start: the product mark (32 px) and, from 1280 px, "IT Service
 * Management" in the `lockup` style, as one link; then the area switcher.
 * With a centre slot (the portal's pills) the bar is a three-column grid so
 * the pills are centred on the window. `material="canvas"` draws it flat on
 * the canvas, unstuck, for status screens.
 */
export const topBarStyles = layer(
  'components',
  css`
.itsm-TopBar {
  position: sticky;
  inset-block-start: var(--itsm-system-bar-h);
  z-index: var(--itsm-z-header);
  box-sizing: border-box;
  padding-block-start: var(--itsm-safe-area-top);
  border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  background: var(--itsm-colour-surface-raised);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
}
.itsm-TopBar[data-material="canvas"] {
  position: static;
  border-block-end-color: transparent;
  background: var(--itsm-colour-surface-canvas);
}

.itsm-TopBar__inner {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  box-sizing: border-box;
  min-block-size: var(--itsm-topbar-height);
  padding-inline: max(var(--itsm-page-gutter), var(--itsm-safe-area-left)) max(var(--itsm-page-gutter), var(--itsm-safe-area-right));
}
.itsm-TopBar__inner[data-has-center] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
}

.itsm-TopBar__start {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
}
.itsm-TopBar__center {
  display: flex;
  justify-content: center;
  min-inline-size: 0;
}
.itsm-TopBar__end {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  gap: var(--itsm-space-2xs);
}

.itsm-TopBar__brand {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.6875rem;
  min-inline-size: 0;
  padding: var(--itsm-space-3xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-primary);
  text-decoration: none;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-TopBar__brand:hover {
  background: var(--itsm-colour-surface-hover);
}
.itsm-TopBar__brandName {
  display: none;
  overflow: hidden;
  font-family: var(--itsm-text-lockup-family);
  font-size: var(--itsm-text-lockup-size);
  line-height: var(--itsm-text-lockup-line);
  font-weight: var(--itsm-text-lockup-weight);
  letter-spacing: var(--itsm-text-lockup-tracking);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-TopBar__area {
  display: inline-flex;
  flex: none;
  min-inline-size: 0;
}
.itsm-TopBar__title {
  min-inline-size: 0;
  overflow: hidden;
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  font-weight: var(--itsm-text-headline-weight);
  letter-spacing: var(--itsm-text-headline-tracking);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The product's name only where there is room for it beside the pills (A2 §6.2). */
${mq.xl} {
  .itsm-TopBar__brandName {
    display: inline;
  }
}

${mq.forcedColors} {
  .itsm-TopBar {
    border-block-end-color: CanvasText;
  }
}
@media print {
  .itsm-TopBar {
    position: static;
  }
}
`,
);
