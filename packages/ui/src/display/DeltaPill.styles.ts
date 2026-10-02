import { css, layer, mq } from '../styles/css.js';
import { moreContrast } from './tone.js';

/**
 * `DeltaPill` (v3 §2.13, A1 §7.2): a 20 px pill (18 px at `sm`) of `caption`
 * 600 tabular figures — so a column of deltas does not jitter as they change
 * — with a 12 px arrow, 2 px from the number.
 *
 * The tint is the judgement, each an audited text-on-tint pair: good is
 * `success.subtle` / `success.subtleText`, bad `danger.subtle` /
 * `danger.subtleText`, and neutral (no way is better, or no change shown on
 * purpose) `neutral.subtle` / `text.muted`. The arrow and the sign carry the
 * direction, so the colour is never the only signal.
 *
 * Somebody who asked for more contrast cannot see a pale tint, so there the
 * pill gains a hairline in its own text colour; in forced colours it is an
 * outlined capsule in the system's colours.
 */
export const deltaPillStyles = layer(
  'components',
  css`
.itsm-DeltaPill {
  --_itsm-delta-bg: var(--itsm-colour-neutral-subtle);
  --_itsm-delta-text: var(--itsm-colour-text-muted);
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--itsm-space-3xs);
  box-sizing: border-box;
  block-size: var(--itsm-space-ml);
  padding: 0 0.4375rem 0 0.3125rem;
  border-radius: var(--itsm-radius-pill);
  background: var(--_itsm-delta-bg);
  color: var(--_itsm-delta-text);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-font-size-2xs);
  line-height: var(--itsm-space-ml);
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
  white-space: nowrap;
  vertical-align: middle;
}

.itsm-DeltaPill[data-size="sm"] {
  block-size: 1.125rem;
  line-height: 1.125rem;
  padding: 0 var(--itsm-space-2xs) 0 var(--itsm-space-3xs);
}

.itsm-DeltaPill[data-sentiment="good"] {
  --_itsm-delta-bg: var(--itsm-colour-success-subtle);
  --_itsm-delta-text: var(--itsm-colour-success-subtleText);
}

.itsm-DeltaPill[data-sentiment="bad"] {
  --_itsm-delta-bg: var(--itsm-colour-danger-subtle);
  --_itsm-delta-text: var(--itsm-colour-danger-subtleText);
}

.itsm-DeltaPill__icon {
  flex: none;
  inline-size: 0.75rem;
  block-size: 0.75rem;
}

${moreContrast((scope) => `${scope} .itsm-DeltaPill { box-shadow: inset 0 0 0 var(--itsm-hairline) currentColor; }`)}

${mq.forcedColors} {
  .itsm-DeltaPill {
    border: var(--itsm-hairline) solid CanvasText;
  }
}
`,
);
