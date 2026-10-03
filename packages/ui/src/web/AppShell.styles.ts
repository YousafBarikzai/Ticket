import { css, layer, mq, prefers } from '../styles/css.js';

/** Visually hidden, still named: the rail keeps words for assistive technology and drops them for the eye. */
const HIDDEN = `
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;`;

/**
 * The rail's look, written once and applied under two conditions: the
 * 1024–1279 px band, where the rail is the only size, and 1280 px and up when
 * the person collapsed the sidebar (`data-itsm-nav="rail"`). `--_rail: 1` is
 * what the sidebar's script reads to decide whether items need their
 * tooltip, and the area menu whether to open to the right.
 */
function railRules(scope: string): string {
  const docked = `${scope} .itsm-Sidebar[data-mode="docked"]`;
  return `
${docked} {
  --_rail: 1;
}
${docked} .itsm-Sidebar__brand {
  justify-content: center;
  padding-inline: 0;
}
${docked} .itsm-Sidebar__home {
  flex: none;
  margin: 0;
}
${docked} .itsm-Sidebar__brandText,
${docked} .itsm-Sidebar__label,
${docked} .itsm-Sidebar__badge,
${docked} .itsm-UserMenu__text,
${docked} .itsm-Sidebar__collapseLabel,
${docked} .itsm-AreaSwitcher__text,
${docked} .itsm-Sidebar__action .itsm-Button__label {${HIDDEN}
}
${docked} .itsm-Sidebar__sectionChevron,
${docked} .itsm-UserMenu__chevron,
${docked} .itsm-Sidebar__remove,
${docked} .itsm-Sidebar__action .itsm-Kbd {
  display: none;
}
${docked} .itsm-Sidebar__area {
  display: flex;
  justify-content: center;
  padding: var(--itsm-space-3xs) 0 var(--itsm-space-sm);
}
/* The Area card as a 44 px tile with its ⇕ badge: the way between areas is never hidden (A2 §5.5). */
${docked} .itsm-AreaSwitcher {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  place-items: center;
  inline-size: var(--itsm-control-height-lg);
  min-block-size: 0;
  block-size: var(--itsm-control-height-lg);
  padding: 0;
}
${docked} .itsm-AreaSwitcher__chevron {
  position: absolute;
  inset-block-end: calc(-1 * var(--itsm-space-2xs));
  inset-inline-end: calc(-1 * var(--itsm-space-2xs));
  box-sizing: border-box;
  inline-size: 0.875rem;
  block-size: 0.875rem;
  padding: 0.0625rem;
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-soft);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-surface-raised);
}
${docked} .itsm-Sidebar__action {
  display: flex;
  justify-content: center;
  padding-inline: 0;
}
${docked} .itsm-Sidebar__action .itsm-Button {
  inline-size: var(--itsm-control-height-lg);
  block-size: var(--itsm-control-height-lg);
  padding: 0;
}
${docked} .itsm-Sidebar__scroll,
${docked} .itsm-Sidebar__list--footer {
  padding-inline: var(--itsm-space-sm);
}
${docked} .itsm-Sidebar__section + .itsm-Sidebar__section {
  margin-block-start: var(--itsm-space-xs);
  padding-block-start: var(--itsm-space-xs);
  border-block-start: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}
${docked} .itsm-Sidebar__sectionLabel {
  display: none;
}
${docked} .itsm-Sidebar__list[data-collapsed] {
  display: flex;
}
${docked} .itsm-Sidebar__item {
  justify-content: center;
  inline-size: var(--itsm-control-height-lg);
  min-block-size: var(--itsm-control-height-lg);
  margin-inline: auto;
  padding-inline: 0;
  border-radius: var(--itsm-radius-item);
}
${docked} .itsm-Sidebar__item .itsm-Sidebar__icon {
  inline-size: var(--itsm-icon-lg);
  block-size: var(--itsm-icon-lg);
}
${docked} .itsm-Sidebar__item[aria-current="page"]::before {
  inset-block: var(--itsm-space-xs);
}
${docked} .itsm-Sidebar__children {
  display: none;
}
/* Only danger counts survive in the rail: a 16 px badge that stops at "9+"; the others stay in the link's name. */
${docked} .itsm-Sidebar__railCount {
  position: absolute;
  inset-block-start: var(--itsm-space-3xs);
  inset-inline-end: var(--itsm-space-3xs);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-inline-size: var(--itsm-icon-sm);
  block-size: var(--itsm-icon-sm);
  padding: 0 var(--itsm-space-3xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-danger-solid);
  color: var(--itsm-colour-danger-solidText);
  box-shadow: 0 0 0 var(--itsm-border-thick) var(--itsm-colour-surface-raised);
  font-size: 0.625rem;
  line-height: 1;
  font-weight: var(--itsm-font-weight-bold);
  font-variant-numeric: tabular-nums;
}
${docked} .itsm-Sidebar__foot {
  align-items: center;
  padding-inline: var(--itsm-space-xs);
}
${docked} .itsm-Sidebar__statusRow {
  justify-content: center;
}
${docked} .itsm-UserMenu--row {
  inline-size: auto;
  min-block-size: 0;
  padding: var(--itsm-space-3xs);
  border-radius: var(--itsm-radius-pill);
}
${docked} .itsm-Sidebar__collapse {
  justify-content: center;
  inline-size: var(--itsm-control-height-md);
  padding: 0;
}
${docked} .itsm-Sidebar__collapseIcon {
  transform: scaleX(-1);
}
${docked} .itsm-Sidebar__collapseIcon:dir(rtl) {
  transform: none;
}
`;
}

/**
 * `AppShell` — the frame — and the sidebar it draws (v3 §3.4–§3.6). In the
 * patterns layer, above the components it is built from.
 *
 * **The root.** Skip links, then the system bar (sticky at the top of the
 * window, publishing `--itsm-system-bar-h`), then the variant's frame. Every
 * sticky offset below it reads `--itsm-frame-top` — the system bar plus the
 * 56 px top bar — so nothing hides under either: `--_sticky-top` (page
 * headers), the html scroll padding (a focused control is never under a bar,
 * WCAG 2.4.11). The demo bar's swap notice is a fixed slot after `main`.
 *
 * **Sidebar frame** (Administration, the Service Desk). A grid of the
 * sidebar and the column; the window scrolls; the sidebar is `sticky` under
 * the system bar at the window's height less the bar; the column holds the
 * top bar, the banners and `main`, which sits on the canvas — no inset panel
 * — centred at `--itsm-content-max` (1600) with the page gutter. Widths by
 * viewport, the one place the design system uses viewport queries: under
 * 1024 px no sidebar column (☰ opens it as a sheet); 1024–1279 px the 72 px
 * rail; 1280 px and up the full 256 px — or the rail when the person
 * collapsed it. The column width lives in `--_sidebar-w`, which the bottom
 * dock also reads so it clears the sidebar. The column is the `itsm-column`
 * container the top bar sizes its search by, and the `itsm-page` container
 * pages query.
 *
 * **Sidebar** (light, D7 and owner decision a). White `surface.raised` with
 * a `border.subtle` edge, no shadow. Brand block 56 px; the Area card; the
 * Service Desk's "New ticket"; groups labelled in sentence case, 600 12/16
 * `text.muted`; items 36 px (32 compact, 44 coarse), 500 13/18
 * `text.secondary` with 18 px `text.faint` icons; the current item
 * `surface.selected`, `text.primary` at 600, an accent icon and a 3 px accent
 * bar at the inline start (X-B4); counts as `Count`'s pill. The foot: status
 * row, user card, Collapse.
 *
 * **Top-nav frame** (Help Portal). An opaque top bar with the mark, the area
 * switcher and centred pills: the current pill sits on `surface.selected`,
 * labels reserve their bold width so nothing shifts. Below 768 px the pills
 * and *New request* leave the bar, the tab bar docks at the bottom, and
 * inner pages show "‹ Back" and their title instead of the mark and the
 * switcher.
 *
 * The pre-redesign frame's rules follow, scoped to `--legacy`.
 */
export const appShellStyles = layer(
  'patterns',
  css`
/* ---- the frame ---- */

.itsm-AppShell[data-variant] {
  --_sidebar-w: 0px;
  --_sticky-top: var(--itsm-frame-top);
  --_dock-start: var(--_sidebar-w);
  min-block-size: 100dvh;
  background: var(--itsm-colour-surface-canvas);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-sans);
}

.itsm-AppShell__page {
  display: block;
  box-sizing: border-box;
  inline-size: 100%;
  max-inline-size: var(--itsm-content-max);
  min-inline-size: 0;
  margin-inline: auto;
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

/* The demo bar's swap notice: just under the bars, over the page, moving nothing. */
.itsm-AppShell__notice {
  position: fixed;
  inset-block-start: calc(var(--itsm-frame-top) + var(--itsm-space-xs));
  inset-inline: var(--_sidebar-w) 0;
  z-index: var(--itsm-z-toast);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--itsm-space-xs);
  padding-inline: var(--itsm-page-gutter);
  pointer-events: none;
}
.itsm-AppShell__notice > * {
  pointer-events: auto;
}
.itsm-AppShell__notice:empty {
  display: none;
}

/* A focused control never hides under the bars (WCAG 2.4.11). */
:where(html):has(.itsm-AppShell[data-variant]) {
  scroll-padding-block-start: calc(var(--itsm-frame-top) + var(--itsm-space-xs));
}

/* ---- sidebar frame ---- */

.itsm-AppShell__frame {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  min-block-size: calc(100dvh - var(--itsm-system-bar-h));
}
.itsm-AppShell__frame > .itsm-AppShell__sidebar {
  display: none;
}
.itsm-AppShell__column {
  display: flex;
  flex-direction: column;
  grid-column: -2 / -1;
  min-inline-size: 0;
  min-block-size: calc(100dvh - var(--itsm-system-bar-h));
  container-type: inline-size;
  container-name: itsm-column itsm-page;
}
.itsm-AppShell__column > .itsm-AppShell__page {
  flex: 1 1 auto;
}

${mq.lg} {
  .itsm-AppShell[data-variant="sidebar"] {
    --_sidebar-w: var(--itsm-sidebar-rail);
  }
  .itsm-AppShell__frame {
    grid-template-columns: var(--_sidebar-w) minmax(0, 1fr);
  }
  .itsm-AppShell__frame > .itsm-AppShell__sidebar {
    display: block;
    grid-column: 1;
    grid-row: 1;
    position: sticky;
    inset-block-start: var(--itsm-system-bar-h);
    block-size: calc(100dvh - var(--itsm-system-bar-h));
    min-inline-size: 0;
  }
  .itsm-AppShell__column {
    grid-row: 1;
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
  border-inline-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  background: var(--itsm-colour-surface-raised);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}
.itsm-Sidebar[data-mode="sheet"] {
  border-inline-end: 0;
  background: transparent;
}

/* The brand block: 56 px, so its foot meets the top bar's hairline. */
.itsm-Sidebar__brand {
  display: flex;
  flex: none;
  align-items: center;
  box-sizing: border-box;
  block-size: var(--itsm-topbar-height);
  padding: 0 var(--itsm-space-md);
}
.itsm-Sidebar__home {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 0.6875rem;
  min-inline-size: 0;
  margin-inline: calc(-1 * var(--itsm-space-2xs));
  padding: var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-primary);
  text-decoration: none;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Sidebar__home:hover {
  background: var(--itsm-colour-surface-hover);
}
.itsm-Sidebar__mark {
  flex: none;
}
.itsm-Sidebar__brandText {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
}
.itsm-Sidebar__brandName,
.itsm-Sidebar__workspace {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-Sidebar__brandName {
  font-family: var(--itsm-text-lockup-family);
  font-size: var(--itsm-text-lockup-size);
  line-height: var(--itsm-text-lockup-line);
  font-weight: var(--itsm-text-lockup-weight);
  letter-spacing: var(--itsm-text-lockup-tracking);
}
.itsm-Sidebar__workspace {
  color: var(--itsm-colour-text-faint);
  font-size: 0.71875rem;
  line-height: 0.9375rem;
  font-weight: var(--itsm-font-weight-medium);
}

.itsm-Sidebar__area {
  flex: none;
  padding: var(--itsm-space-3xs) var(--itsm-space-sm) 0.625rem;
}
.itsm-Sidebar__areas {
  flex: none;
  padding: 0 0.625rem var(--itsm-space-sm);
}
.itsm-Sidebar__action {
  flex: none;
  display: flex;
  padding: 0 var(--itsm-space-sm) 0.625rem;
}
.itsm-Sidebar__action > .itsm-Button {
  inline-size: 100%;
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
  padding: 0 0.625rem 0.875rem;
}
.itsm-Sidebar[data-mode="sheet"] .itsm-Sidebar__scroll {
  overflow: visible;
}

.itsm-Sidebar__section {
  position: relative;
}
.itsm-Sidebar__sectionLabel {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  box-sizing: border-box;
  inline-size: 100%;
  min-block-size: var(--itsm-space-lg);
  margin: 0.875rem 0 0;
  padding: 0 0.625rem;
  border: 0;
  border-radius: var(--itsm-radius-md);
  background: transparent;
  color: var(--itsm-colour-text-muted);
  font: inherit;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-semibold);
  letter-spacing: 0;
  text-align: start;
}
.itsm-Sidebar__section:first-child > .itsm-Sidebar__sectionLabel {
  margin-block-start: var(--itsm-space-2xs);
}
.itsm-Sidebar__sectionToggle {
  cursor: pointer;
  transition: color var(--itsm-duration-fast) var(--itsm-easing-standard), background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Sidebar__sectionToggle:hover {
  color: var(--itsm-colour-text-primary);
  background: var(--itsm-colour-surface-hover);
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
.itsm-Sidebar__section > .itsm-Sidebar__list {
  margin-block-start: var(--itsm-space-3xs);
}
.itsm-Sidebar__children {
  margin-block-start: var(--itsm-space-3xs);
  padding-inline-start: calc(var(--itsm-icon-md) + 0.625rem);
}
.itsm-Sidebar__list--footer {
  flex: none;
  padding: var(--itsm-space-xs) 0.625rem;
  border-block-start: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
}
.itsm-Sidebar__entry {
  position: relative;
}

.itsm-Sidebar__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  box-sizing: border-box;
  min-block-size: var(--itsm-nav-item-height);
  padding: 0 0.625rem;
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-font-weight-medium);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard), color var(--itsm-duration-fast) var(--itsm-easing-standard);
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
  color: var(--itsm-colour-text-faint);
  transition: color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Sidebar__item:hover .itsm-Sidebar__icon {
  color: var(--itsm-colour-text-primary);
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
/* Counts in Count's pill (v3 §2.14): neutral on sunken, accent and danger on their subtle pairs. */
.itsm-Sidebar__badge {
  flex: none;
  min-inline-size: var(--itsm-space-ml);
  block-size: var(--itsm-space-ml);
  margin-inline-start: auto;
  padding: 0 calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
  background: var(--itsm-colour-surface-sunken);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-caption-size);
  line-height: var(--itsm-space-ml);
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}
.itsm-Sidebar__badge[data-tone="accent"] {
  background: var(--itsm-colour-brand-subtle);
  color: var(--itsm-colour-brand-subtleText);
}
.itsm-Sidebar__badge[data-tone="danger"] {
  background: var(--itsm-colour-danger-subtle);
  color: var(--itsm-colour-danger-subtleText);
}
.itsm-Sidebar__railCount {
  display: none;
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

/* The foot: status row, user card, Collapse. */
.itsm-Sidebar__foot {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  padding: var(--itsm-space-xs) 0.625rem 0.625rem;
  padding-block-end: max(0.625rem, var(--itsm-safe-area-bottom));
  border-block-start: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
}
.itsm-Sidebar__statusRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-block-size: var(--itsm-space-lg);
}
.itsm-Sidebar__statusRow:has(> .itsm-Sidebar__status:empty):not(:has(> .itsm-Sidebar__footerExtra)) {
  display: none;
}
.itsm-Sidebar__status:empty,
.itsm-Sidebar__footerExtra:empty {
  display: none;
}
.itsm-Sidebar__user {
  display: flex;
}
.itsm-Sidebar__user .itsm-UserMenu--row {
  min-block-size: 3rem;
  padding: 0.4375rem var(--itsm-space-xs);
  border-radius: var(--itsm-radius-item);
}
.itsm-Sidebar__collapse {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  inline-size: 100%;
  block-size: var(--itsm-space-xl);
  margin: 0;
  padding: 0 0.625rem;
  border: 0;
  border-radius: var(--itsm-radius-md);
  background: transparent;
  color: var(--itsm-colour-text-faint);
  font: inherit;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  text-align: start;
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard), color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Sidebar__collapse:hover {
  background: var(--itsm-colour-surface-hover);
  color: var(--itsm-colour-text-primary);
}
.itsm-Sidebar__collapseIcon {
  flex: none;
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
  background: var(--itsm-colour-surface-hover);
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
  background: var(--itsm-colour-surface-hover);
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
/* The portal's search field is 200 px from 1024 px; below, the trigger is the magnifier (its own rule). */
${mq.lg} {
  .itsm-AppShell[data-variant="topnav"] .itsm-TopBar .itsm-SearchTrigger {
    inline-size: 12.5rem;
  }
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
  .itsm-AppShell[data-variant="topnav"][data-has-back] .itsm-TopBar__brand,
  .itsm-AppShell[data-variant="topnav"][data-has-back] .itsm-TopBar__area {
    display: none;
  }
  .itsm-AppShell[data-variant="topnav"][data-has-back] .itsm-TopBar__title {
    display: block;
  }
  .itsm-AppShell[data-variant="topnav"][data-has-back] .itsm-PageHeader__back {
    display: none;
  }
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
  .itsm-Sidebar {
    border-inline-end-color: CanvasText;
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

@media print {
  .itsm-AppShell__frame > .itsm-AppShell__sidebar,
  .itsm-AppShell__notice {
    display: none;
  }
  .itsm-AppShell__frame {
    display: block;
  }
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
