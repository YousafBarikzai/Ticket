import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * The rail's look, written once and applied under two conditions: the
 * 1024–1279 px band, where the rail is the only size, and 1280 px and up when
 * the person collapsed the sidebar (`data-itsm-nav="rail"`). `--_rail: 1` is
 * what the sidebar's script reads to decide whether items need their
 * tooltip.
 */
function railRules(scope: string): string {
  return `
${scope} .itsm-Sidebar[data-mode="docked"] {
  --_rail: 1;
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__header {
  padding-inline: var(--itsm-space-xs);
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__brandRow,
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__tools {
  flex-direction: column;
  gap: var(--itsm-space-2xs);
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__brand {
  flex: none;
  justify-content: center;
  padding: var(--itsm-space-2xs);
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__brandText,
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__label,
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-UserMenu__text,
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-SearchTrigger__label {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__brandChevron,
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__sectionChevron,
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-UserMenu__chevron,
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-SearchTrigger__keys,
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__remove {
  display: none;
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-SearchTrigger {
  inline-size: var(--itsm-control-height-md);
  padding: 0;
  justify-content: center;
  background: transparent;
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-SearchTrigger:hover {
  background: var(--itsm-colour-fill-hover);
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__scroll,
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__list--footer {
  padding-inline: var(--itsm-space-xs);
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__section {
  margin-block-start: 0;
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__section + .itsm-Sidebar__section {
  margin-block-start: var(--itsm-space-xs);
  padding-block-start: var(--itsm-space-xs);
  border-block-start: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__sectionLabel {
  display: none;
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__list[data-collapsed] {
  display: flex;
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__item {
  justify-content: center;
  padding-inline: 0;
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__children {
  display: none;
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__badge {
  position: absolute;
  inset-block-start: var(--itsm-space-3xs);
  inset-inline-end: var(--itsm-space-2xs);
  min-inline-size: 0;
  inline-size: var(--itsm-space-xs);
  block-size: var(--itsm-space-xs);
  padding: 0;
  box-shadow: 0 0 0 var(--itsm-border-thick) var(--itsm-colour-surface-canvas);
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__badge .itsm-NavBadge__count {
  display: none;
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__badge[data-tone="neutral"] {
  background: var(--itsm-colour-text-secondary);
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-Sidebar__footer {
  align-items: center;
  padding-inline: var(--itsm-space-xs);
}
${scope} .itsm-Sidebar[data-mode="docked"] .itsm-UserMenu--row {
  inline-size: auto;
  padding: var(--itsm-space-3xs);
  border-radius: var(--itsm-radius-pill);
}
`;
}

/**
 * `AppShell` — the frame — and the sidebar it draws. In the patterns layer,
 * above the components it is built from.
 *
 * **Sidebar frame** (admin, workbench). The window scrolls; the sidebar is
 * `sticky` at full height beside an inset content panel (`surface.raised`,
 * radius `xl`, elevation `xs`, 8 px from the canvas edges). Widths by
 * viewport, the one place the design system uses viewport queries (SPEC
 * §1.6): under 1024 px no sidebar column, a 52 px compact bar on glass and
 * the sidebar in a sheet; 1024–1279 px the 64 px rail; 1280 px and up the
 * full 248 px — or the rail when the person collapsed it. The column width
 * lives in `--_sidebar-w`, which the bottom dock also reads so it clears the
 * sidebar.
 *
 * **Sidebar** (opaque, on the canvas, D6). Items are `callout` at the nav
 * item height (32, 28 compact, 44 on touch), icons `md` in `text.secondary`.
 * Hover is `surface.hover` over `fast`, and nothing moves. The current page
 * is `surface.selected`, `text.primary` at 600, an accent icon and a 3 px
 * accent bar at the inline start (X-72). Section headings are sentence-case
 * `subheadline` in `text.secondary` — no overlines.
 *
 * **Top-nav frame** (portal). A glass top bar with centred pills: the current
 * pill sits on an opaque `surface.selected` pill (legible over anything
 * scrolling beneath), labels reserve their bold width so nothing shifts.
 * Below 768 px the pills and *New request* leave the bar, the tab bar docks
 * at the bottom, and inner pages show "‹ Back" and their title.
 *
 * The pre-redesign frame's rules follow, scoped to `--legacy`.
 */
export const appShellStyles = layer(
  'patterns',
  css`
/* ---- the frame ---- */

.itsm-AppShell[data-variant] {
  --_sidebar-w: 0px;
  --_sticky-top: 0px;
  --_dock-start: var(--_sidebar-w);
  min-block-size: 100dvh;
  background: var(--itsm-colour-surface-canvas);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-sans);
}

.itsm-AppShell__page {
  display: block;
  min-inline-size: 0;
  padding: var(--itsm-page-gutter);
  padding-block-end: calc(var(--itsm-page-gutter) + var(--itsm-bottom-dock-height));
}

.itsm-AppShell__banner {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
  padding: var(--itsm-space-xs) var(--itsm-page-gutter) 0;
}
.itsm-AppShell__banner:empty {
  display: none;
}

.itsm-AppShell__status:empty {
  display: none;
}

/* ---- sidebar frame ---- */

.itsm-AppShell[data-variant="sidebar"] {
  --_sticky-top: var(--itsm-topbar-height);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  align-items: start;
}
.itsm-AppShell[data-variant="sidebar"] > .itsm-AppShell__sidebar {
  display: none;
}
.itsm-AppShell[data-variant="sidebar"] > .itsm-AppShell__compactBar {
  grid-column: 1;
}
.itsm-AppShell__panel {
  grid-column: -2 / -1;
  min-inline-size: 0;
  min-block-size: calc(100dvh - var(--itsm-topbar-height));
  background: var(--itsm-colour-surface-raised);
  container-type: inline-size;
  container-name: itsm-page;
}

${mq.lg} {
  .itsm-AppShell[data-variant="sidebar"] {
    --_sidebar-w: var(--itsm-sidebar-rail);
    --_sticky-top: var(--itsm-panel-inset);
    grid-template-columns: var(--_sidebar-w) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }
  .itsm-AppShell[data-variant="sidebar"] > .itsm-AppShell__compactBar {
    display: none;
  }
  .itsm-AppShell[data-variant="sidebar"] > .itsm-AppShell__sidebar {
    display: block;
    grid-column: 1;
    grid-row: 1;
    position: sticky;
    inset-block-start: 0;
    block-size: 100dvh;
    min-inline-size: 0;
  }
  .itsm-AppShell__panel {
    grid-row: 1;
    margin: var(--itsm-panel-inset);
    margin-inline-start: 0;
    min-block-size: calc(100dvh - 2 * var(--itsm-panel-inset));
    border-radius: var(--itsm-radius-xl);
    box-shadow: var(--itsm-elevation-xs), var(--itsm-edge-highlight);
  }
}

${mq.xl} {
  :root:not([data-itsm-nav="rail"]) .itsm-AppShell[data-variant="sidebar"] {
    --_sidebar-w: var(--itsm-sidebar-width);
  }
}

${mq.lg} {
  ${mq.belowXl} {
    ${railRules('')}
  }
}

${mq.xl} {
  ${railRules(':root[data-itsm-nav="rail"]')}
}

/* A focused control never hides under a sticky top bar (WCAG 2.4.11). */
:where(html):has(.itsm-AppShell[data-variant="topnav"]) {
  scroll-padding-block-start: calc(var(--itsm-topbar-height) + var(--itsm-space-xs));
}
${mq.belowLg} {
  :where(html):has(.itsm-AppShell[data-variant="sidebar"]) {
    scroll-padding-block-start: calc(var(--itsm-topbar-height) + var(--itsm-space-xs));
  }
}

.itsm-AppShell__navSheet .itsm-Sheet__body {
  padding: 0;
}
.itsm-AppShell__navSheet .itsm-Sidebar {
  block-size: auto;
}

/* ---- sidebar ---- */

.itsm-Sidebar {
  --_rail: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  block-size: 100%;
  inline-size: 100%;
  background: var(--itsm-colour-surface-canvas);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  container-type: inline-size;
  container-name: itsm-sidebar;
}
.itsm-Sidebar[data-mode="sheet"] {
  background: transparent;
}

.itsm-Sidebar__header {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
  padding: var(--itsm-space-sm) var(--itsm-space-sm) var(--itsm-space-xs);
}
.itsm-Sidebar__brandRow {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-block-size: var(--itsm-control-height-md);
}
.itsm-Sidebar__brand {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
  margin: 0;
  padding: var(--itsm-space-2xs) var(--itsm-space-2xs);
  border: 0;
  border-radius: var(--itsm-radius-lg);
  background: transparent;
  color: var(--itsm-colour-text-primary);
  font: inherit;
  text-align: start;
  text-decoration: none;
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Sidebar__brand:hover {
  background: var(--itsm-colour-fill-hover);
}
.itsm-Sidebar__brand:active {
  background: var(--itsm-colour-fill-pressed);
}
.itsm-Sidebar__mark {
  flex: none;
}
.itsm-Sidebar__brandText {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
}
.itsm-Sidebar__brandName {
  overflow: hidden;
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-font-weight-semibold);
  letter-spacing: var(--itsm-text-body-tracking);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-Sidebar__tenant {
  overflow: hidden;
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-Sidebar__brandChevron {
  flex: none;
  margin-inline-start: auto;
  color: var(--itsm-colour-text-secondary);
}
.itsm-Sidebar__headerExtra,
.itsm-Sidebar__bell {
  display: inline-flex;
  flex: none;
  align-items: center;
}
.itsm-Sidebar__toggle {
  flex: none;
  color: var(--itsm-colour-text-secondary);
}
.itsm-Sidebar__tools {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  container-type: inline-size;
  container-name: itsm-sidebar-tools;
}
/* At the sidebar's own width the label matters more than the key caps (the
   shortcut is still announced, listed in the shortcuts dialog, and shown in
   the compact bar's and the portal's wider triggers). */
@container itsm-sidebar-tools (max-width: 16rem) {
  .itsm-Sidebar__search .itsm-SearchTrigger__keys {
    display: none;
  }
}
.itsm-Sidebar__search {
  flex: 1 1 auto;
  min-inline-size: 0;
}

.itsm-Sidebar__nav {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-block-size: 0;
}
.itsm-Sidebar__scroll {
  flex: 1 1 auto;
  min-block-size: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 var(--itsm-space-sm) var(--itsm-space-sm);
}
.itsm-Sidebar[data-mode="sheet"] .itsm-Sidebar__scroll {
  overflow: visible;
}

.itsm-Sidebar__section {
  position: relative;
  margin-block-start: var(--itsm-space-md);
}
.itsm-Sidebar__section:first-child {
  margin-block-start: var(--itsm-space-2xs);
}
.itsm-Sidebar__sectionLabel {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  box-sizing: border-box;
  inline-size: 100%;
  min-block-size: var(--itsm-control-height-sm);
  margin: 0;
  padding: 0 var(--itsm-space-xs);
  border: 0;
  border-radius: var(--itsm-radius-md);
  background: transparent;
  color: var(--itsm-colour-text-secondary);
  font: inherit;
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  text-align: start;
}
.itsm-Sidebar__sectionToggle {
  cursor: pointer;
  transition: color var(--itsm-duration-fast) var(--itsm-easing-standard), background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Sidebar__sectionToggle:hover {
  color: var(--itsm-colour-text-primary);
  background: var(--itsm-colour-fill-hover);
}
.itsm-Sidebar__sectionText {
  flex: 1 1 auto;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-Sidebar__sectionChevron {
  flex: none;
  opacity: 0;
  transition: transform var(--itsm-duration-fast) var(--itsm-easing-standard), opacity var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Sidebar__sectionToggle:hover .itsm-Sidebar__sectionChevron,
.itsm-Sidebar__sectionToggle:focus-visible .itsm-Sidebar__sectionChevron,
.itsm-Sidebar__sectionToggle[aria-expanded="false"] .itsm-Sidebar__sectionChevron {
  opacity: 1;
}
.itsm-Sidebar__sectionToggle[aria-expanded="false"] .itsm-Sidebar__sectionChevron {
  transform: rotate(-90deg);
}
.itsm-Sidebar__sectionToggle[aria-expanded="false"] .itsm-Sidebar__sectionChevron:dir(rtl) {
  transform: rotate(90deg);
}
${mq.coarse} {
  .itsm-Sidebar__sectionChevron {
    opacity: 1;
  }
}

.itsm-Sidebar__list,
.itsm-Sidebar__children {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  margin: 0;
  padding: 0;
  list-style: none;
}
.itsm-Sidebar__list[data-collapsed] {
  display: none;
}
.itsm-Sidebar__children {
  margin-block-start: var(--itsm-space-3xs);
  padding-inline-start: calc(var(--itsm-icon-md) + var(--itsm-space-xs));
}
.itsm-Sidebar__list--footer {
  flex: none;
  padding: var(--itsm-space-xs) var(--itsm-space-sm);
  border-block-start: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}
.itsm-Sidebar__entry {
  position: relative;
}

.itsm-Sidebar__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  min-block-size: var(--itsm-nav-item-height);
  padding: 0 var(--itsm-space-xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-primary);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Sidebar__item:hover {
  background: var(--itsm-colour-surface-hover);
  color: var(--itsm-colour-text-primary);
}
.itsm-Sidebar__item:active {
  background: var(--itsm-colour-fill-pressed);
}
.itsm-Sidebar__item:focus-visible {
  outline-offset: calc(-1 * var(--itsm-focus-width));
  box-shadow: none;
}
.itsm-Sidebar__item[aria-current="page"] {
  background: var(--itsm-colour-surface-selected);
  color: var(--itsm-colour-text-primary);
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-Sidebar__item[aria-current="page"]::before {
  content: '';
  position: absolute;
  inset-block: var(--itsm-space-2xs);
  inset-inline-start: 0;
  inline-size: 3px;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-accent);
}
.itsm-Sidebar__icon {
  flex: none;
  inline-size: var(--itsm-icon-md);
  block-size: var(--itsm-icon-md);
  color: var(--itsm-colour-text-secondary);
}
.itsm-Sidebar__item[aria-current="page"] .itsm-Sidebar__icon {
  color: var(--itsm-colour-accent);
}
.itsm-Sidebar__label {
  flex: 1 1 auto;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-Sidebar__badge {
  flex: none;
  margin-inline-start: auto;
}

.itsm-Sidebar__entry[data-removable] .itsm-Sidebar__item {
  padding-inline-end: calc(var(--itsm-control-height-sm) + var(--itsm-space-2xs));
}
.itsm-Sidebar__remove {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-end: var(--itsm-space-3xs);
  transform: translateY(-50%);
  opacity: 0;
  transition: opacity var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Sidebar__entry:hover .itsm-Sidebar__remove,
.itsm-Sidebar__entry:focus-within .itsm-Sidebar__remove {
  opacity: 1;
}
${mq.coarse} {
  .itsm-Sidebar__remove {
    opacity: 1;
  }
}

.itsm-Sidebar__footer {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: var(--itsm-space-xs);
  padding: var(--itsm-space-xs) var(--itsm-space-sm) var(--itsm-space-sm);
  padding-block-end: max(var(--itsm-space-sm), var(--itsm-safe-area-bottom));
}
.itsm-Sidebar__status:empty,
.itsm-Sidebar__footerExtra:empty {
  display: none;
}

/* The rail's name bubble: the same bubble as every tooltip in the product (\`Tooltip\`, the icon button's). */
.itsm-Sidebar__tip {
  position: fixed;
  z-index: var(--itsm-z-tooltip);
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  box-sizing: border-box;
  max-inline-size: 15rem;
  padding: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs) / 2) var(--itsm-space-xs);
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-md);
  background: var(--itsm-colour-surface-inverse);
  color: var(--itsm-colour-text-inverse);
  box-shadow: var(--itsm-elevation-md);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  letter-spacing: var(--itsm-text-footnote-tracking);
  white-space: nowrap;
  pointer-events: none;
  transform: translateY(-50%);
  animation: itsm-fade-in var(--itsm-duration-fast) var(--itsm-easing-entrance);
}

/* ---- top-nav frame ---- */

.itsm-AppShell[data-variant="topnav"] {
  --_sticky-top: var(--itsm-topbar-height);
  display: flex;
  flex-direction: column;
}
.itsm-AppShell[data-variant="topnav"] > .itsm-AppShell__page {
  flex: 1 1 auto;
}

.itsm-AppShell__pills {
  display: none;
}
.itsm-AppShell__pillList {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-3xs);
  margin: 0;
  padding: 0;
  list-style: none;
}
.itsm-AppShell__pillList > li {
  display: flex;
}
.itsm-AppShell__pill {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-block-size: var(--itsm-nav-item-height);
  padding: 0 var(--itsm-space-sm);
  border-radius: var(--itsm-radius-pill);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-medium);
  letter-spacing: var(--itsm-text-callout-tracking);
  text-decoration: none;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard), color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-AppShell__pill:hover {
  background: var(--itsm-colour-fill-hover);
  color: var(--itsm-colour-text-primary);
}
.itsm-AppShell__pill:active {
  background: var(--itsm-colour-fill-pressed);
}
.itsm-AppShell__pill[aria-current="page"] {
  background: var(--itsm-colour-surface-selected);
  color: var(--itsm-colour-text-primary);
  font-weight: var(--itsm-font-weight-semibold);
}
.itsm-AppShell__pillLabel {
  display: inline-grid;
}
.itsm-AppShell__pillLabel::after {
  content: attr(data-text);
  grid-area: 1 / 1;
  block-size: 0;
  overflow: hidden;
  visibility: hidden;
  font-weight: var(--itsm-font-weight-semibold);
}

.itsm-AppShell__back {
  display: none;
  flex: 0 1 auto;
  align-items: center;
  gap: var(--itsm-space-3xs);
  min-inline-size: var(--itsm-control-height-md);
  min-block-size: var(--itsm-control-height-md);
  max-inline-size: 7.5rem;
  padding-inline: var(--itsm-space-3xs) var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-body-size);
  text-decoration: none;
}
.itsm-AppShell__back:hover {
  background: var(--itsm-colour-fill-hover);
}
.itsm-AppShell__backLabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* On the narrowest phones the title needs the room: the way back is the
   chevron alone, still named by its (hidden) label. */
${mq.belowSm} {
  .itsm-AppShell__backLabel {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    clip-path: inset(50%);
  }
}
.itsm-AppShell[data-variant="topnav"] .itsm-TopBar__title {
  display: none;
}
.itsm-AppShell__action {
  display: none;
}

${mq.md} {
  .itsm-AppShell__pills {
    display: block;
  }
  .itsm-AppShell__action {
    display: inline-flex;
  }
}
${mq.belowMd} {
  .itsm-AppShell[data-variant="topnav"][data-has-back] .itsm-AppShell__back {
    display: inline-flex;
  }
  .itsm-AppShell[data-variant="topnav"][data-has-back] .itsm-TopBar__brand {
    display: none;
  }
  .itsm-AppShell[data-variant="topnav"][data-has-back] .itsm-TopBar__title {
    display: block;
  }
  .itsm-AppShell[data-variant="topnav"] > .itsm-AppShell__page {
    padding-block-end: calc(var(--itsm-page-gutter) + var(--itsm-bottom-dock-height));
  }
  .itsm-AppShell[data-variant="topnav"][data-has-back] .itsm-PageHeader__back {
    display: none;
  }
}

/* The compact bars' title appears once the page's own heading has scrolled
   under the bar — iOS's large title — and not while both would show. */
.itsm-AppShell__compactBar .itsm-TopBar__title,
.itsm-AppShell[data-variant="topnav"] .itsm-TopBar__title {
  transition: opacity var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-AppShell[data-title-in-view] .itsm-AppShell__compactBar .itsm-TopBar__title,
.itsm-AppShell[data-title-in-view][data-variant="topnav"] .itsm-TopBar__title {
  opacity: 0;
}

${mq.forcedColors} {
  .itsm-Sidebar__item[aria-current="page"],
  .itsm-AppShell__pill[aria-current="page"] {
    outline: var(--itsm-border-thick) solid Highlight;
    outline-offset: calc(-1 * var(--itsm-border-thick));
  }
  .itsm-Sidebar__item[aria-current="page"]::before {
    background: Highlight;
  }
  /* Forced colours drop the fill and the shadow; the border keeps the bubble's edge, as the other tooltips do. */
  .itsm-Sidebar__tip {
    border-color: CanvasText;
    background: Canvas;
    color: CanvasText;
  }
}

${mq.reducedMotion} {
  .itsm-Sidebar__sectionChevron,
  .itsm-Sidebar__tip {
    transition: none;
    animation: none;
  }
}
${prefers.reducedMotion} .itsm-Sidebar__tip {
  animation: none;
}

/* ---- the pre-redesign frame (deprecated) ---- */

.itsm-AppShell--legacy { min-block-size: 100dvh; display: flex; flex-direction: column; background: var(--itsm-colour-surface-canvas); color: var(--itsm-colour-text-primary); }
.itsm-AppShell__skipLink {
  position: absolute;
  inset-inline-start: var(--itsm-space-xs);
  inset-block-start: var(--itsm-space-xs);
  z-index: var(--itsm-z-tooltip);
  padding: var(--itsm-space-xs) var(--itsm-space-sm);
  background: var(--itsm-colour-brand-solid);
  color: var(--itsm-colour-brand-solidText);
  border-radius: var(--itsm-radius-md);
  transform: translateY(-200%);
}
.itsm-AppShell__skipLink:focus { transform: none; }
.itsm-AppShell__header {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  padding: var(--itsm-space-xs) var(--itsm-space-md);
  min-block-size: var(--itsm-topbar-height);
  background: var(--itsm-colour-material-chrome);
  -webkit-backdrop-filter: var(--itsm-material-chrome-filter);
  backdrop-filter: var(--itsm-material-chrome-filter);
  border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
  position: sticky;
  inset-block-start: 0;
  z-index: var(--itsm-z-header);
}
.itsm-AppShell__brand { display: flex; align-items: center; gap: var(--itsm-space-xs); font-weight: var(--itsm-font-weight-semibold); }
.itsm-AppShell__headerEnd { margin-inline-start: auto; display: flex; align-items: center; gap: var(--itsm-space-xs); }
.itsm-AppShell--legacy > .itsm-AppShell__main { display: flex; flex: 1; min-block-size: 0; }
.itsm-AppShell__nav {
  inline-size: var(--itsm-sidebar-width);
  flex: none;
  padding: var(--itsm-space-sm);
  background: var(--itsm-colour-surface-canvas);
  overflow-y: auto;
}
.itsm-AppShell__navList { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--itsm-space-3xs); }
.itsm-AppShell__navLink {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-block-size: var(--itsm-nav-item-height);
  padding: 0 var(--itsm-space-xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-primary);
  text-decoration: none;
  font-size: var(--itsm-text-callout-size);
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-AppShell__navButton { inline-size: 100%; background: none; border: 0; text-align: start; cursor: pointer; font: inherit; font-size: var(--itsm-text-callout-size); }
.itsm-AppShell__navLink:hover { background: var(--itsm-colour-surface-hover); color: var(--itsm-colour-text-primary); }
.itsm-AppShell__navLink[aria-current="page"] { background: var(--itsm-colour-surface-selected); color: var(--itsm-colour-text-primary); font-weight: var(--itsm-font-weight-semibold); }
.itsm-AppShell__navLink[aria-current="page"]::before {
  content: '';
  position: absolute;
  inset-block: var(--itsm-space-2xs);
  inset-inline-start: 0;
  inline-size: 3px;
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-accent);
}
.itsm-AppShell__navBadge { margin-inline-start: auto; }
.itsm-AppShell__content {
  flex: 1;
  min-inline-size: 0;
  margin: var(--itsm-panel-inset);
  margin-inline-start: 0;
  padding: var(--itsm-page-gutter);
  background: var(--itsm-colour-surface-raised);
  border-radius: var(--itsm-radius-xl);
  box-shadow: var(--itsm-elevation-xs);
}
.itsm-AppShell__aside { inline-size: var(--itsm-inspector-width); flex: none; padding: var(--itsm-space-md); background: var(--itsm-colour-surface-canvas); overflow-y: auto; }

.itsm-AppShell__navToggle { display: none; }

${mq.belowMd} {
  .itsm-AppShell--legacy > .itsm-AppShell__main { flex-direction: column; }
  .itsm-AppShell__nav { inline-size: 100%; border-block-end: var(--itsm-hairline) solid var(--itsm-colour-border-subtle); }
  .itsm-AppShell__nav[data-open="false"] { display: none; }
  .itsm-AppShell__aside { inline-size: 100%; }
  .itsm-AppShell__navToggle { display: inline-flex; }
  .itsm-AppShell__content { margin: 0; border-radius: 0; box-shadow: none; padding: var(--itsm-space-md); }
}
`,
);
