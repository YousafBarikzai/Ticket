import { textRamp, type RampStyle } from '../tokens/tokens.js';
import { css, layer } from './css.js';

/**
 * Utilities: the top layer, so a utility class beats any component rule it is
 * combined with. `itsm-visually-hidden` on a component's label hides the label
 * whatever padding or margin the component gives it.
 *
 * `.itsm-text-<style>` sets one step of the type ramp — family, size, line
 * height, weight, tracking and word spacing together, so a heading cannot end
 * up with the title's size and the body's tracking, or in Jakarta without the
 * word spacing that keeps its words apart. Generated from `textRamp`, so a
 * style added to the ramp has its class without anyone writing it. `kicker`
 * is the one class that uppercases (D6): the text is written in sentence case
 * and only drawn in capitals, so a screen reader reads words, not letters.
 */
const textUtilities = (Object.entries(textRamp) as [string, RampStyle][])
  .map(([style, ramp]) => {
    const extras = [
      ramp.transform ? `  text-transform: ${ramp.transform};` : '',
      ramp.numeric ? `  font-variant-numeric: ${ramp.numeric};` : '',
    ].filter(Boolean);
    return `.itsm-text-${style} {
  font-family: var(--itsm-text-${style}-family);
  font-size: var(--itsm-text-${style}-size);
  line-height: var(--itsm-text-${style}-line);
  font-weight: var(--itsm-text-${style}-weight);
  letter-spacing: var(--itsm-text-${style}-tracking);
  word-spacing: var(--itsm-text-${style}-word-spacing);${extras.length > 0 ? `\n${extras.join('\n')}` : ''}
}`;
  })
  .join('\n\n');

/**
 * `.itsm-visually-hidden-focusable`: hidden like `.itsm-visually-hidden` until
 * it has keyboard focus, then a 28px band at the top of `main` (X-m19).
 *
 * It is for the page's `<h1>` in the sidebar apps, where the top bar shows the
 * page's title and the heading is the target `RouteFocus` moves focus to
 * after a navigation. Hidden and focused, it left a keyboard user with no
 * sign of where focus went. `:focus-visible` rather than `:focus`, so the band
 * appears when the navigation came from the keyboard and a pointer user, for
 * whom the browser draws no focus, is not shown a band that pushes the page
 * down on every click.
 */
const visuallyHiddenFocusable = css`
.itsm-visually-hidden-focusable:not(:focus-visible) {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.itsm-visually-hidden-focusable:focus-visible {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  min-block-size: 1.75rem;
  margin: 0;
  padding-block: 0;
  padding-inline: var(--itsm-page-gutter);
  border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  background: var(--itsm-colour-surface-raisedAlt);
  color: var(--itsm-colour-text-primary);
  font-family: var(--itsm-font-family-sans);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: 600;
  letter-spacing: 0;
  word-spacing: 0;
}
`;

export const utilityStyles = layer(
  'utilities',
  css`
.itsm-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

${visuallyHiddenFocusable}

${textUtilities}
`,
);
