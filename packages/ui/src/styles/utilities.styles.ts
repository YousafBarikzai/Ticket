import { textRamp } from '../tokens/tokens.js';
import { css, layer } from './css.js';

/**
 * Utilities: the top layer, so a utility class beats any component rule it is
 * combined with. `itsm-visually-hidden` on a component's label hides the label
 * whatever padding or margin the component gives it.
 *
 * `.itsm-text-<style>` sets one step of the type ramp — size, line height,
 * weight and tracking together, so a heading cannot end up with the title's
 * size and the body's tracking. Generated from `textRamp`, so a style added to
 * the ramp has its class without anyone writing it.
 */
const textUtilities = Object.keys(textRamp)
  .map(
    (style) => `.itsm-text-${style} {
  font-size: var(--itsm-text-${style}-size);
  line-height: var(--itsm-text-${style}-line);
  font-weight: var(--itsm-text-${style}-weight);
  letter-spacing: var(--itsm-text-${style}-tracking);
}`,
  )
  .join('\n\n');

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

${textUtilities}
`,
);
