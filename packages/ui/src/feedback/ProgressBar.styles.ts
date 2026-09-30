import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `ProgressBar`.
 *
 * The track is `fill.track` with its inset ring (SPEC §1.2) — the ring is what
 * gives the empty part of the bar a 3:1 edge — and the fill is the tone's
 * solid colour (the accent by default). The 2 px refetch line has no track:
 * it is a sweep along an edge, not a gauge.
 *
 * The determinate fill slides by `--_itsm-progress` (a component-local
 * property set inline, 0..1), mirrored in right-to-left text. Two rules for
 * the mirror rather than one list, because a browser that does not know
 * `:dir()` would discard the attribute form with it.
 *
 * The sweep and the pulse have their own periods, not the duration tokens,
 * so reduced motion is spelled out for both the operating system's setting
 * and the product's.
 */
export const progressBarStyles = layer(
  'components',
  css`
@keyframes itsm-progress-sweep {
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
}

@keyframes itsm-progress-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.itsm-ProgressBar {
  --_itsm-bar: var(--itsm-colour-accent);
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
}

.itsm-ProgressBar[data-tone="success"] { --_itsm-bar: var(--itsm-colour-success-solid); }
.itsm-ProgressBar[data-tone="warning"] { --_itsm-bar: var(--itsm-colour-warning-solid); }
.itsm-ProgressBar[data-tone="danger"] { --_itsm-bar: var(--itsm-colour-danger-solid); }

.itsm-ProgressBar__caption {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--itsm-space-sm);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  letter-spacing: var(--itsm-text-subheadline-tracking);
}

.itsm-ProgressBar__label {
  min-inline-size: 0;
  font-weight: var(--itsm-text-subheadline-weight);
  color: var(--itsm-colour-text-secondary);
  overflow-wrap: anywhere;
}

.itsm-ProgressBar__value {
  margin-inline-start: auto;
  color: var(--itsm-colour-text-muted);
  font-variant-numeric: tabular-nums;
}

.itsm-ProgressBar__track {
  position: relative;
  display: block;
  block-size: var(--itsm-space-2xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--itsm-colour-fill-track);
  box-shadow: var(--itsm-track-ring);
  overflow: hidden;
}

.itsm-ProgressBar__fill {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--_itsm-bar);
  transform: translateX(calc((1 - var(--_itsm-progress, 0)) * -100%));
  transition: transform var(--itsm-duration-normal) var(--itsm-easing-standard);
}

:where([dir="rtl"]) .itsm-ProgressBar__fill {
  transform: translateX(calc((1 - var(--_itsm-progress, 0)) * 100%));
}

.itsm-ProgressBar__fill:dir(rtl) {
  transform: translateX(calc((1 - var(--_itsm-progress, 0)) * 100%));
}

.itsm-ProgressBar[data-state="indeterminate"] .itsm-ProgressBar__fill {
  inset-inline-end: auto;
  inline-size: 40%;
  transform: translateX(-100%);
  animation: itsm-progress-sweep 1.4s var(--itsm-easing-standard) infinite;
}

.itsm-ProgressBar[data-size="sm"] {
  gap: 0;
}

.itsm-ProgressBar[data-size="sm"] .itsm-ProgressBar__track {
  block-size: var(--itsm-space-3xs);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

${mq.reducedMotion} {
  .itsm-ProgressBar[data-state="indeterminate"] .itsm-ProgressBar__fill {
    inline-size: 100%;
    transform: none;
    animation: itsm-progress-pulse 2s ease-in-out infinite;
  }
}

${prefers.reducedMotion} .itsm-ProgressBar[data-state="indeterminate"] .itsm-ProgressBar__fill {
  inline-size: 100%;
  transform: none;
  animation: itsm-progress-pulse 2s ease-in-out infinite;
}

${mq.forcedColors} {
  .itsm-ProgressBar__track {
    border: var(--itsm-hairline) solid CanvasText;
  }

  .itsm-ProgressBar__fill {
    background: Highlight;
  }
}
`,
);
