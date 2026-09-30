import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `TopBar`: 52 px, sticky, on glass — `material.chrome` at 0.92 with its
 * blur, turned solid by the tokens in the high-contrast themes, under reduced
 * transparency and where `backdrop-filter` is missing (SPEC §1.3). Text on it
 * is `text.primary` or `text.secondary` only.
 *
 * A hairline appears along its bottom edge once the page has scrolled under
 * it, where scroll-driven animations exist; elsewhere the hairline is always
 * there. The safe areas of a notched phone are kept clear on every side.
 *
 * With a centre slot (the portal's pills) the bar is a three-column grid so
 * the pills are centred on the window, not on what is left between the brand
 * and the account button.
 */
export const topBarStyles = layer(
  'components',
  css`
@keyframes itsm-TopBar-edge {
  from { border-block-end-color: transparent; }
  to { border-block-end-color: var(--itsm-colour-border-subtle); }
}

.itsm-TopBar {
  position: sticky;
  inset-block-start: 0;
  z-index: var(--itsm-z-header);
  box-sizing: border-box;
  padding-block-start: var(--itsm-safe-area-top);
  border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  background: var(--itsm-colour-material-chrome);
  -webkit-backdrop-filter: var(--itsm-material-chrome-filter);
  backdrop-filter: var(--itsm-material-chrome-filter);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
}
@supports (animation-timeline: scroll()) {
  .itsm-TopBar {
    animation: itsm-TopBar-edge linear both;
    animation-timeline: scroll(root block);
    animation-range: 0 var(--itsm-space-xs);
  }
}
.itsm-TopBar[data-material="canvas"] {
  position: static;
  border-block-end-color: transparent;
  background: var(--itsm-colour-surface-canvas);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  animation: none;
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
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
  padding: var(--itsm-space-3xs) var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-primary);
  text-decoration: none;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-TopBar__brand:hover {
  background: var(--itsm-colour-fill-hover);
}
.itsm-TopBar__brandName {
  overflow: hidden;
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  font-weight: var(--itsm-text-headline-weight);
  letter-spacing: var(--itsm-text-headline-tracking);
  text-overflow: ellipsis;
  white-space: nowrap;
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

${mq.belowSm} {
  .itsm-TopBar__brandName {
    font-size: var(--itsm-text-body-size);
  }
}

${mq.reducedMotion} {
  .itsm-TopBar {
    animation: none;
  }
}
${prefers.reducedMotion} .itsm-TopBar {
  animation: none;
}

${mq.forcedColors} {
  .itsm-TopBar {
    border-block-end-color: CanvasText;
    animation: none;
  }
}
`,
);
