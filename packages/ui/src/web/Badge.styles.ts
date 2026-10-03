import { moreContrast, toneVariables } from '../display/tone.js';
import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `Badge`: a capsule in `footnote` type at weight 500 (SPEC §1.7), coloured
 * by `data-tone` × `data-emphasis` from audited pairs only —
 *
 * - `subtle`: the intent's `subtleText` on its `subtle` tint;
 * - `solid`: `solidText` on `solid`;
 * - `outline`: `subtleText` inside a ring of the intent's `border`, on
 *   whatever surface it sits (audited on raised, canvas, sunken, overlay).
 *
 * The dot takes the stronger `solid` colour, so it is visible on the tint.
 * The live dot (`data-state` on it, v3 §2.14) is 8 px in its state's border
 * colour instead — `success` live, `warning` reconnecting, `neutral`
 * offline, all at least 3:1 as UI marks — and a live one sends out a ring
 * every 2 s on its own `::after` (transform and opacity only). Under reduced
 * motion, the system's or the product's, the ring never runs: the dot and
 * the words beside it still say "live".
 * Numbers are tabular so a count does not change width as it ticks. The
 * badge sits on the text's middle, so it lines up beside a title or a label
 * without a wrapper.
 *
 * With more contrast every emphasis gets a ring in the intent's border
 * colour; in forced colours, a system-colour border.
 */
export const badgeStyles = layer(
  'components',
  css`
${toneVariables('.itsm-Badge')}

.itsm-Badge {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  box-sizing: border-box;
  min-block-size: 1.25rem;
  max-inline-size: 100%;
  padding-inline: var(--itsm-space-xs);
  border-radius: var(--itsm-radius-pill);
  background: var(--_itsm-tone-subtle);
  color: var(--_itsm-tone-text);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
  font-weight: var(--itsm-font-weight-medium);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  vertical-align: middle;
}

.itsm-Badge[data-size="sm"] {
  min-block-size: 1.125rem;
  padding-inline: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs));
}

.itsm-Badge[data-emphasis="solid"] {
  background: var(--_itsm-tone-solid);
  color: var(--_itsm-tone-solidText);
}

.itsm-Badge[data-emphasis="outline"] {
  background: transparent;
  box-shadow: inset 0 0 0 var(--itsm-hairline) var(--_itsm-tone-border);
}

.itsm-Badge__dot {
  flex: none;
  inline-size: 0.375rem;
  block-size: 0.375rem;
  border-radius: var(--itsm-radius-pill);
  background: var(--_itsm-tone-solid);
}

.itsm-Badge[data-emphasis="solid"] .itsm-Badge__dot {
  background: currentColor;
}

@keyframes itsm-Badge-live {
  0% { opacity: 0.55; transform: scale(1); }
  70%, 100% { opacity: 0; transform: scale(2.4); }
}

.itsm-Badge__dot[data-state] {
  position: relative;
  inline-size: 0.5rem;
  block-size: 0.5rem;
}

.itsm-Badge .itsm-Badge__dot[data-state="live"] {
  background: var(--itsm-colour-success-border);
}

.itsm-Badge .itsm-Badge__dot[data-state="reconnecting"] {
  background: var(--itsm-colour-warning-border);
}

.itsm-Badge .itsm-Badge__dot[data-state="offline"] {
  background: var(--itsm-colour-neutral-border);
}

.itsm-Badge__dot[data-state="live"]::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--itsm-colour-success-border);
  opacity: 0;
  animation: itsm-Badge-live 2s var(--itsm-easing-standard) infinite;
}

${mq.reducedMotion} {
  .itsm-Badge__dot[data-state="live"]::after {
    animation: none;
  }
}

${prefers.reducedMotion} .itsm-Badge__dot[data-state="live"]::after {
  animation: none;
}

.itsm-Badge__icon {
  flex: none;
}

${moreContrast((scope) => `${scope} .itsm-Badge { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--_itsm-tone-border); }`)}

${mq.forcedColors} {
  .itsm-Badge {
    border: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-Badge .itsm-Badge__dot,
  .itsm-Badge .itsm-Badge__dot[data-state],
  .itsm-Badge__dot[data-state="live"]::after {
    background: CanvasText;
  }
}
`,
);
