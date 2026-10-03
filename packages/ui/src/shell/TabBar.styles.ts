import { css, layer, mq } from '../styles/css.js';

/**
 * `TabBar` v3 (A2 §7.3): the phone tab bar, docked to the bottom edge — 60 px
 * plus the home-indicator safe area, padding 4 / 6, on glass
 * (`material.chrome`, solid where the tokens say so) with a `border.subtle`
 * hairline above. Equal tabs at least 52 px tall, radius 12, a 20 px icon
 * over a 600 10.5/14 label, `text.faint` when idle.
 *
 * The current tab — a page with `aria-current="page"`, or an action whose
 * dialog is open — reads `text.primary` with its icon in the accent and a
 * 24 × 3 accent bar on the bar's top edge (square at the edge, rounded
 * below). Counts ride on the icon's corner as 16 px pills ringed in the
 * bar's colour; More's red dot is a 8 px disc in the same place.
 *
 * Hidden from 768 px, while the software keyboard is up, and during
 * full-screen flows (the `hidden` attribute).
 */
export const tabBarStyles = layer(
  'components',
  css`
.itsm-TabBar {
  box-sizing: border-box;
  block-size: var(--itsm-tabbar-height);
  padding: var(--itsm-space-2xs) calc(var(--itsm-space-2xs) + var(--itsm-space-3xs)) calc(var(--itsm-space-2xs) + var(--itsm-safe-area-bottom));
  padding-inline: max(calc(var(--itsm-space-2xs) + var(--itsm-space-3xs)), var(--itsm-safe-area-left)) max(calc(var(--itsm-space-2xs) + var(--itsm-space-3xs)), var(--itsm-safe-area-right));
  border-block-start: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  background: var(--itsm-colour-material-chrome);
  -webkit-backdrop-filter: var(--itsm-material-chrome-filter);
  backdrop-filter: var(--itsm-material-chrome-filter);
  font-family: var(--itsm-font-family-sans);
}
.itsm-TabBar__list {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  gap: var(--itsm-space-3xs);
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
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1875rem;
  box-sizing: border-box;
  min-inline-size: 0;
  min-block-size: 3.25rem;
  margin: 0;
  padding: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs)) var(--itsm-space-3xs) var(--itsm-space-2xs);
  border: 0;
  border-radius: var(--itsm-radius-xl);
  background: transparent;
  color: var(--itsm-colour-text-faint);
  font: inherit;
  text-decoration: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.itsm-TabBar__item:focus-visible {
  outline-offset: calc(-1 * var(--itsm-focus-width));
}
.itsm-TabBar__item:active {
  background: var(--itsm-colour-fill-pressed);
}
.itsm-TabBar__pill {
  position: relative;
  display: grid;
  place-items: center;
  inline-size: var(--itsm-icon-lg);
  block-size: var(--itsm-icon-lg);
}
.itsm-TabBar__item[aria-current="page"],
.itsm-TabBar__item[aria-expanded="true"] {
  color: var(--itsm-colour-text-primary);
}
.itsm-TabBar__item[aria-current="page"] .itsm-TabBar__icon,
.itsm-TabBar__item[aria-expanded="true"] .itsm-TabBar__icon {
  color: var(--itsm-colour-accent);
}
/* The 24 × 3 indicator, on the bar's top edge above the current tab. */
.itsm-TabBar__item[aria-current="page"]::before,
.itsm-TabBar__item[aria-expanded="true"]::before {
  content: '';
  position: absolute;
  inset-block-start: calc(-1 * var(--itsm-space-2xs) - var(--itsm-border-hair));
  inset-inline-start: 50%;
  inline-size: var(--itsm-space-lg);
  block-size: 0.1875rem;
  border-radius: 0 0 0.1875rem 0.1875rem;
  background: var(--itsm-colour-accent);
  transform: translateX(-50%);
}
.itsm-TabBar__item:dir(rtl)::before {
  transform: translateX(50%);
}
.itsm-TabBar__label {
  max-inline-size: 100%;
  overflow: hidden;
  font-size: 0.65625rem;
  line-height: 0.875rem;
  font-weight: var(--itsm-font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
/*
 * The narrowest phones (320 px) give each of five tabs about 60 px. A
 * nine-letter label ("Knowledge") at 10.5 px fits; a little negative
 * tracking keeps it whole where a device rounds wider.
 */
@media (max-width: 22.4375rem) {
  .itsm-TabBar__label {
    letter-spacing: -0.02em;
  }
}
.itsm-TabBar__badge {
  position: absolute;
  inset-block-start: calc(-1 * var(--itsm-space-2xs));
  inset-inline-start: calc(50% + var(--itsm-space-2xs));
  min-inline-size: var(--itsm-icon-sm);
  block-size: var(--itsm-icon-sm);
  box-shadow: 0 0 0 var(--itsm-border-thick) var(--itsm-colour-surface-raised);
}
.itsm-TabBar__dot {
  position: absolute;
  inset-block-start: calc(-1 * var(--itsm-space-3xs));
  inset-inline-start: calc(50% + var(--itsm-space-xs) - var(--itsm-space-3xs));
  inline-size: var(--itsm-space-xs);
  block-size: var(--itsm-space-xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-danger-solid);
  box-shadow: 0 0 0 var(--itsm-border-thick) var(--itsm-colour-surface-raised);
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
  .itsm-TabBar__item[aria-current="page"]::before,
  .itsm-TabBar__item[aria-expanded="true"]::before,
  .itsm-TabBar__dot {
    background: Highlight;
  }
}
`,
);
