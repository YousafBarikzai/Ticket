import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `Switch`: 44 × 26 (`md`) or 36 × 22 (`sm`), built from the spacing tokens.
 *
 * - Off, the track is `fill.track` with its inset ring (3:1 in every theme);
 *   on, it is the accent. The thumb is the solid-text colour — white, and
 *   black on high-contrast dark's pale accent — lifted by the two smallest
 *   shadows, which in the high-contrast themes are outlines.
 * - The thumb's travel is the track's width less its height, so one rule
 *   serves both sizes; it moves on the `spring` curve (one of the two places
 *   the spring is used) and widens a little while pressed. `inset-inline-start`
 *   and a direction factor make it travel the right way in right-to-left text.
 * - In the high-contrast themes the track also shows an on glyph (a bar) and
 *   an off glyph (a ring), so the state never rests on colour.
 * - Busy (a save in flight) puts a small spinner in the thumb; unavailable is
 *   the disabled text colour, never opacity.
 */
export const switchStyles = layer(
  'components',
  css`
.itsm-SwitchField {
  align-items: flex-start;
}

.itsm-SwitchField--row {
  flex-direction: row-reverse;
  justify-content: space-between;
}

.itsm-Switch {
  --_w: calc(var(--itsm-space-2xl) - var(--itsm-space-2xs));
  --_h: calc(var(--itsm-space-lg) + var(--itsm-space-3xs));
  --_pad: var(--itsm-space-3xs);
  --_grow: 0px;
  --_dir: 1;
  position: relative;
  flex: none;
  box-sizing: border-box;
  inline-size: var(--_w);
  block-size: var(--_h);
  margin: 0;
  margin-block-start: calc((var(--itsm-text-body-line) - var(--_h)) / 2);
  padding: 0;
  border: 0;
  border-radius: var(--itsm-radius-pill);
  background-color: var(--itsm-colour-fill-track);
  box-shadow: var(--itsm-track-ring);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition:
    background-color var(--itsm-duration-normal) var(--itsm-easing-standard),
    box-shadow var(--itsm-duration-normal) var(--itsm-easing-standard);
}

.itsm-Switch--sm {
  --_w: calc(var(--itsm-space-xl) + var(--itsm-space-2xs));
  --_h: calc(var(--itsm-space-ml) + var(--itsm-space-3xs));
}

:where([dir="rtl"]) .itsm-Switch {
  --_dir: -1;
}
.itsm-Switch:dir(rtl) {
  --_dir: -1;
}

.itsm-Switch:focus-visible {
  box-shadow: var(--itsm-track-ring), 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap);
}

.itsm-Switch[aria-checked="true"] {
  background-color: var(--itsm-colour-accent);
  box-shadow: none;
}
.itsm-Switch[aria-checked="true"]:focus-visible {
  box-shadow: 0 0 0 var(--itsm-focus-offset) var(--itsm-colour-focusGap);
}

.itsm-Switch__thumb {
  position: absolute;
  inset-block-start: var(--_pad);
  inset-inline-start: var(--_pad);
  box-sizing: border-box;
  inline-size: calc(var(--_h) - 2 * var(--_pad) + var(--_grow));
  block-size: calc(var(--_h) - 2 * var(--_pad));
  border-radius: var(--itsm-radius-pill);
  background-color: var(--itsm-colour-brand-solidText);
  box-shadow: var(--itsm-elevation-xs), var(--itsm-elevation-sm);
  transform: translateX(0);
  transition:
    transform var(--itsm-duration-normal) var(--itsm-easing-spring),
    inline-size var(--itsm-duration-normal) var(--itsm-easing-spring);
}

.itsm-Switch[aria-checked="true"] .itsm-Switch__thumb {
  transform: translateX(calc(var(--_dir) * (var(--_w) - var(--_h) - var(--_grow))));
}

.itsm-Switch:active:not([aria-disabled="true"]) {
  --_grow: var(--itsm-space-2xs);
}

/* On/off glyphs, for the high-contrast themes only. */

.itsm-Switch__glyph {
  position: absolute;
  inset-block-start: 50%;
  display: none;
  translate: 0 -50%;
  pointer-events: none;
}
.itsm-Switch__glyph--on {
  inset-inline-start: calc(var(--_h) / 2 - var(--itsm-border-hair));
  inline-size: var(--itsm-border-thick);
  block-size: calc(var(--_h) / 3);
  border-radius: var(--itsm-radius-pill);
  background-color: var(--itsm-colour-brand-solidText);
}
.itsm-Switch__glyph--off {
  inset-inline-end: calc(var(--_h) / 2 - var(--_h) / 6);
  box-sizing: border-box;
  inline-size: calc(var(--_h) / 3);
  block-size: calc(var(--_h) / 3);
  border: var(--itsm-border-thick) solid var(--itsm-colour-text-secondary);
  border-radius: var(--itsm-radius-pill);
}
[data-itsm-theme^="high-contrast"] .itsm-Switch__glyph {
  display: block;
}
@media (prefers-contrast: more) {
  :root:not([data-itsm-theme]) .itsm-Switch__glyph {
    display: block;
  }
}

/* Busy: a small spinner in the thumb. */

.itsm-Switch[aria-busy="true"] {
  cursor: progress;
}
.itsm-Switch[aria-busy="true"] .itsm-Switch__thumb::after {
  content: "";
  position: absolute;
  inset: 22%;
  border: var(--itsm-border-thick) solid var(--itsm-colour-text-muted);
  border-block-start-color: transparent;
  border-radius: var(--itsm-radius-pill);
  animation: itsm-spin 0.8s linear infinite;
}
${mq.reducedMotion} {
  .itsm-Switch[aria-busy="true"] .itsm-Switch__thumb::after {
    border-block-start-color: var(--itsm-colour-text-muted);
    animation: itsm-pulse 1.6s ease-in-out infinite;
  }
}
${prefers.reducedMotion} .itsm-Switch[aria-busy="true"] .itsm-Switch__thumb::after {
  border-block-start-color: var(--itsm-colour-text-muted);
  animation: itsm-pulse 1.6s ease-in-out infinite;
}

/* Unavailable */

.itsm-Switch[aria-disabled="true"]:not([aria-busy="true"]) {
  background-color: var(--itsm-colour-fill-secondary);
  box-shadow: inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-border-subtle);
  cursor: not-allowed;
}
.itsm-Switch[aria-disabled="true"][aria-checked="true"]:not([aria-busy="true"]) {
  background-color: var(--itsm-colour-text-disabled);
  box-shadow: none;
}
.itsm-Switch[aria-disabled="true"]:not([aria-busy="true"]) .itsm-Switch__thumb {
  box-shadow: var(--itsm-elevation-xs);
}
.itsm-SwitchField[data-disabled] .itsm-Choice__label {
  color: var(--itsm-colour-text-disabled);
  cursor: not-allowed;
}

${mq.forcedColors} {
  .itsm-Switch {
    forced-color-adjust: none;
    outline: var(--itsm-border-hair) solid CanvasText;
    background-color: Canvas;
  }
  .itsm-Switch:focus-visible {
    outline: var(--itsm-focus-width) solid Highlight;
    outline-offset: var(--itsm-focus-offset);
  }
  .itsm-Switch__thumb {
    forced-color-adjust: none;
    background-color: CanvasText;
    box-shadow: none;
  }
  .itsm-Switch[aria-checked="true"] {
    background-color: Highlight;
  }
  .itsm-Switch[aria-checked="true"] .itsm-Switch__thumb {
    background-color: HighlightText;
  }
  .itsm-Switch[aria-disabled="true"]:not([aria-busy="true"]) {
    outline-color: GrayText;
    background-color: Canvas;
  }
  .itsm-Switch[aria-disabled="true"]:not([aria-busy="true"]) .itsm-Switch__thumb {
    background-color: GrayText;
  }
}
`,
);
