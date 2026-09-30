import { css, layer, mq } from '../styles/css.js';

/**
 * `Tabs`, in two looks.
 *
 * `underline`: tabs over a hairline; the selected one is `text.primary` at
 * 600 over a 2 px accent bar that fades and widens in. `segmented`: the tabs
 * on a `fill.secondary` track, the selected one raised like the
 * `SegmentedControl` thumb (without the slide — a tab list may scroll).
 *
 * The tab list scrolls sideways when it is too narrow, and a scroll container
 * clips anything drawn outside it, so the tabs draw their focus ring inside
 * their own edge rather than two pixels outside it.
 */
export const tabsStyles = layer(
  'components',
  css`
.itsm-Tabs {
  min-inline-size: 0;
}

.itsm-Tabs__list {
  display: flex;
  gap: var(--itsm-space-2xs);
  overflow-x: auto;
  scrollbar-width: none;
}
.itsm-Tabs__list::-webkit-scrollbar {
  display: none;
}

.itsm-Tabs__tab {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  min-block-size: var(--itsm-control-height-md);
  margin: 0;
  padding-block: 0;
  padding-inline: var(--itsm-space-sm);
  border: 0;
  border-radius: var(--itsm-radius-md);
  background: none;
  color: var(--itsm-colour-text-secondary);
  font-family: inherit;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  font-weight: var(--itsm-font-weight-medium);
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    color var(--itsm-duration-fast) var(--itsm-easing-standard),
    background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-Tabs__tab:hover:not(:disabled) {
  color: var(--itsm-colour-text-primary);
}

.itsm-Tabs__tab[aria-selected="true"] {
  color: var(--itsm-colour-text-primary);
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-Tabs__tab:disabled {
  color: var(--itsm-colour-text-disabled);
  cursor: not-allowed;
}

.itsm-Tabs__tab:focus-visible {
  outline-offset: calc(-1 * var(--itsm-focus-width));
  box-shadow: none;
}

.itsm-Tabs__label {
  display: inline-flex;
  flex-direction: column;
}
.itsm-Tabs__label[data-text]::after {
  content: attr(data-text);
  block-size: 0;
  overflow: hidden;
  visibility: hidden;
  font-weight: var(--itsm-font-weight-semibold);
  user-select: none;
  pointer-events: none;
}

.itsm-Tabs__panel {
  padding-block: var(--itsm-space-md);
}

/* Underline */

.itsm-Tabs--underline .itsm-Tabs__list {
  box-shadow: inset 0 calc(-1 * var(--itsm-hairline)) 0 var(--itsm-colour-border-subtle);
}

.itsm-Tabs--underline .itsm-Tabs__tab {
  border-end-start-radius: 0;
  border-end-end-radius: 0;
}

.itsm-Tabs--underline .itsm-Tabs__tab::after {
  content: "";
  position: absolute;
  inset-inline: var(--itsm-space-sm);
  inset-block-end: 0;
  block-size: var(--itsm-border-thick);
  border-radius: var(--itsm-radius-pill);
  background-color: var(--itsm-colour-accent);
  opacity: 0;
  transform: scaleX(0.6);
  transition:
    opacity var(--itsm-duration-fast) var(--itsm-easing-standard),
    transform var(--itsm-duration-normal) var(--itsm-easing-entrance);
}

.itsm-Tabs--underline .itsm-Tabs__tab[aria-selected="true"]::after {
  opacity: 1;
  transform: none;
}

/* Segmented */

.itsm-Tabs--segmented .itsm-Tabs__list {
  display: inline-flex;
  box-sizing: border-box;
  max-inline-size: 100%;
  gap: var(--itsm-space-3xs);
  padding: var(--itsm-space-3xs);
  border-radius: var(--itsm-radius-lg);
  background-color: var(--itsm-colour-fill-secondary);
}

.itsm-Tabs--segmented .itsm-Tabs__tab {
  min-block-size: calc(var(--itsm-control-height-md) - 2 * var(--itsm-space-3xs));
  border-radius: calc(var(--itsm-radius-lg) - var(--itsm-space-3xs));
}

.itsm-Tabs--segmented .itsm-Tabs__tab:hover:not(:disabled):not([aria-selected="true"]) {
  background-color: var(--itsm-colour-fill-hover);
}

.itsm-Tabs--segmented .itsm-Tabs__tab[aria-selected="true"] {
  background-color: var(--itsm-colour-surface-overlay);
  background-image: linear-gradient(
    light-dark(transparent, var(--itsm-colour-fill-pressed)),
    light-dark(transparent, var(--itsm-colour-fill-pressed))
  );
  box-shadow: var(--itsm-elevation-xs), var(--itsm-elevation-sm), var(--itsm-edge-highlight);
}

${mq.forcedColors} {
  .itsm-Tabs--underline .itsm-Tabs__tab[aria-selected="true"]::after {
    background-color: Highlight;
  }
  .itsm-Tabs--segmented .itsm-Tabs__tab[aria-selected="true"] {
    forced-color-adjust: none;
    background-color: Highlight;
    color: HighlightText;
  }
}
`,
);
