import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `CommandPalette`. The class names `__input`, `__empty` and the option
 * attributes are pinned by `command-palette.test.ts`.
 *
 * `material.popover` — glass at 0.96, solid where transparency is reduced or
 * contrast raised — 640 px wide, 12vh from the top, radius `3xl`, elevation
 * `xl`, over the blurred scrim. The field is `title3`-sized type with the
 * magnifier (or a back chevron and the page's chips on a nested page); the
 * results are `callout` rows at the nav-item height, highlighted on
 * `surface.selected` with `text.primary` (never link blue), the matched part
 * of the label in 600. Group headings are sentence-case `subheadline` in
 * `text.secondary`. Key hints sit in a quiet footer.
 *
 * It fades and scales in from 0.97 over `fast` on the entrance curve; under
 * reduced motion it only fades. On phones it is a full-height sheet from the
 * top of the screen, clear of the safe areas.
 */
export const commandPaletteStyles = layer(
  'components',
  css`
.itsm-CommandPalette__scrim {
  position: fixed;
  inset: 0;
  z-index: var(--itsm-z-dialog);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 12vh var(--itsm-space-md) var(--itsm-space-md);
  background: var(--itsm-colour-scrim);
  -webkit-backdrop-filter: var(--itsm-scrim-filter);
  backdrop-filter: var(--itsm-scrim-filter);
  animation: itsm-overlay-fade-in var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-CommandPalette {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  inline-size: min(100%, 40rem);
  max-block-size: min(32rem, 76vh);
  overflow: hidden;
  border: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-3xl);
  background: var(--itsm-colour-material-popover);
  -webkit-backdrop-filter: var(--itsm-material-popover-filter);
  backdrop-filter: var(--itsm-material-popover-filter);
  box-shadow: var(--itsm-elevation-xl), var(--itsm-edge-highlight);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-sans);
  outline: none;
  animation: itsm-overlay-zoom-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}

.itsm-CommandPalette__field {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-block-size: 3.5rem;
  padding: 0 var(--itsm-space-md);
  border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}
.itsm-CommandPalette__searchIcon {
  flex: none;
  color: var(--itsm-colour-text-secondary);
}
.itsm-CommandPalette__back {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  inline-size: var(--itsm-control-height-sm);
  block-size: var(--itsm-control-height-sm);
  margin: 0 0 0 calc(-1 * var(--itsm-space-2xs));
  padding: 0;
  border: 0;
  border-radius: var(--itsm-radius-md);
  background: transparent;
  color: var(--itsm-colour-text-secondary);
  cursor: pointer;
}
.itsm-CommandPalette__back:hover {
  background: var(--itsm-colour-fill-hover);
  color: var(--itsm-colour-text-primary);
}
.itsm-CommandPalette__crumbs {
  display: inline-flex;
  flex: none;
  gap: var(--itsm-space-2xs);
  max-inline-size: 50%;
  overflow: hidden;
}
.itsm-CommandPalette__crumb {
  flex: none;
  max-inline-size: 12rem;
  overflow: hidden;
  padding: var(--itsm-space-3xs) var(--itsm-space-xs);
  border-radius: var(--itsm-radius-sm);
  background: var(--itsm-colour-fill-secondary);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-CommandPalette__input {
  flex: 1 1 auto;
  min-inline-size: 0;
  block-size: 3.5rem;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--itsm-colour-text-primary);
  font: inherit;
  font-size: var(--itsm-text-title3-size);
  line-height: var(--itsm-text-title3-line);
  letter-spacing: var(--itsm-text-title3-tracking);
  outline: none;
}
.itsm-CommandPalette__input::placeholder {
  color: var(--itsm-colour-text-muted);
  opacity: 1;
}
.itsm-CommandPalette__input:focus-visible {
  outline: none;
  box-shadow: none;
}
.itsm-CommandPalette__spinner {
  /* The shared activity indicator, grey like every other: blue is for what can be pressed (SPEC §1.1). */
  flex: none;
}

.itsm-CommandPalette__list {
  flex: 1 1 auto;
  min-block-size: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  scroll-padding-block: var(--itsm-space-2xs);
}
.itsm-CommandPalette__list:empty {
  display: none;
}
.itsm-CommandPalette__section + .itsm-CommandPalette__section {
  margin-block-start: var(--itsm-space-2xs);
}
.itsm-CommandPalette__group {
  padding: var(--itsm-space-xs) var(--itsm-space-xs) var(--itsm-space-2xs);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
}

.itsm-CommandPalette__option {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  box-sizing: border-box;
  min-block-size: calc(var(--itsm-nav-item-height) + var(--itsm-space-2xs));
  padding: var(--itsm-space-2xs) var(--itsm-space-xs);
  border-radius: var(--itsm-radius-lg);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  cursor: default;
  user-select: none;
}
.itsm-CommandPalette__option[data-active="true"] {
  background: var(--itsm-colour-surface-selected);
}
.itsm-CommandPalette__option[aria-disabled="true"] {
  color: var(--itsm-colour-text-disabled);
  cursor: not-allowed;
}
.itsm-CommandPalette__option[data-tone="danger"] {
  color: var(--itsm-colour-danger-subtleText);
}
.itsm-CommandPalette__icon {
  flex: none;
  color: var(--itsm-colour-text-secondary);
}
.itsm-CommandPalette__option[data-active="true"] .itsm-CommandPalette__icon {
  color: var(--itsm-colour-accent);
}
.itsm-CommandPalette__option[data-tone="danger"] .itsm-CommandPalette__icon {
  color: currentColor;
}
.itsm-CommandPalette__text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-inline-size: 0;
}
.itsm-CommandPalette__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-CommandPalette__match {
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-CommandPalette__description {
  display: block;
  overflow: hidden;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-CommandPalette__meta {
  flex: none;
  max-inline-size: 40%;
  overflow: hidden;
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-CommandPalette__hint {
  flex: none;
  margin-inline-start: auto;
  color: var(--itsm-colour-text-muted);
}
.itsm-CommandPalette__chevron {
  flex: none;
  color: var(--itsm-colour-text-muted);
}

.itsm-CommandPalette__empty {
  padding: var(--itsm-space-lg) var(--itsm-space-md);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  text-align: center;
}
.itsm-CommandPalette__list:not(:empty) + .itsm-CommandPalette__empty {
  padding-block: var(--itsm-space-2xs) var(--itsm-space-sm);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
}
.itsm-CommandPalette__problem,
.itsm-CommandPalette__status {
  padding: var(--itsm-space-xs) var(--itsm-space-md);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}
.itsm-CommandPalette__problem {
  color: var(--itsm-colour-danger-subtleText);
}

.itsm-CommandPalette__footer {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-2xs) var(--itsm-space-md);
  padding: var(--itsm-space-xs) var(--itsm-space-md);
  border-block-start: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
}
.itsm-CommandPalette__footer > span {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-3xs);
}

${mq.belowMd} {
  .itsm-CommandPalette__scrim {
    padding: 0;
  }
  .itsm-CommandPalette {
    inline-size: 100%;
    max-block-size: none;
    block-size: 100dvh;
    padding-block-start: var(--itsm-safe-area-top);
    padding-block-end: var(--itsm-safe-area-bottom);
    border: 0;
    border-radius: 0;
    animation-name: itsm-overlay-fade-in;
  }
  .itsm-CommandPalette__footer {
    display: none;
  }
}
@media (pointer: coarse) {
  .itsm-CommandPalette__footerWide {
    display: none;
  }
}

${mq.reducedMotion} {
  .itsm-CommandPalette {
    animation-name: itsm-overlay-fade-in;
  }
}
${prefers.reducedMotion} .itsm-CommandPalette {
  animation-name: itsm-overlay-fade-in;
}

${mq.forcedColors} {
  .itsm-CommandPalette {
    border-color: CanvasText;
  }
  .itsm-CommandPalette__option[data-active="true"] {
    outline: var(--itsm-border-thick) solid Highlight;
    outline-offset: calc(-1 * var(--itsm-border-thick));
  }
}
`,
);
