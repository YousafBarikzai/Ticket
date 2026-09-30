import { moreContrast, toneVariables } from '../display/tone.js';
import { css, layer, mq } from '../styles/css.js';

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

.itsm-Badge__icon {
  flex: none;
}

${moreContrast((scope) => `${scope} .itsm-Badge { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--_itsm-tone-border); }`)}

${mq.forcedColors} {
  .itsm-Badge {
    border: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-Badge__dot {
    background: CanvasText;
  }
}
`,
);
