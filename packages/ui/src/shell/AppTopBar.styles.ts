import { css, layer, mq } from '../styles/css.js';

/**
 * `AppTopBar` — the sidebar frame's top bar (v3 §3.4, A2 §5.2) — and the
 * context chips it carries.
 *
 * 56 px at every width, opaque `surface.raised` with its `border.subtle`
 * hairline always drawn (the sidebar's 56 px brand block lines up with it),
 * sticky under any system bar at `--itsm-system-bar-h`, at the header's
 * z-index (150, under the demo bar's 160).
 *
 * The **structure** follows the viewport, as the frame does: ☰ below
 * 1024 px; the compact area switcher on phones; the purpose line from
 * 1024 px; chips from 1024 px (icons), one with words from 1280 px, both from
 * 1440 px; Help from 768 px; the Service Desk's compose icon at 768–1023 px;
 * the connection status here only while the sidebar's foot is hidden. The
 * **density** of the bar follows its column (`@container itsm-column`): the
 * search field is 236 px wide, 200 px in a column under 1200 px and the
 * magnifier alone under 960 px.
 */
export const appTopBarStyles = layer(
  'components',
  css`
.itsm-AppTopBar {
  position: sticky;
  inset-block-start: var(--itsm-system-bar-h);
  z-index: var(--itsm-z-header);
  display: flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  box-sizing: border-box;
  block-size: var(--itsm-topbar-height);
  padding-block: 0;
  padding-inline: max(var(--itsm-page-gutter), var(--itsm-safe-area-left)) max(var(--itsm-space-md), var(--itsm-safe-area-right));
  border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  background: var(--itsm-colour-surface-raised);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
}
.itsm-AppTopBar:focus {
  outline: none;
}
.itsm-AppTopBar:focus-visible {
  outline: var(--itsm-focus-width) solid var(--itsm-colour-border-focus);
  outline-offset: calc(-1 * var(--itsm-focus-width));
}

.itsm-AppTopBar__start {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-inline-size: 0;
}
.itsm-AppTopBar__menu {
  flex: none;
}

/* ---- the title block ---- */

.itsm-AppTopBar__heading {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-inline-size: 0;
  max-inline-size: min(52cqi, 35rem);
}
.itsm-AppTopBar__title {
  display: block;
  min-inline-size: 0;
  overflow: hidden;
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-text-title1-family);
  font-size: var(--itsm-text-title1-size);
  line-height: var(--itsm-text-title1-line);
  font-weight: var(--itsm-text-title1-weight);
  letter-spacing: var(--itsm-text-title1-tracking);
  word-spacing: var(--itsm-text-title1-word-spacing);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-AppTopBar__purpose {
  display: block;
  min-inline-size: 0;
  overflow: hidden;
  color: var(--itsm-colour-text-muted);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-regular);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-AppTopBar__back {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
  margin-inline-start: calc(-1 * var(--itsm-space-2xs));
  padding-inline: var(--itsm-space-3xs) var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-primary);
  text-decoration: none;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-AppTopBar__back:hover {
  background: var(--itsm-colour-surface-hover);
}
.itsm-AppTopBar__backIcon {
  flex: none;
  color: var(--itsm-colour-text-muted);
}
.itsm-AppTopBar__heading[data-mode="section"] .itsm-AppTopBar__purpose {
  padding-inline-start: calc(var(--itsm-icon-md) + var(--itsm-space-3xs) - var(--itsm-space-2xs));
}

/* ---- context chips ---- */

.itsm-AppTopBar__chips {
  display: none;
  flex: 0 1 auto;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
}
.itsm-AppTopBar__chip {
  display: inline-flex;
  min-inline-size: 0;
}
.itsm-ContextChip {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  box-sizing: border-box;
  min-inline-size: 0;
  block-size: 1.875rem;
  padding: 0 var(--itsm-space-sm);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-surface-raisedAlt);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  text-decoration: none;
  white-space: nowrap;
}
a.itsm-ContextChip:hover {
  border-color: var(--itsm-colour-border-soft);
  background: var(--itsm-colour-surface-hover);
}
.itsm-ContextChip[data-tone="danger"] {
  border-color: var(--itsm-colour-danger-border);
  background: var(--itsm-colour-danger-subtle);
  color: var(--itsm-colour-danger-subtleText);
}
a.itsm-ContextChip[data-tone="danger"]:hover {
  background: var(--itsm-colour-danger-subtle);
  text-decoration: underline;
}
.itsm-ContextChip__icon {
  flex: none;
}
.itsm-ContextChip__label,
.itsm-ContextChip__compact {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.itsm-ContextChip__compact {
  display: none;
}

/* ---- tools ---- */

.itsm-AppTopBar__tools {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--itsm-space-2xs);
  margin-inline-start: auto;
}
.itsm-AppTopBar__action,
.itsm-AppTopBar__help,
.itsm-AppTopBar__bell {
  display: inline-flex;
  align-items: center;
}
.itsm-AppTopBar__action {
  display: none;
}
.itsm-AppTopBar__status {
  display: inline-flex;
  align-items: center;
}
.itsm-AppTopBar__status:empty {
  display: none;
}
.itsm-AppTopBar__tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: calc(var(--itsm-control-height-md) - var(--itsm-space-3xs));
  block-size: calc(var(--itsm-control-height-md) - var(--itsm-space-3xs));
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--itsm-radius-md);
  background: transparent;
  color: var(--itsm-colour-text-secondary);
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard), color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-AppTopBar__tool:hover,
.itsm-AppTopBar__tool[aria-expanded="true"] {
  background: var(--itsm-colour-surface-hover);
  color: var(--itsm-colour-text-primary);
}
.itsm-AppTopBar__tool:active {
  background: var(--itsm-colour-fill-pressed);
}
${mq.coarse} {
  .itsm-AppTopBar__tool {
    inline-size: var(--itsm-control-height-lg);
    block-size: var(--itsm-control-height-lg);
  }
}

/* ---- the compact switcher on phones (RV5): a 32 × 44 chevron before the title ---- */

.itsm-AppTopBar__area {
  display: none;
}

/* ---- by width ---- */

${mq.belowMd} {
  .itsm-AppTopBar__area {
    display: inline-flex;
  }
  .itsm-AppTopBar__title {
    font-size: 1.0625rem;
    line-height: 1.5rem;
  }
  .itsm-AppTopBar[data-tab-search] .itsm-AppTopBar__search,
  .itsm-AppTopBar__help {
    display: none;
  }
}
${mq.md} {
  ${mq.belowLg} {
    .itsm-AppTopBar__action {
      display: inline-flex;
    }
  }
}
${mq.belowLg} {
  .itsm-AppTopBar__purpose {
    display: none;
  }
  .itsm-AppTopBar {
    gap: var(--itsm-space-xs);
  }
}
${mq.lg} {
  .itsm-AppTopBar__menu,
  .itsm-AppTopBar__status {
    display: none;
  }
  .itsm-AppTopBar__chips {
    display: flex;
  }
  /* 1024–1279: chips are icons; their words stay their name and their tooltip. */
  .itsm-AppTopBar__chip .itsm-ContextChip[data-icon] {
    inline-size: 1.875rem;
    padding: 0;
    justify-content: center;
  }
  .itsm-AppTopBar__chip .itsm-ContextChip[data-icon] .itsm-ContextChip__label {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
${mq.xl} {
  /* 1280–1439: the first chip has its compact words. */
  .itsm-AppTopBar__chip[data-chip="1"] .itsm-ContextChip[data-icon] {
    inline-size: auto;
    padding: 0 var(--itsm-space-sm);
  }
  .itsm-AppTopBar__chip[data-chip="1"] .itsm-ContextChip__compact {
    display: inline;
  }
}
${mq['2xl']} {
  /* 1440 and up: both chips in full. */
  .itsm-AppTopBar__chip .itsm-ContextChip[data-icon] {
    inline-size: auto;
    padding: 0 var(--itsm-space-sm);
  }
  .itsm-AppTopBar__chip .itsm-ContextChip[data-icon] .itsm-ContextChip__label {
    position: static;
    inline-size: auto;
    block-size: auto;
    clip-path: none;
  }
  .itsm-AppTopBar__chip .itsm-ContextChip__compact,
  .itsm-AppTopBar__chip[data-chip="1"] .itsm-ContextChip__compact {
    display: none;
  }
}

/* The search field's width follows the column, not the window: a full sidebar narrows it. */
@container itsm-column (max-width: 74.9375rem) {
  .itsm-AppTopBar__search {
    inline-size: 12.5rem;
  }
}
@container itsm-column (max-width: 59.9375rem) {
  .itsm-AppTopBar__search {
    justify-content: center;
    inline-size: calc(var(--itsm-control-height-md) - var(--itsm-space-3xs));
    padding: 0;
    border-color: transparent;
    background-color: transparent;
  }
  .itsm-AppTopBar__search .itsm-SearchTrigger__label {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .itsm-AppTopBar__search .itsm-SearchTrigger__keys {
    display: none;
  }
}

${mq.forcedColors} {
  .itsm-AppTopBar {
    border-block-end-color: CanvasText;
  }
  .itsm-ContextChip {
    border-color: CanvasText;
  }
}
@media print {
  .itsm-AppTopBar {
    position: static;
  }
  .itsm-AppTopBar__tools {
    display: none;
  }
}
`,
);
