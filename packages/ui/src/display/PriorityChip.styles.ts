import { css, layer, mq } from '../styles/css.js';
import { moreContrast, toneVariables } from './tone.js';

/**
 * `PriorityChip` and `SignalBars` (v3 §2.14, A1 §7.8).
 *
 * The chip is a pill of 600 11/16 tabular figures — 20 px tall, 18 at `sm` —
 * with 5 px before the bars and 7 after the code. It takes its intent's
 * audited `subtleText` on `subtle`: P1 danger, P2 `high`, P3 neutral. P4 is
 * the quiet one, `text.muted` on the neutral tint (also an audited pair), so
 * the lowest priority recedes without vanishing.
 *
 * The bars are a 10 × 10 drawing in `currentColor`; a bar the priority does
 * not reach keeps 28 % of the colour, enough to show the three-step scale.
 * More contrast edges the chip in its intent's border colour; forced colours
 * draws an outlined chip with system-coloured bars.
 */
export const priorityChipStyles = layer(
  'components',
  css`
${toneVariables('.itsm-PriorityChip')}

.itsm-PriorityChip {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--itsm-space-2xs);
  box-sizing: border-box;
  min-block-size: var(--itsm-space-ml);
  padding-block: 0;
  padding-inline: 0.3125rem 0.4375rem;
  border-radius: var(--itsm-radius-pill);
  background: var(--_itsm-tone-subtle);
  color: var(--_itsm-tone-text);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-caption-size);
  line-height: 1rem;
  font-weight: var(--itsm-font-weight-semibold);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
  white-space: nowrap;
  vertical-align: middle;
}

.itsm-PriorityChip[data-size="sm"] {
  min-block-size: 1.125rem;
}

.itsm-PriorityChip[data-quiet] {
  color: var(--itsm-colour-text-muted);
}

.itsm-SignalBars {
  display: block;
  flex: none;
  inline-size: 0.625rem;
  block-size: 0.625rem;
  overflow: visible;
}

.itsm-SignalBars__bar {
  fill: currentColor;
  opacity: 0.28;
}

.itsm-SignalBars__bar[data-on] {
  opacity: 1;
}

${moreContrast((scope) => `${scope} .itsm-PriorityChip { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--_itsm-tone-border); }`)}

${mq.forcedColors} {
  .itsm-PriorityChip {
    border: var(--itsm-hairline) solid CanvasText;
    color: CanvasText;
  }
  .itsm-SignalBars__bar {
    forced-color-adjust: none;
    fill: CanvasText;
  }
}
`,
);
