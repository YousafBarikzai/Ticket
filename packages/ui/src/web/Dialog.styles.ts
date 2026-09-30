import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `Dialog`, and the overlay keyframes the other overlays share.
 *
 * The keyframes are here because `Dialog` is the first overlay the registry
 * loads; `Sheet`, `Popover`, `Menu`, the combobox list and the calendar name
 * them rather than defining their own copies (a second `@keyframes` with the
 * same name would win or lose by load order). Radix keeps a closing overlay
 * mounted until its `animationend`, so each has an exit animation under
 * `[data-state="closed"]`; the durations are tokens, which collapse to 1ms
 * under reduced motion, so nothing is ever held open waiting.
 *
 * Opaque, never glass (D6): `surface.overlay` on a blurred scrim, radius
 * `3xl`, elevation `xl` (a 2 px ring in the high-contrast themes). A
 * transparent hairline border is invisible until forced-colours mode paints
 * it, which is the outline those users need once shadows are gone. Below
 * 768 px the dialog rises from the bottom edge as a sheet (X-96), with the
 * safe area kept clear of its buttons.
 *
 * Motion (SPEC §1.9): the scrim fades over `normal`; the panel scales from
 * 0.97 and fades in over `normal` on the entrance curve and leaves over
 * `fast`; as a bottom sheet it slides over `slow` on the emphasised curve.
 * Under reduced motion only the fades remain.
 */
export const dialogStyles = layer(
  'components',
  css`
@keyframes itsm-overlay-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes itsm-overlay-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes itsm-overlay-zoom-in { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes itsm-overlay-zoom-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: scale(0.97); } }
@keyframes itsm-overlay-rise { from { transform: translateY(100%); } to { transform: none; } }
@keyframes itsm-overlay-sink { from { transform: none; } to { transform: translateY(100%); } }
@keyframes itsm-overlay-from-end { from { transform: translateX(100%); } to { transform: none; } }
@keyframes itsm-overlay-to-end { from { transform: none; } to { transform: translateX(100%); } }
@keyframes itsm-overlay-from-start { from { transform: translateX(-100%); } to { transform: none; } }
@keyframes itsm-overlay-to-start { from { transform: none; } to { transform: translateX(-100%); } }

.itsm-Dialog__scrim {
  position: fixed;
  inset: 0;
  z-index: var(--itsm-z-dialog);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--itsm-space-lg);
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--itsm-colour-scrim);
  -webkit-backdrop-filter: var(--itsm-scrim-filter);
  backdrop-filter: var(--itsm-scrim-filter);
  animation: itsm-overlay-fade-in var(--itsm-duration-normal) var(--itsm-easing-standard);
}
.itsm-Dialog__scrim[data-state="closed"] {
  animation: itsm-overlay-fade-out var(--itsm-duration-fast) var(--itsm-easing-exit) forwards;
}

.itsm-Dialog {
  position: relative;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  inline-size: min(100%, var(--itsm-sheet-md));
  max-block-size: calc(100dvh - 2 * var(--itsm-space-lg));
  margin: auto;
  border: var(--itsm-border-hair) solid transparent;
  border-radius: var(--itsm-radius-3xl);
  background: var(--itsm-colour-surface-overlay);
  color: var(--itsm-colour-text-primary);
  box-shadow: var(--itsm-elevation-xl), var(--itsm-edge-highlight);
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-body-line);
  letter-spacing: var(--itsm-text-body-tracking);
  outline: none;
  animation: itsm-overlay-zoom-in var(--itsm-duration-normal) var(--itsm-easing-entrance);
}
.itsm-Dialog[data-state="closed"] {
  animation: itsm-overlay-zoom-out var(--itsm-duration-fast) var(--itsm-easing-exit) forwards;
}
.itsm-Dialog--sm { inline-size: min(100%, var(--itsm-sheet-sm)); }
.itsm-Dialog--lg { inline-size: min(100%, 50rem); }

@supports (corner-shape: squircle) {
  .itsm-Dialog { corner-shape: squircle; }
}

.itsm-Dialog__header {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-sm);
  padding: var(--itsm-space-lg) var(--itsm-space-lg) var(--itsm-space-sm);
}
.itsm-Dialog__heading {
  flex: 1 1 auto;
  min-inline-size: 0;
}
.itsm-Dialog__title {
  margin: 0;
  font-size: var(--itsm-text-title2-size);
  line-height: var(--itsm-text-title2-line);
  font-weight: var(--itsm-text-title2-weight);
  letter-spacing: var(--itsm-text-title2-tracking);
  color: var(--itsm-colour-text-primary);
  text-wrap: balance;
}
.itsm-Dialog__description {
  margin: var(--itsm-space-2xs) 0 0;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  color: var(--itsm-colour-text-secondary);
  text-wrap: pretty;
}
.itsm-Dialog__close {
  flex: none;
  margin-block-start: calc(-1 * var(--itsm-space-3xs));
  margin-inline-end: calc(-1 * var(--itsm-space-xs));
}
.itsm-Dialog__body {
  flex: 1 1 auto;
  min-block-size: 0;
  padding: var(--itsm-space-xs) var(--itsm-space-lg) var(--itsm-space-lg);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.itsm-Dialog__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: var(--itsm-space-sm);
  padding: var(--itsm-space-md) var(--itsm-space-lg) var(--itsm-space-lg);
  border-block-start: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
}

/* Below md: a bottom sheet, full width, rising from the edge. */
${mq.belowMd} {
  .itsm-Dialog__scrim {
    align-items: flex-end;
    padding: var(--itsm-space-xl) 0 0;
  }
  .itsm-Dialog,
  .itsm-Dialog--sm,
  .itsm-Dialog--lg {
    inline-size: 100%;
    max-block-size: calc(100dvh - var(--itsm-safe-area-top) - var(--itsm-space-xl));
    margin: auto 0 0;
    border-end-start-radius: 0;
    border-end-end-radius: 0;
    padding-block-end: var(--itsm-safe-area-bottom);
    animation: itsm-overlay-rise var(--itsm-duration-slow) var(--itsm-easing-emphasised);
  }
  .itsm-Dialog[data-state="closed"] {
    animation: itsm-overlay-sink var(--itsm-duration-normal) var(--itsm-easing-exit) forwards;
  }
  .itsm-Dialog__header { padding: var(--itsm-space-ml) var(--itsm-space-md) var(--itsm-space-xs); }
  .itsm-Dialog__body { padding-inline: var(--itsm-space-md); }
  .itsm-Dialog__footer { padding-inline: var(--itsm-space-md); }
  .itsm-Dialog__footer > * { flex: 1 1 auto; }
}

${mq.reducedMotion} {
  .itsm-Dialog, .itsm-Dialog--sm, .itsm-Dialog--lg { animation-name: itsm-overlay-fade-in; }
  .itsm-Dialog[data-state="closed"] { animation-name: itsm-overlay-fade-out; }
}
${prefers.reducedMotion} .itsm-Dialog { animation-name: itsm-overlay-fade-in; }
${prefers.reducedMotion} .itsm-Dialog[data-state="closed"] { animation-name: itsm-overlay-fade-out; }

${mq.forcedColors} {
  .itsm-Dialog { border-color: CanvasText; }
}
`,
);
