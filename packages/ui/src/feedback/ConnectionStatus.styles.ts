import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `ConnectionStatus`: the pill and its tray.
 *
 * The pill is a capsule at the small control height, `footnote` 500 like
 * every status pill (SPEC §1.7), tinted by what it reports: grey for offline
 * and reconnecting, amber for an ended session, red when a write did not go
 * through — always with an icon or the spinner as well. Hover and press lay
 * the shared `fill.hover`/`fill.pressed` veil over whatever tint it has, so
 * one rule serves every tone.
 *
 * The tray is a text-bearing popover, so it is glass (`material.popover`,
 * SPEC D6) at the popover radius and elevation; the token layer makes it
 * solid in the high-contrast themes, under reduced transparency and where
 * `backdrop-filter` is missing. It opens with the menu motion — opacity and a
 * 0.97 scale from the pill's side, `fast`/`entrance`, no overshoot — and
 * without the scale under reduced motion. Until the script has measured where
 * it goes, it is laid out but invisible, so it never flashes in the corner.
 */
export const connectionStatusStyles = layer(
  'components',
  css`
@keyframes itsm-connection-open {
  from { opacity: 0; transform: scale(0.97); }
  to { opacity: 1; transform: none; }
}

.itsm-ConnectionStatus {
  --_itsm-pill-tint: var(--itsm-colour-neutral-subtle);
  --_itsm-pill-ink: var(--itsm-colour-neutral-subtleText);
  position: relative;
  display: inline-flex;
  align-items: center;
  max-inline-size: 100%;
  vertical-align: middle;
}

.itsm-ConnectionStatus[data-tone="warning"] {
  --_itsm-pill-tint: var(--itsm-colour-warning-subtle);
  --_itsm-pill-ink: var(--itsm-colour-warning-subtleText);
}

.itsm-ConnectionStatus[data-tone="danger"] {
  --_itsm-pill-tint: var(--itsm-colour-danger-subtle);
  --_itsm-pill-ink: var(--itsm-colour-danger-subtleText);
}

.itsm-ConnectionStatus__pill {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-inline-size: 0;
  max-inline-size: 100%;
  min-block-size: var(--itsm-control-height-sm);
  padding: 0 var(--itsm-space-sm) 0 var(--itsm-space-xs);
  border: 0;
  border-radius: var(--itsm-radius-pill);
  background-color: var(--_itsm-pill-tint);
  color: var(--_itsm-pill-ink);
  font: inherit;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-weight: var(--itsm-font-weight-medium);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-ConnectionStatus__pill:hover {
  background-image: linear-gradient(var(--itsm-colour-fill-hover), var(--itsm-colour-fill-hover));
}

.itsm-ConnectionStatus__pill:active,
.itsm-ConnectionStatus__pill[aria-expanded="true"] {
  background-image: linear-gradient(var(--itsm-colour-fill-pressed), var(--itsm-colour-fill-pressed));
}

.itsm-ConnectionStatus__label {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}

.itsm-ConnectionStatus__spinner {
  inline-size: var(--itsm-icon-xs);
  block-size: var(--itsm-icon-xs);
  color: inherit;
}

.itsm-ConnectionStatus__tray {
  position: fixed;
  inset: auto;
  z-index: var(--itsm-z-dropdown);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-md);
  inline-size: min(var(--itsm-inspector-width), calc(100vw - var(--itsm-space-md)));
  block-size: auto;
  max-block-size: calc(100dvh - var(--itsm-space-md));
  margin: 0;
  padding: var(--itsm-space-md);
  overflow: auto;
  border: 0;
  border-radius: var(--itsm-radius-xl);
  background: var(--itsm-colour-material-popover);
  -webkit-backdrop-filter: var(--itsm-material-popover-filter);
  backdrop-filter: var(--itsm-material-popover-filter);
  box-shadow: var(--itsm-elevation-lg), var(--itsm-edge-highlight);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  text-align: start;
  white-space: normal;
  visibility: hidden;
}

.itsm-ConnectionStatus__tray[data-placed] {
  visibility: visible;
  animation: itsm-connection-open var(--itsm-duration-fast) var(--itsm-easing-entrance);
}

.itsm-ConnectionStatus__tray[data-side="top"] {
  transform-origin: bottom left;
}

.itsm-ConnectionStatus__tray[data-side="bottom"] {
  transform-origin: top left;
}

.itsm-ConnectionStatus__tray[data-side="top"]:dir(rtl) {
  transform-origin: bottom right;
}

.itsm-ConnectionStatus__tray[data-side="bottom"]:dir(rtl) {
  transform-origin: top right;
}

.itsm-ConnectionStatus__tray:focus-visible {
  outline-offset: calc(var(--itsm-focus-width) * -1);
}

.itsm-ConnectionStatus__header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--itsm-space-xs);
}

.itsm-ConnectionStatus__title {
  margin: 0;
  font-size: var(--itsm-text-headline-size);
  line-height: var(--itsm-text-headline-line);
  font-weight: var(--itsm-text-headline-weight);
  letter-spacing: var(--itsm-text-headline-tracking);
}

.itsm-ConnectionStatus__explanation {
  margin: 0;
  color: var(--itsm-colour-text-secondary);
}

.itsm-ConnectionStatus__pending {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  margin: 0;
  color: var(--itsm-colour-text-secondary);
  font-variant-numeric: tabular-nums;
}

.itsm-ConnectionStatus__pending .itsm-Icon {
  color: var(--itsm-colour-text-muted);
}

.itsm-ConnectionStatus__failed {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-2xs);
}

.itsm-ConnectionStatus__failedTitle {
  margin: 0;
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  color: var(--itsm-colour-text-secondary);
}

.itsm-ConnectionStatus__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.itsm-ConnectionStatus__row {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
  padding-block: var(--itsm-space-sm);
  border-block-start: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}

.itsm-ConnectionStatus__row:first-child {
  padding-block-start: var(--itsm-space-2xs);
  border-block-start: 0;
}

.itsm-ConnectionStatus__rowText {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-3xs);
  min-inline-size: 0;
}

.itsm-ConnectionStatus__summary {
  margin: 0;
  font-weight: var(--itsm-font-weight-medium);
  overflow-wrap: anywhere;
}

.itsm-ConnectionStatus__problem {
  margin: 0;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-danger-subtleText);
}

.itsm-ConnectionStatus__row[data-state="conflict"] .itsm-ConnectionStatus__problem {
  color: var(--itsm-colour-text-muted);
}

.itsm-ConnectionStatus__rowActions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--itsm-space-xs);
}

${mq.reducedMotion} {
  .itsm-ConnectionStatus__tray[data-placed] {
    animation: none;
  }
}

${prefers.reducedMotion} .itsm-ConnectionStatus__tray[data-placed] {
  animation: none;
}

${mq.forcedColors} {
  .itsm-ConnectionStatus__pill {
    border: var(--itsm-hairline) solid ButtonText;
  }

  .itsm-ConnectionStatus__tray {
    border: var(--itsm-hairline) solid CanvasText;
  }
}
`,
);
