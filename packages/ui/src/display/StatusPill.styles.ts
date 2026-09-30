import { css, layer, mq } from '../styles/css.js';
import { moreContrast, toneVariables } from './tone.js';

/**
 * `StatusPill`: a capsule with the tone's icon and a label in `footnote` 500
 * (SPEC §1.7). Subtle is the intent's `subtleText` on its tint; solid is
 * `solidText` on `solid` — both audited pairs.
 *
 * As a button (the *View only* pill) it keeps the pill's look and adds only
 * what a control needs: a pointer, a ring on hover in the intent's border
 * colour, a firmer ring while pressed or open, and the base layer's focus
 * ring. The label never changes colour on hover, so no unaudited pair
 * appears.
 */
export const statusPillStyles = layer(
  'components',
  css`
${toneVariables('.itsm-StatusPill')}

.itsm-StatusPill {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  box-sizing: border-box;
  min-block-size: 1.5rem;
  max-inline-size: 100%;
  margin: 0;
  padding-inline: var(--itsm-space-xs) calc(var(--itsm-space-xs) + var(--itsm-space-3xs));
  border: 0;
  border-radius: var(--itsm-radius-pill);
  background: var(--_itsm-tone-subtle);
  color: var(--_itsm-tone-text);
  font: inherit;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: var(--itsm-text-footnote-tracking);
  font-weight: var(--itsm-font-weight-medium);
  white-space: nowrap;
  vertical-align: middle;
}

.itsm-StatusPill[data-size="sm"] {
  min-block-size: 1.25rem;
  gap: var(--itsm-space-3xs);
  padding-inline: calc(var(--itsm-space-2xs) + var(--itsm-space-3xs)) var(--itsm-space-xs);
}

.itsm-StatusPill[data-emphasis="solid"] {
  background: var(--_itsm-tone-solid);
  color: var(--_itsm-tone-solidText);
}

.itsm-StatusPill__icon {
  flex: none;
}

.itsm-StatusPill__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

button.itsm-StatusPill {
  cursor: pointer;
  transition: box-shadow var(--itsm-duration-fast) var(--itsm-easing-standard);
}

button.itsm-StatusPill:hover {
  box-shadow: inset 0 0 0 var(--itsm-hairline) var(--_itsm-tone-border);
}

button.itsm-StatusPill:active,
button.itsm-StatusPill[aria-expanded="true"] {
  box-shadow: inset 0 0 0 var(--itsm-border-thick) var(--_itsm-tone-border);
}

${moreContrast(
  (scope) => `${scope} .itsm-StatusPill { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--_itsm-tone-border); }
${scope} button.itsm-StatusPill:is(:hover, :active, [aria-expanded="true"]) { box-shadow: inset 0 0 0 var(--itsm-border-thick) var(--_itsm-tone-border); }`,
)}

${mq.forcedColors} {
  .itsm-StatusPill {
    border: var(--itsm-hairline) solid CanvasText;
  }
  button.itsm-StatusPill {
    border-color: ButtonText;
    color: ButtonText;
  }
}
`,
);
