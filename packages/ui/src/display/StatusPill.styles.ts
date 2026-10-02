import { css, layer, mq } from '../styles/css.js';
import { moreContrast, toneVariables } from './tone.js';

/** The navy hero's mark colour for each tone: the dot and edge of an outlined pill on `[data-surface="hero"]`. */
const heroMarks = (['neutral', 'accent', 'info', 'success', 'warning', 'danger', 'hold', 'high'] as const)
  .map(
    (tone) =>
      `[data-surface="hero"] .itsm-StatusPill[data-tone="${tone}"] { --_itsm-pill-mark: var(--itsm-colour-hero-${tone}); }`,
  )
  .join('\n');

/**
 * `StatusPill` v3 (§2.14, A1 §7.9): a capsule with the tone's icon and a
 * label in 500 12/16. `md` is 22 px tall with 6 px before the icon and 8
 * after the label; `sm` is 20 px with a 12 px icon. Subtle is the intent's
 * `subtleText` on its tint, solid is `solidText` on `solid` — both audited
 * pairs, in all eight tones (`hold` and `high` arrive through `tones`).
 *
 * The neutral tint is close to the sunken and hover surfaces, so a neutral
 * pill ("New", "Closed") carries an inset 1 px `border.subtle` ring and
 * reads as a shape wherever it sits. The `meta` figure ("· 16") keeps the
 * label's colour: dimming it, as the benchmark does, takes the danger and
 * hold pairs under 4.5:1.
 *
 * On a navy hero (`[data-surface="hero"]`, §2.5) a subtle pill becomes an
 * outlined chip: transparent, `hero.text`, edged and iconed in the hero's
 * mark colour for its tone. A tint on navy would be a pair nobody audited.
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
  gap: 0.3125rem;
  box-sizing: border-box;
  min-block-size: 1.375rem;
  max-inline-size: 100%;
  margin: 0;
  padding-block: 0;
  padding-inline: 0.375rem var(--itsm-space-xs);
  border: 0;
  border-radius: var(--itsm-radius-pill);
  background: var(--_itsm-tone-subtle);
  color: var(--_itsm-tone-text);
  font: inherit;
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  letter-spacing: 0;
  word-spacing: normal;
  font-weight: var(--itsm-font-weight-medium);
  white-space: nowrap;
  vertical-align: middle;
}

.itsm-StatusPill[data-size="sm"] {
  min-block-size: 1.25rem;
  gap: var(--itsm-space-2xs);
  padding-inline: 0.3125rem 0.4375rem;
}

.itsm-StatusPill[data-tone="neutral"][data-emphasis="subtle"] {
  box-shadow: inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-border-subtle);
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

.itsm-StatusPill__meta {
  font-variant-numeric: tabular-nums;
}

${heroMarks}

[data-surface="hero"] .itsm-StatusPill[data-emphasis="subtle"] {
  background: transparent;
  color: var(--itsm-colour-hero-text);
  box-shadow: inset 0 0 0 var(--itsm-border-hair) var(--_itsm-pill-mark, var(--itsm-colour-hero-lineStrong));
}

[data-surface="hero"] .itsm-StatusPill[data-emphasis="subtle"] .itsm-StatusPill__icon {
  color: var(--_itsm-pill-mark, var(--itsm-colour-hero-text));
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
  (scope) => `${scope} .itsm-StatusPill[data-tone] { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--_itsm-tone-border); }
${scope} [data-surface="hero"] .itsm-StatusPill[data-tone][data-emphasis="subtle"] { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--_itsm-pill-mark, var(--itsm-colour-hero-lineStrong)); }
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
