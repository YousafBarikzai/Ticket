import { css, layer, mq } from '../styles/css.js';
import { moreContrast, toneRules } from './tone.js';

/**
 * `InlineAlert`: the tone's tint behind primary text, the icon in the tone's
 * own text colour (both pairs audited, SPEC §1.2), `callout` type and a
 * control's radius, so it sits in a form or a card at the same scale as the
 * fields around it. Buttons and links inside keep their own styles; a link
 * is underlined so it is not told apart by colour alone.
 */
export const inlineAlertStyles = layer(
  'components',
  css`
${toneRules('.itsm-InlineAlert')}

.itsm-InlineAlert {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-xs);
  padding: var(--itsm-space-xs) var(--itsm-space-sm);
  border-radius: var(--itsm-radius-lg);
  background: var(--_itsm-tone-subtle);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}

.itsm-InlineAlert__icon {
  /* Centred on the first line of text: the line box is taller than the icon. */
  margin-block: calc((var(--itsm-text-callout-line) - var(--itsm-icon-sm)) / 2);
  color: var(--_itsm-tone-text);
}

.itsm-InlineAlert__body {
  flex: 1;
  min-inline-size: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: var(--itsm-space-xs);
  row-gap: var(--itsm-space-2xs);
  overflow-wrap: anywhere;
}

.itsm-InlineAlert__body :where(a:any-link) {
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

${moreContrast((scope) => `${scope} .itsm-InlineAlert { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--_itsm-tone-border); }`)}

${mq.forcedColors} {
  .itsm-InlineAlert {
    border: var(--itsm-hairline) solid CanvasText;
  }
}
`,
);
