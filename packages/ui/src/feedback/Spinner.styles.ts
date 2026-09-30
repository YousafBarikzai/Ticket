import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `Spinner`: turned in eight steps a second, like the platform's activity
 * indicator — the stepped turn is what makes eight spokes read as motion
 * rather than a blur.
 *
 * The period is the indicator's own, not a transition duration, so it does
 * not come from the duration tokens; that is also why it needs its own
 * reduced-motion rules (collapsing the tokens does not reach it). Under
 * either the operating system's setting or the product's, it stops turning
 * and pulses its opacity instead: something still shows the page is busy,
 * and nothing rotates.
 *
 * The keyframes are the shared `itsm-spin` and `itsm-pulse`
 * (`styles/motion.styles.ts`). This is the product's one activity indicator:
 * buttons, search fields, the palette, lists and toasts all draw this one.
 *
 * Registered with the primitives, before the components that contain one, so
 * a container can resize or recolour it with a selector of equal weight.
 */
export const spinnerStyles = layer(
  'components',
  css`
.itsm-Spinner {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  inline-size: var(--itsm-icon-lg);
  block-size: var(--itsm-icon-lg);
  color: var(--itsm-colour-text-muted);
}

.itsm-Spinner[data-size="sm"] {
  inline-size: var(--itsm-icon-sm);
  block-size: var(--itsm-icon-sm);
}

.itsm-Spinner[data-size="lg"] {
  inline-size: var(--itsm-icon-2xl);
  block-size: var(--itsm-icon-2xl);
}

.itsm-Spinner__drawing {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  animation: itsm-spin 1s steps(8, end) infinite;
}

${mq.reducedMotion} {
  .itsm-Spinner__drawing {
    animation: itsm-pulse 2s ease-in-out infinite;
  }
}

${prefers.reducedMotion} .itsm-Spinner__drawing {
  animation: itsm-pulse 2s ease-in-out infinite;
}

${mq.forcedColors} {
  .itsm-Spinner {
    color: CanvasText;
  }
}
`,
);
