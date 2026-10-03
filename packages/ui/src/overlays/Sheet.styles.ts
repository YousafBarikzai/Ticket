import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `Sheet`.
 *
 * - **Surface:** opaque `surface.overlay` (D6), elevation `xl`, radius `3xl`
 *   (16), no squircle (v3 §2.9), over the scrim (`rgba(15,23,42,.40)` light).
 *   From an edge it floats one panel-inset (8 px) off the screen's edges with
 *   every corner rounded, the way the frame's content panel does; from the
 *   bottom it spans the width with only its top corners rounded and keeps the
 *   home indicator's safe area clear.
 * - **Sizes:** the sheet tokens (400 / 560 / 760) or the whole width, never
 *   wider than the screen less the insets. A bottom sheet is 50 % or 92 % of
 *   the dynamic viewport (`data-snap`), and the whole screen when the
 *   viewport is under 500 px tall (X-93).
 * - **Header, body, footer:** the title is `title3`; the body scrolls on its
 *   own; the footer stays put and opaque. Where scroll-driven animation is
 *   supported the header's hairline appears only once the body has scrolled,
 *   so a short sheet shows no divider at all.
 * - **Motion:** in from its edge over `slow` on the emphasised curve, out over
 *   `normal`; the scrim fades. A drag moves the bottom sheet with a transform
 *   only (`--_drag`), and it springs back over `normal`. Reduced motion keeps
 *   the fades.
 * - **The inspector** (`modal={false}`) sits below dialogs and menus
 *   (`overlay`), since dialogs opened from it must cover it.
 */
export const sheetStyles = layer(
  'components',
  css`
@keyframes itsm-Sheet-from-end { from { transform: translateX(calc(100% + var(--itsm-panel-inset))); } to { transform: none; } }
@keyframes itsm-Sheet-to-end { from { transform: none; } to { transform: translateX(calc(100% + var(--itsm-panel-inset))); } }
@keyframes itsm-Sheet-from-start { from { transform: translateX(calc(-100% - var(--itsm-panel-inset))); } to { transform: none; } }
@keyframes itsm-Sheet-to-start { from { transform: none; } to { transform: translateX(calc(-100% - var(--itsm-panel-inset))); } }
@keyframes itsm-Sheet-divider { to { border-block-end-color: var(--itsm-colour-border-subtle); } }

.itsm-Sheet__scrim {
  position: fixed;
  inset: 0;
  z-index: var(--itsm-z-dialog);
  background: var(--itsm-colour-scrim);
  -webkit-backdrop-filter: var(--itsm-scrim-filter);
  backdrop-filter: var(--itsm-scrim-filter);
  animation: itsm-overlay-fade-in var(--itsm-duration-normal) var(--itsm-easing-standard);
}
.itsm-Sheet__scrim[data-state="closed"] {
  animation: itsm-overlay-fade-out var(--itsm-duration-normal) var(--itsm-easing-exit) forwards;
}

.itsm-Sheet {
  --_inset: var(--itsm-panel-inset);
  position: fixed;
  z-index: var(--itsm-z-dialog);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  inset-block: var(--_inset);
  inline-size: min(calc(100vw - 2 * var(--_inset)), var(--itsm-sheet-md));
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-3xl);
  background: var(--itsm-colour-surface-overlay);
  color: var(--itsm-colour-text-primary);
  box-shadow: var(--itsm-elevation-xl), var(--itsm-edge-highlight);
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-body-line);
  letter-spacing: var(--itsm-text-body-tracking);
  overflow: hidden;
  outline: none;
}
.itsm-Sheet:focus { outline: none; }
.itsm-Sheet--inspector { z-index: var(--itsm-z-overlay); }
.itsm-Sheet--sm { inline-size: min(calc(100vw - 2 * var(--_inset)), var(--itsm-sheet-sm)); }
.itsm-Sheet--lg { inline-size: min(calc(100vw - 2 * var(--_inset)), var(--itsm-sheet-lg)); }
.itsm-Sheet--full { inline-size: calc(100vw - 2 * var(--_inset)); }

/* From the end edge (and auto, at md and up). */
.itsm-Sheet--end,
.itsm-Sheet--auto {
  inset-inline-end: var(--_inset);
  animation: itsm-Sheet-from-end var(--itsm-duration-slow) var(--itsm-easing-emphasised);
}
.itsm-Sheet--end[data-state="closed"],
.itsm-Sheet--auto[data-state="closed"] {
  animation: itsm-Sheet-to-end var(--itsm-duration-normal) var(--itsm-easing-exit) forwards;
}
.itsm-Sheet--start {
  inset-inline-start: var(--_inset);
  animation: itsm-Sheet-from-start var(--itsm-duration-slow) var(--itsm-easing-emphasised);
}
.itsm-Sheet--start[data-state="closed"] {
  animation: itsm-Sheet-to-start var(--itsm-duration-normal) var(--itsm-easing-exit) forwards;
}
/* In right-to-left the end edge is on the left: the slides swap. */
.itsm-Sheet--end:dir(rtl),
.itsm-Sheet--auto:dir(rtl) { animation-name: itsm-Sheet-from-start; }
.itsm-Sheet--end:dir(rtl)[data-state="closed"],
.itsm-Sheet--auto:dir(rtl)[data-state="closed"] { animation-name: itsm-Sheet-to-start; }
.itsm-Sheet--start:dir(rtl) { animation-name: itsm-Sheet-from-end; }
.itsm-Sheet--start:dir(rtl)[data-state="closed"] { animation-name: itsm-Sheet-to-end; }

/* From the bottom (and auto, below md). */
.itsm-Sheet--bottom {
  inset: auto 0 0;
  inline-size: 100%;
  block-size: 92dvh;
  border-end-start-radius: 0;
  border-end-end-radius: 0;
  transform: translateY(var(--_drag, 0px));
  transition: transform var(--itsm-duration-normal) var(--itsm-easing-emphasised);
  animation: itsm-overlay-rise var(--itsm-duration-slow) var(--itsm-easing-emphasised);
}
.itsm-Sheet--bottom[data-snap="half"] { block-size: 50dvh; }
.itsm-Sheet--bottom[data-state="closed"] {
  animation: itsm-overlay-sink var(--itsm-duration-normal) var(--itsm-easing-exit) forwards;
}
.itsm-Sheet[data-dragging] { transition: none; }

${mq.belowMd} {
  .itsm-Sheet--auto {
    inset: auto 0 0;
    inline-size: 100%;
    block-size: 92dvh;
    border-end-start-radius: 0;
    border-end-end-radius: 0;
    transform: translateY(var(--_drag, 0px));
    transition: transform var(--itsm-duration-normal) var(--itsm-easing-emphasised);
    animation: itsm-overlay-rise var(--itsm-duration-slow) var(--itsm-easing-emphasised);
  }
  .itsm-Sheet--auto:dir(rtl) { animation-name: itsm-overlay-rise; }
  .itsm-Sheet--auto[data-snap="half"] { block-size: 50dvh; }
  .itsm-Sheet--auto[data-state="closed"],
  .itsm-Sheet--auto:dir(rtl)[data-state="closed"] {
    animation: itsm-overlay-sink var(--itsm-duration-normal) var(--itsm-easing-exit) forwards;
  }
  .itsm-Sheet--end,
  .itsm-Sheet--start,
  .itsm-Sheet--sm,
  .itsm-Sheet--md,
  .itsm-Sheet--lg {
    max-inline-size: calc(100vw - 2 * var(--_inset));
  }
  /*
   * A sheet from the bottom spans the screen edge to edge, whatever its size.
   * The size classes' cap above (for edge sheets, which float an inset off
   * each side) used to reach bottom and auto sheets too, and a bottom sheet
   * anchored at the left came out 16 px short, with a strip of page on the
   * right.
   */
  .itsm-Sheet--auto,
  .itsm-Sheet--bottom {
    max-inline-size: none;
  }
}

/* A short viewport (a phone on its side): the bottom sheet takes the screen. */
@media (max-height: 31.1875rem) {
  .itsm-Sheet--bottom,
  .itsm-Sheet--bottom[data-snap="half"] {
    block-size: 100dvh;
    border-radius: 0;
  }
}
@media (max-width: 47.9375rem) and (max-height: 31.1875rem) {
  .itsm-Sheet--auto,
  .itsm-Sheet--auto[data-snap="half"] {
    block-size: 100dvh;
    border-radius: 0;
  }
}

.itsm-Sheet__handle {
  flex: none;
  align-self: center;
  box-sizing: content-box;
  inline-size: 2.25rem;
  block-size: var(--itsm-space-2xs);
  padding: var(--itsm-space-xs) var(--itsm-space-xl) var(--itsm-space-3xs);
  background: var(--itsm-colour-border-interactive);
  background-clip: content-box;
  border-radius: var(--itsm-radius-pill);
  cursor: grab;
  touch-action: none;
}
.itsm-Sheet[data-dragging] .itsm-Sheet__handle { cursor: grabbing; }

.itsm-Sheet__header {
  display: flex;
  flex: none;
  align-items: flex-start;
  gap: var(--itsm-space-sm);
  padding: var(--itsm-space-ml) var(--itsm-space-lg) var(--itsm-space-md);
  border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
}
.itsm-Sheet__handle + .itsm-Sheet__header { padding-block-start: var(--itsm-space-xs); }
.itsm-Sheet__heading {
  flex: 1 1 auto;
  min-inline-size: 0;
}
.itsm-Sheet__titleRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--itsm-space-xs) var(--itsm-space-sm);
}
.itsm-Sheet__title {
  margin: 0;
  min-inline-size: 0;
  font-size: var(--itsm-text-title3-size);
  line-height: var(--itsm-text-title3-line);
  font-weight: var(--itsm-text-title3-weight);
  letter-spacing: var(--itsm-text-title3-tracking);
  color: var(--itsm-colour-text-primary);
  text-wrap: balance;
  overflow-wrap: anywhere;
}
.itsm-Sheet__meta {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-xs);
}
.itsm-Sheet__description {
  margin: var(--itsm-space-2xs) 0 0;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  color: var(--itsm-colour-text-secondary);
  text-wrap: pretty;
}
.itsm-Sheet__actions {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--itsm-space-2xs);
}
.itsm-Sheet__close {
  flex: none;
  margin-inline-end: calc(-1 * var(--itsm-space-xs));
}
.itsm-Sheet__body {
  flex: 1 1 auto;
  min-block-size: 0;
  padding: var(--itsm-space-md) var(--itsm-space-lg) var(--itsm-space-lg);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.itsm-Sheet__footer {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--itsm-space-sm);
  padding: var(--itsm-space-md) var(--itsm-space-lg);
  border-block-start: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  background: var(--itsm-colour-surface-overlay);
}
.itsm-Sheet--bottom .itsm-Sheet__footer,
.itsm-Sheet--bottom:not(:has(.itsm-Sheet__footer)) .itsm-Sheet__body {
  padding-block-end: calc(var(--itsm-space-md) + var(--itsm-safe-area-bottom));
}
${mq.belowMd} {
  .itsm-Sheet--auto .itsm-Sheet__footer,
  .itsm-Sheet--auto:not(:has(.itsm-Sheet__footer)) .itsm-Sheet__body {
    padding-block-end: calc(var(--itsm-space-md) + var(--itsm-safe-area-bottom));
  }
  .itsm-Sheet__header { padding-inline: var(--itsm-space-md); }
  .itsm-Sheet__body { padding-inline: var(--itsm-space-md); }
  .itsm-Sheet__footer { padding-inline: var(--itsm-space-md); }
}

.itsm-Sheet__discard { margin: 0; color: var(--itsm-colour-text-secondary); }

/* The header's divider appears once the body has scrolled, where supported. */
@supports (animation-timeline: scroll()) {
  .itsm-Sheet { timeline-scope: --itsm-Sheet-body; }
  .itsm-Sheet__body { scroll-timeline: --itsm-Sheet-body block; }
  .itsm-Sheet__header {
    border-block-end-color: transparent;
    animation: itsm-Sheet-divider linear both;
    animation-timeline: --itsm-Sheet-body;
    animation-range: 0 var(--itsm-space-md);
  }
}

${mq.reducedMotion} {
  .itsm-Sheet,
  .itsm-Sheet--end,
  .itsm-Sheet--start,
  .itsm-Sheet--auto,
  .itsm-Sheet--bottom { animation-name: itsm-overlay-fade-in; transition: none; }
  .itsm-Sheet[data-state="closed"],
  .itsm-Sheet--end[data-state="closed"],
  .itsm-Sheet--start[data-state="closed"],
  .itsm-Sheet--auto[data-state="closed"],
  .itsm-Sheet--bottom[data-state="closed"] { animation-name: itsm-overlay-fade-out; }
}
${prefers.reducedMotion} .itsm-Sheet { animation-name: itsm-overlay-fade-in; transition: none; }
${prefers.reducedMotion} .itsm-Sheet[data-state="closed"] { animation-name: itsm-overlay-fade-out; }

${mq.forcedColors} {
  .itsm-Sheet { border-color: CanvasText; }
  .itsm-Sheet__handle { background: CanvasText; }
}
`,
);
